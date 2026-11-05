import { NextRequest, NextResponse } from "next/server";
import { MAX_PHOTO_BYTES, savePhoto } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  let file: File | null = null;
  try {
    const fd = await req.formData();
    const f = fd.get("file");
    if (f instanceof File) file = f;
  } catch {
    /* falls through to the missing-file error */
  }
  if (!file) return NextResponse.json({ error: "multipart 'file' field required" }, { status: 400 });
  if (file.size > MAX_PHOTO_BYTES) {
    return NextResponse.json({ error: "file too large (max 10 MB)" }, { status: 400 });
  }
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const r = savePhoto(Number(id), file.name || "photo", bytes);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status ?? 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
