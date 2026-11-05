"use client";
// Small click-to-set-location map for the person edit dialog — the fallback
// when geocoding misses (PLAN.md §6). Leaflet loads client-side only.
import { useEffect, useRef } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";

export const TILE_URL = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
export const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
const TOKYO: [number, number] = [35.681, 139.767];

export async function loadLeaflet(): Promise<typeof Leaflet> {
  const mod = await import("leaflet");
  return ((mod as { default?: typeof Leaflet }).default ?? mod) as typeof Leaflet;
}

export function pinIcon(L: typeof Leaflet): Leaflet.DivIcon {
  return L.divIcon({
    className: "",
    html: '<div class="pin-dot"></div>',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

export default function MapPicker({
  lat, lng, onPick,
}: {
  lat: number | null;
  lng: number | null;
  onPick: (lat: number, lng: number) => void;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const markerRef = useRef<Leaflet.Marker | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  const place = (at: [number, number]) => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    if (markerRef.current) markerRef.current.setLatLng(at);
    else markerRef.current = L.marker(at, { icon: pinIcon(L) }).addTo(map);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = await loadLeaflet();
      if (cancelled || !divRef.current || mapRef.current) return;
      LRef.current = L;
      const has = lat != null && lng != null;
      const map = L.map(divRef.current).setView(has ? [lat!, lng!] : TOKYO, has ? 12 : 9);
      L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map);
      mapRef.current = map;
      if (has) place([lat!, lng!]);
      map.on("click", (e: Leaflet.LeafletMouseEvent) => {
        const p: [number, number] = [
          Math.round(e.latlng.lat * 1e6) / 1e6,
          Math.round(e.latlng.lng * 1e6) / 1e6,
        ];
        place(p);
        onPickRef.current(p[0], p[1]);
      });
      setTimeout(() => map.invalidateSize(), 0); // the modal has just opened
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Geocode button (or cleared fields) moved the point from outside.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || lat == null || lng == null) return;
    place([lat, lng]);
    map.setView([lat, lng], Math.max(map.getZoom(), 11));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  return (
    <div
      ref={divRef}
      className="map-paper h-52 w-full rounded-xl border border-line"
      aria-label="Click the map to set this person's location"
    />
  );
}
