import { notFound } from "next/navigation";
import { peopleRefs, profile, tagsList } from "@/lib/db";
import type { Profile } from "@/lib/types";
import Header from "../../ui/Header";
import ProfileView from "../../ui/ProfileView";

export const dynamic = "force-dynamic";

export default async function PersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  let data: Profile | null = null;
  let people: { id: number; display_name: string }[] = [];
  let tags: string[] = [];
  let error: string | null = null;
  try {
    data = profile(Number(id));
    people = peopleRefs();
    tags = tagsList().map((t) => t.tag);
  } catch (e) {
    error = (e as Error).message;
  }
  if (error) {
    return (
      <>
        <Header />
        <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-4">
          <div className="rounded-2xl border border-line bg-bad-soft px-5 py-6 text-sm text-bad">
            People database unavailable: {error}
          </div>
        </main>
      </>
    );
  }
  if (!data) notFound();
  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-4">
        <ProfileView data={data} people={people} tags={tags} />
      </main>
    </>
  );
}
