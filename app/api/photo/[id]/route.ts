import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { photoPath } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
};

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  let p: string | null;
  try {
    p = photoPath(Number(id));
  } catch (e) {
    return NextResponse.json(
      { error: `people database unavailable: ${(e as Error).message}` },
      { status: 500 }
    );
  }
  if (!p) {
    return NextResponse.json({ error: "no photo for this person" }, { status: 404 });
  }
  const body = new Uint8Array(fs.readFileSync(p));
  return new NextResponse(body, {
    headers: {
      "content-type": MIME[path.extname(p).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "private, max-age=3600",
      "content-disposition": "inline",
    },
  });
}
