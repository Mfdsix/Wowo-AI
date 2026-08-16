import { NextRequest, NextResponse } from "next/server";
import { generateDailyJourney } from "@/lib/curiosity";

export const dynamic = "force-dynamic";

// ─── Curiosity Engine: Daily Rabbit Hole (PRD §14) ──────────
// POST /api/curiosity/daily  → generate curated journey harian.
export async function POST(req: NextRequest) {
  try {
    const journey = await generateDailyJourney(req.signal);
    const steps = Array.isArray(journey.steps) ? journey.steps.slice(0, 5) : [];
    return NextResponse.json({
      title: journey.title ?? "Today's Rabbit Hole",
      theme: journey.theme ?? "",
      steps,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Daily error: ${msg}` }, { status: 502 });
  }
}
