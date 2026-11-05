"use client";
// The headline screen: everyone with coordinates on one full-viewport map.
// Browse-first ("I'm in Osaka — who's around?"): the search box filters pins
// live by name, alias, location or tag; a pin opens a mini card → profile.
import { useEffect, useMemo, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import type { MapPin } from "@/lib/types";
import { initials, prettyTag } from "./format";
import { TILE_ATTR, TILE_URL, loadLeaflet, pinIcon } from "./MapPicker";
import "leaflet/dist/leaflet.css";

// Popup content is built with DOM APIs (textContent, never innerHTML with
// data) so stored strings can't inject markup.
function popupEl(p: MapPin): HTMLElement {
  const root = document.createElement("div");
  root.className = "flex gap-2.5";
  let avatar: HTMLElement;
  if (p.hasPhoto) {
    const img = document.createElement("img");
    img.src = `/api/photo/${p.id}`;
    img.alt = "";
    img.className = "h-10 w-10 shrink-0 rounded-full border border-line object-cover";
    avatar = img;
  } else {
    avatar = document.createElement("div");
    avatar.className =
      "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-wash font-serif text-muted";
    avatar.textContent = initials(p.display_name);
  }
  root.appendChild(avatar);

  const body = document.createElement("div");
  body.className = "min-w-0";
  const link = document.createElement("a");
  link.href = `/person/${p.id}`;
  link.className = "font-serif text-[15px] font-medium leading-tight";
  link.textContent = p.display_name;
  body.appendChild(link);
  if (p.location) {
    const loc = document.createElement("div");
    loc.className = "mt-0.5 text-xs text-muted";
    loc.textContent = p.location;
    body.appendChild(loc);
  }
  if (p.facts.length) {
    const ul = document.createElement("ul");
    ul.className = "mt-1.5 flex flex-col gap-0.5";
    for (const f of p.facts) {
      const li = document.createElement("li");
      li.className = "text-xs text-ink-soft";
      li.textContent = f;
      ul.appendChild(li);
    }
    body.appendChild(ul);
  }
  if (p.tags.length) {
    const tags = document.createElement("div");
    tags.className = "mt-1.5 flex flex-wrap gap-1";
    for (const t of p.tags) {
      const chip = document.createElement("span");
      chip.className = "rounded-full bg-accent-soft px-1.5 py-0.5 text-[11px] text-accent-deeper";
      chip.textContent = prettyTag(t);
      tags.appendChild(chip);
    }
    body.appendChild(tags);
  }
  root.appendChild(body);
  return root;
}

export default function PeopleMap({ pins }: { pins: MapPin[] }) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const groupRef = useRef<Leaflet.LayerGroup | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const [q, setQ] = useState("");
  const [ready, setReady] = useState(false);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return pins;
    return pins.filter((p) =>
      [p.display_name, p.location ?? "", ...p.aliases, ...p.tags].some((t) =>
        t.toLowerCase().includes(s)
      )
    );
  }, [q, pins]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = await loadLeaflet();
      if (cancelled || !divRef.current || mapRef.current) return;
      LRef.current = L;
      const map = L.map(divRef.current);
      L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map);
      groupRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      if (pins.length) {
        const b = L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number]));
        map.fitBounds(b.pad(0.2), { maxZoom: 12 });
      } else {
        map.setView([35.681, 139.767], 10);
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      groupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const L = LRef.current;
    const group = groupRef.current;
    if (!ready || !L || !group) return;
    group.clearLayers();
    for (const p of shown) {
      L.marker([p.lat, p.lng], { icon: pinIcon(L), title: p.display_name })
        .bindPopup(() => popupEl(p), { minWidth: 200, maxWidth: 260 })
        .addTo(group);
    }
  }, [ready, shown]);

  return (
    <div className="relative h-full w-full">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[1000] flex flex-col items-center p-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter the map — name, tag, place…"
          className="pointer-events-auto w-full max-w-md rounded-2xl border border-line bg-white/95 px-4 py-2.5 text-sm shadow-[0_2px_10px_rgba(60,50,30,.12)] outline-none placeholder:text-fainter focus:border-fainter"
        />
        {q.trim() && (
          <div className="pointer-events-auto mt-1.5 rounded-full bg-white/90 px-3 py-1 text-xs text-muted">
            {shown.length} of {pins.length} shown
          </div>
        )}
      </div>
      {pins.length === 0 && (
        <div className="absolute inset-0 z-[999] flex items-center justify-center p-4">
          <div className="max-w-sm rounded-2xl border border-line bg-surface/95 px-5 py-4 text-center text-sm text-muted shadow-[0_2px_10px_rgba(60,50,30,.12)]">
            No one has a location yet. Tell the bot where people live, or set a
            pin from a profile's Edit dialog.
          </div>
        </div>
      )}
      <div ref={divRef} className="map-paper h-full w-full" />
    </div>
  );
}
