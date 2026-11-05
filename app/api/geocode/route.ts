import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Server-side Nominatim proxy so the browser never talks to OSM directly.
// Policy compliance: identifying User-Agent, ≥1s between upstream calls,
// results cached for the life of the server process.
const UA = "human-graph/0.1 (personal people-memory; +https://github.com/kikman-git/people-graph)";
type Hit = { lat: number; lng: number; display_name: string } | null;
const cache = new Map<string, Hit>();
let lastCall = 0;

async function nominatim(q: string): Promise<Hit> {
  if (cache.has(q)) return cache.get(q)!;
  const wait = lastCall + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const url =
    "https://nominatim.openstreetmap.org/search?" +
    new URLSearchParams({ q, format: "jsonv2", limit: "1" });
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  const data = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  const hit: Hit = data.length
    ? { lat: Number(data[0].lat), lng: Number(data[0].lon), display_name: data[0].display_name }
    : null;
  cache.set(q, hit);
  return hit;
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 200);
  if (!q) return NextResponse.json({ error: "q is required" }, { status: 400 });
  try {
    const hit = await nominatim(q);
    if (!hit) return NextResponse.json({ query: q, found: false });
    return NextResponse.json({ query: q, found: true, ...hit });
  } catch (e) {
    return NextResponse.json(
      { error: `geocoding failed: ${(e as Error).message}` },
      { status: 502 }
    );
  }
}
