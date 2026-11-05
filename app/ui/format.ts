import type { Relationship } from "@/lib/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Graph dates are Japan-local (JST has no DST, so a fixed offset is exact).
export function todayJst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export function fmtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

// Birthdays are 'YYYY-MM-DD' or 'MM-DD' (year unknown).
export function fmtBirthday(b: string): { label: string; age: number | null } {
  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(b);
  if (full) {
    const today = todayJst();
    let age = Number(today.slice(0, 4)) - Number(full[1]);
    if (today.slice(5) < b.slice(5)) age--;
    return { label: fmtDate(b), age };
  }
  const md = /^(\d{2})-(\d{2})$/.exec(b);
  if (md) return { label: `${MONTHS[Number(md[1]) - 1]} ${Number(md[2])}`, age: null };
  return { label: b, age: null };
}

export const prettyTag = (t: string) => t.replaceAll("_", " ");

const CJK_RE = /[぀-ヿ㐀-鿿豈-﫿가-힯]/;

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = [...parts[0]][0] ?? "?";
  if (CJK_RE.test(first)) return first; // one CJK character carries enough identity
  const last = parts.length > 1 ? [...parts[parts.length - 1]][0] ?? "" : "";
  return (first + last).toUpperCase();
}

// Short chip sub-label for a relationship, seen from the profile it renders on.
// introduced_by is directed: A introduced_by B = "B introduced me to A".
export function relSummary(r: Relationship): string {
  if (r.rel_type === "introduced_by") {
    return r.direction === "a" ? "introduced us" : "met through them";
  }
  if (r.label) return r.label;
  return r.rel_type === "other" ? "connection" : r.rel_type;
}
