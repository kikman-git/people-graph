import { directory } from "@/lib/db";
import type { DirectoryEntry } from "@/lib/types";
import Directory from "./ui/Directory";
import Header from "./ui/Header";

export const dynamic = "force-dynamic";

export default function Page() {
  let people: DirectoryEntry[] = [];
  let error: string | null = null;
  try {
    people = directory();
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-4">
        {error ? (
          <div className="rounded-2xl border border-line bg-bad-soft px-5 py-6 text-sm text-bad">
            People database unavailable: {error}. Run{" "}
            <code className="font-semibold">people_write.py init</code> first.
          </div>
        ) : (
          <Directory initial={people} />
        )}
      </main>
    </>
  );
}
