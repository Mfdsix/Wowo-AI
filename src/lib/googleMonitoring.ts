import { createSign } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { reconcileGoogleChars } from "@/lib/ttsUsage";

// ─── Google Cloud Monitoring API (usage reconcile) ──────────────────
// Ambil pemakaian TTS beneran dari Google buat reconcile counter lokal +
// display "sisa free tier" yang akurat.
//
// Auth = OAuth2 service account (Monitoring API GAK nerima API key).
// Kita sign JWT manual pakai node:crypto (RS256) → tukar access token →
// query timeSeries. NO SDK pihak ke-3 (patuh global rule: gak npm install).
//
// Butuh env:
//   GOOGLE_CLOUD_PROJECT = <project-id>
//   GOOGLE_SERVICE_ACCOUNT_JSON = <path ke file creds.json>
// Service account butuh role roles/monitoring.viewer.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const MONITORING_URL =
  "https://monitoring.googleapis.com/v3/projects/{project}/timeSeries:query";
const SCOPE = "https://www.googleapis.com/auth/monitoring.read";

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

function loadServiceAccount(): ServiceAccount | null {
  const path = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ServiceAccount;
  } catch (err) {
    console.warn("[Google Monitor] gagal baca service account:", err);
    return null;
  }
}

// Buat signed JWT (RS256) untuk klaim OAuth.
function makeJwt(sa: ServiceAccount): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: SCOPE,
    aud: sa.token_uri ?? TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${enc(header)}.${enc(claims)}`;
  const sign = createSign("RSA-SHA256");
  sign.update(unsigned);
  sign.end();
  const sig = sign.sign(sa.private_key, "base64url");
  return `${unsigned}.${sig}`;
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const jwt = makeJwt(sa);
  const res = await fetch(sa.token_uri ?? TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OAuth token HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("OAuth: access_token kosong");
  return data.access_token;
}

// Query metric request_cost per SKU cloudtts bulan ini (USD),
// lalu konversi ke karakter pakai tarif SKU.
async function queryTtsCostChars(project: string, token: string): Promise<number> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const end = now.toISOString();

  // SKU WaveNet/Standard = $4 / 1jt char; Chirp3 HD = $30 / 1jt char.
  const ratePerChar = (sku: string) =>
    sku === "F977-2280-6F1B" ? 30 / 1_000_000 : 4 / 1_000_000;

  const url = MONITORING_URL.replace("{project}", project);
  let totalChars = 0;

  // Dua SKU: WaveNet/Standard (9D01-5995-B545) & Chirp3 HD (F977-2280-6F1B)
  for (const sku of ["9D01-5995-B545", "F977-2280-6F1B"]) {
    const body = {
      query:
        `fetch cloudtts.googleapis.com ` +
        `| metric 'serviceruntime.googleapis.com/api/request_cost' ` +
        `| filter resource.service == 'cloudtts.googleapis.com' ` +
        `&& metrics.sku.id == '${sku}' ` +
        `| within [${start}, ${end}]`,
    };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.warn(`[Google Monitor] SKU ${sku} query HTTP ${res.status}:`, t.slice(0, 150));
      continue;
    }
    const data = (await res.json()) as {
      timeSeries?: { points?: { value?: { doubleValue?: number } }[] }[];
    };
    let usd = 0;
    for (const ts of data.timeSeries ?? []) {
      for (const p of ts.points ?? []) usd += p.value?.doubleValue ?? 0;
    }
    totalChars += usd / ratePerChar(sku);
  }

  return Math.floor(totalChars);
}

/**
 * Sync sekali: ambil usage asli dari Google → reconcile counter lokal.
 * Aman dipanggil dari mana aja; kalau env/service account gak lengkap → no-op.
 */
export async function syncGoogleTtsUsage(): Promise<boolean> {
  const project = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  const sa = loadServiceAccount();
  if (!project || !sa) {
    // Gak dikonfigurasi → skip (counter lokal tetep jalan sebagai guard).
    return false;
  }
  try {
    const token = await getAccessToken(sa);
    const chars = await queryTtsCostChars(project, token);
    await reconcileGoogleChars(chars);
    console.log(`[Google Monitor] sync OK: ${chars} chars (reconciled)`);
    return true;
  } catch (err) {
    console.warn("[Google Monitor] sync gagal:", err);
    return false;
  }
}

// Interval sync default (menit). Data Google lag 3-6 jam, jadi 180 cukup.
export function syncIntervalMs(): number {
  const env = Number(process.env.TTS_GOOGLE_SYNC_INTERVAL_MIN);
  if (Number.isFinite(env) && env > 0) return env * 60_000;
  return 180 * 60_000;
}

// Lazy sync: cuma jalan kalau lastSyncedAt sudah lewat interval.
export async function maybeSyncGoogleTtsUsage(): Promise<void> {
  const { getUsage } = await import("@/lib/ttsUsage");
  try {
    const usage = await getUsage();
    const last = usage.lastSyncedAt ?? 0;
    if (Date.now() - last < syncIntervalMs()) return;
    await syncGoogleTtsUsage();
  } catch (err) {
    console.warn("[Google Monitor] maybeSync error:", err);
  }
}

