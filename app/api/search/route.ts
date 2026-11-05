import { NextRequest, NextResponse } from "next/server";
import { search } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  try {
    return NextResponse.json({ query: q, results: search(q) });
  } catch (e) {
    return NextResponse.json(
      { error: `people database unavailable: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
