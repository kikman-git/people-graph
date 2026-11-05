import { NextRequest, NextResponse } from "next/server";
import { createFact, validateFact } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST { person_id, category, value, tag?, learned_at?, supersedes? }
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const personId =
    typeof body.person_id === "number" && Number.isInteger(body.person_id)
      ? body.person_id
      : null;
  if (!personId) return NextResponse.json({ error: "person_id is required" }, { status: 400 });
  let supersedes: number | null = null;
  if (body.supersedes != null) {
    if (typeof body.supersedes !== "number" || !Number.isInteger(body.supersedes)) {
      return NextResponse.json({ error: "supersedes must be a fact id" }, { status: 400 });
    }
    supersedes = body.supersedes;
  }
  const v = validateFact(body);
  if (v.errors) return NextResponse.json({ error: v.errors.join("; ") }, { status: 400 });
  try {
    const r = createFact(personId, v.fields!, supersedes);
    if (r.error) return NextResponse.json({ error: r.error }, { status: r.status ?? 400 });
    return NextResponse.json({ ok: true, id: r.id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
