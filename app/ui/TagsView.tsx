"use client";
// Tag vocabulary admin — the fix for LLM tag drift ("climbing" vs
// "bouldering"). Renaming onto an existing tag merges them.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { TagInfo } from "@/lib/types";
import { prettyTag } from "./format";

const CARD =
  "bg-white border border-line rounded-2xl shadow-[0_1px_2px_rgba(60,50,30,.04)]";
const INPUT =
  "rounded-lg border border-line bg-white px-2.5 py-1 text-sm text-ink outline-none focus:border-fainter";

export default function TagsView({ tags }: { tags: TagInfo[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), flash.ok ? 2200 : 3600);
    return () => clearTimeout(t);
  }, [flash]);

  const rename = async (from: string) => {
    if (busy || !value.trim() || value.trim() === from) {
      setEditing(null);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/tags/rename", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from, to: value }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      setFlash({ text: `Renamed — ${j.renamed} facts updated`, ok: true });
      setEditing(null);
      router.refresh();
    } catch (e) {
      setFlash({ text: (e as Error).message, ok: false });
    } finally {
      setBusy(false);
    }
  };

  if (tags.length === 0) {
    return (
      <div className={`${CARD} px-5 py-10 text-center text-sm text-muted`}>
        No tags yet — they appear as facts are captured.
      </div>
    );
  }

  return (
    <>
      <div className={`${CARD} divide-y divide-line-soft`}>
        {tags.map((t) => (
          <div key={t.tag} className="flex items-center justify-between gap-3 px-5 py-2.5">
            {editing === t.tag ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  rename(t.tag);
                }}
              >
                <input
                  className={INPUT}
                  value={value}
                  autoFocus
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
                />
                <button type="submit" className="text-xs text-accent-deep hover:text-accent-deeper" disabled={busy}>
                  save
                </button>
                <button type="button" className="text-xs text-faint hover:text-ink" onClick={() => setEditing(null)}>
                  cancel
                </button>
              </form>
            ) : (
              <span className="flex items-baseline gap-2.5">
                <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-sm text-accent-deeper">
                  {prettyTag(t.tag)}
                </span>
                <span className="font-mono text-xs text-fainter">{t.tag}</span>
              </span>
            )}
            <span className="flex shrink-0 items-baseline gap-3 text-xs text-faint">
              <span>
                {t.people} {t.people === 1 ? "person" : "people"} · {t.facts}{" "}
                {t.facts === 1 ? "fact" : "facts"}
              </span>
              {editing !== t.tag && (
                <button
                  className="text-faint hover:text-accent-deep"
                  onClick={() => {
                    setEditing(t.tag);
                    setValue(t.tag);
                  }}
                >
                  rename
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
      {flash && (
        <div
          className={`fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full px-4 py-2 text-sm shadow-lg ${
            flash.ok ? "bg-ink text-cream" : "bg-bad text-white"
          }`}
          style={{ animation: "hbUp .18s ease-out" }}
        >
          {flash.text}
        </div>
      )}
    </>
  );
}
