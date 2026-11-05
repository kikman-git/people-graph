import { mapPins } from "@/lib/db";
import type { MapPin } from "@/lib/types";
import Header from "../ui/Header";
import PeopleMap from "../ui/PeopleMap";

export const dynamic = "force-dynamic";

export default function MapPage() {
  let pins: MapPin[] = [];
  let error: string | null = null;
  try {
    pins = mapPins();
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <div className="flex h-dvh flex-col">
      <Header />
      <main className="relative mt-2 min-h-0 flex-1">
        {error ? (
          <div className="mx-auto max-w-3xl px-4">
            <div className="rounded-2xl border border-line bg-bad-soft px-5 py-6 text-sm text-bad">
              People database unavailable: {error}
            </div>
          </div>
        ) : (
          <PeopleMap pins={pins} />
        )}
      </main>
    </div>
  );
}
