import Link from "next/link";
import type { SearchResult } from "@/lib/types";
import Avatar from "./Avatar";
import { fmtDate, prettyTag } from "./format";

const CARD =
  "bg-white border border-line rounded-2xl shadow-[0_1px_2px_rgba(60,50,30,.04)]";

export default function PersonCard({ entry }: { entry: SearchResult }) {
  return (
    <Link
      href={`/person/${entry.id}`}
      className={`${CARD} flex gap-3.5 p-4 text-ink transition-colors hover:border-fainter hover:text-ink`}
    >
      <Avatar id={entry.id} name={entry.display_name} hasPhoto={entry.hasPhoto} size={48} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-serif text-[17px] font-medium leading-tight">
            {entry.display_name}
          </span>
          {entry.aliases.length > 0 && (
            <span className="truncate text-xs text-faint">
              {entry.aliases.slice(0, 2).join(" · ")}
            </span>
          )}
        </div>
        {entry.location && (
          <div className="mt-0.5 truncate text-[13px] text-muted">{entry.location}</div>
        )}
        {entry.match && (
          <div className="mt-1 truncate text-[13px] italic text-ink-soft">
            “{entry.match}”
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {entry.tags.map((t) => (
            <span
              key={t}
              className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent-deeper"
            >
              {prettyTag(t)}
            </span>
          ))}
          <span className="text-xs text-faint">
            {entry.factCount > 0 &&
              `${entry.factCount} ${entry.factCount === 1 ? "fact" : "facts"}`}
            {entry.factCount > 0 && entry.lastInteraction && " · "}
            {entry.lastInteraction && `last met ${fmtDate(entry.lastInteraction)}`}
          </span>
        </div>
      </div>
    </Link>
  );
}
