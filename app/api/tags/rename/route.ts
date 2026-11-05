import { NextRequest, NextResponse } from "next/server";
import { renameTag } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST { from, to } — fixes LLM tag drift; renaming onto an existing tag merges.
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const r = renameTag(body.from, body.to);
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true, renamed: r.renamed });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
