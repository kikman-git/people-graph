import { NextResponse } from "next/server";
import { mapPins } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ pins: mapPins() });
  } catch (e) {
    return NextResponse.json(
      { error: `people database unavailable: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
