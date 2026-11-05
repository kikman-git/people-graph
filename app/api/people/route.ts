import { NextResponse } from "next/server";
import { directory } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ people: directory() });
  } catch (e) {
    return NextResponse.json(
      { error: `people database unavailable: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
