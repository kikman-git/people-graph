import { NextRequest, NextResponse } from "next/server";
import { deleteRelationship } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Relationship edges describe the present, not history — hard delete is fine.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  try {
    if (!deleteRelationship(Number(id))) {
      return NextResponse.json({ error: "relationship not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
