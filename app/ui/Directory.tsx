"use client";
// Home = one search box over the whole graph (names, aliases, facts, history)
// + the directory, recently-updated first. Complex questions belong to the
// Telegram bot; this screen is for finding a person fast.
import { useEffect, useRef, useState } from "react";
import type { DirectoryEntry, SearchResult } from "@/lib/types";
import PersonCard from "./PersonCard";

export default function Directory({ initial }: { initial: DirectoryEntry[] }) {
  const all: SearchResult[] = initial.map((e) => ({ ...e, match: null }));
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>(all);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const cur = ++seq.current;
    const query = q.trim();
    if (!query) {
      setResults(all);
      setError(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          cache: "no-store",
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || res.statusText);
        if (seq.current === cur) {
          setResults(j.results);
          setError(null);
        }
      } catch (e) {
        if (seq.current === cur) setError((e as Error).message || "Search failed");
      }
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search people, facts, history…"
        autoFocus
        className="w-full rounded-2xl border border-line bg-white px-4 py-3 text-[15px] outline-none placeholder:text-fainter focus:border-fainter"
      />
      <div className="mb-3 mt-2 px-1 text-[13px] text-faint">
        {error
          ? <span className="text-bad">{error}</span>
          : q.trim()
            ? `${results.length} ${results.length === 1 ? "match" : "matches"}`
            : `${results.length} ${results.length === 1 ? "person" : "people"}`}
      </div>

      {results.length === 0 && !error && (
        <div className="rounded-2xl border border-line bg-surface px-5 py-10 text-center text-sm text-muted">
          {q.trim()
            ? "Nothing in the graph matches that."
            : "The graph is empty. Tell the Telegram bot about someone — they'll show up here."}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {results.map((e) => (
          <PersonCard key={e.id} entry={e} />
        ))}
      </div>
    </div>
  );
}
