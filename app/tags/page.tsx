import { tagsList } from "@/lib/db";
import type { TagInfo } from "@/lib/types";
import Header from "../ui/Header";
import TagsView from "../ui/TagsView";

export const dynamic = "force-dynamic";

export default function TagsPage() {
  let tags: TagInfo[] = [];
  let error: string | null = null;
  try {
    tags = tagsList();
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-4">
        <div className="mb-3 px-1">
          <h1 className="font-serif text-[22px] font-medium">Tags</h1>
          <p className="mt-0.5 text-[13px] text-muted">
            The shared vocabulary across facts. Rename to fix drift — renaming
            onto an existing tag merges them.
          </p>
        </div>
        {error ? (
          <div className="rounded-2xl border border-line bg-bad-soft px-5 py-6 text-sm text-bad">
            People database unavailable: {error}
          </div>
        ) : (
          <TagsView tags={tags} />
        )}
      </main>
    </>
  );
}
