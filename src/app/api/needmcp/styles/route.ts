import { NextResponse } from "next/server";
import { listNeedMCPStyles } from "@/lib/needmcp";

export const dynamic = "force-dynamic";

// GET /api/needmcp/styles — list style yang tersedia buat style picker
export async function GET() {
  if (!process.env.NEEDMCP_API_KEY) {
    return NextResponse.json({ styles: [] });
  }

  try {
    const styles = await listNeedMCPStyles();
    return NextResponse.json({ styles });
  } catch (err) {
    console.error("[NeedMCP] styles failed:", (err as Error)?.message ?? err);
    return NextResponse.json({ styles: [] });
  }
}
