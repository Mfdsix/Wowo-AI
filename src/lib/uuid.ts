// UUID generator yang aman di browser MAUPUN server, termasuk di non-secure
// context (http://IP:port, bukan https/localhost) di mana crypto.randomUUID
// tidak tersedia. crypto.randomUUID hanya ada di secure context.
//
// Fallback pakai crypto.getRandomValues (selalu ada di browser & Node 19+) —
// keluarkan UUID v4 yang RFC-4122 compliant.
export function uuid(): string {
  const c = (globalThis as unknown as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();

  // Fallback v4: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxx
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(bytes);
  } else {
    // Node tanpa webcrypto global (sangat jarang) — pakai Math.random.
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return (
    hex.slice(0, 4).join("") +
    "-" +
    hex.slice(4, 6).join("") +
    "-" +
    hex.slice(6, 8).join("") +
    "-" +
    hex.slice(8, 10).join("") +
    "-" +
    hex.slice(10, 16).join("")
  );
}
