import { NextRequest, NextResponse } from "next/server";
import { deletePerson, profile, updatePerson, validatePerson } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function parseId(ctx: { params: Promise<{ id: string }> }): Promise<number | null> {
  const { id } = await ctx.params;
  return /^\d+$/.test(id) ? Number(id) : null;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const id = await parseId(ctx);
  if (id == null) return NextResponse.json({ error: "bad id" }, { status: 400 });
  try {
    const p = profile(id);
    if (!p) return NextResponse.json({ error: "person not found" }, { status: 404 });
    return NextResponse.json(p);
  } catch (e) {
    return NextResponse.json(
      { error: `people database unavailable: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = await parseId(ctx);
  if (id == null) return NextResponse.json({ error: "bad id" }, { status: 400 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const v = validatePerson(body);
  if (v.errors) return NextResponse.json({ error: v.errors.join("; ") }, { status: 400 });
  try {
    if (!updatePerson(id, v.fields!)) {
      return NextResponse.json({ error: "person not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = await parseId(ctx);
  if (id == null) return NextResponse.json({ error: "bad id" }, { status: 400 });
  try {
    if (!deletePerson(id)) {
      return NextResponse.json({ error: "person not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
