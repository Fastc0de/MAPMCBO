"use client";

import { useState } from "react";
import type { Bounds, LatLng, PlaceSummary } from "@/lib/geo/types";

interface Props {
  bounds?: Bounds;
  center: LatLng;
  onResults: (places: PlaceSummary[], query: string) => void;
  onPick: (place: PlaceSummary) => void;
}

/** Buscador de lugares (Places API vía /api/places/search), sesgado a lo que se ve en el mapa. */
export function SearchBar({ bounds, center, onResults, onPick }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/places/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, bounds, center }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error en la búsqueda");
      setResults(data.places);
      onResults(data.places, q);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error en la búsqueda");
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full rounded-xl border border-border bg-panel shadow-lg">
      <form
        className="flex items-center gap-2 px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <span aria-hidden className="text-muted">⌕</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar lugares: farmacias, universidades, un sitio…"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
        {results && (
          <button
            type="button"
            onClick={() => {
              setResults(null);
              setQuery("");
            }}
            className="text-xs text-muted"
          >
            Cerrar
          </button>
        )}
        <button type="submit" disabled={loading} className="rounded-md bg-accent px-2 py-1 text-xs font-medium text-white disabled:opacity-50">
          {loading ? "…" : "Buscar"}
        </button>
      </form>
      {error && <p className="border-t border-border px-3 py-2 text-xs text-red-600">{error}</p>}
      {results && (
        <ul className="scroll-thin max-h-72 overflow-y-auto border-t border-border text-sm">
          {results.length === 0 && <li className="px-3 py-2 text-muted">Google no encontró resultados en esta zona.</li>}
          {results.map((p) => (
            <li key={p.placeId}>
              <button onClick={() => onPick(p)} className="w-full px-3 py-2 text-left hover:bg-black/5 dark:hover:bg-white/5">
                <span className="block font-medium">{p.name}</span>
                <span className="block truncate text-xs text-muted">{p.address}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
