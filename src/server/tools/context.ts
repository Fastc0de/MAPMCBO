import { CITIES, type City } from "@/lib/cities";
import { boundsContains, distanceMeters } from "@/lib/geo/math";
import type { Bounds, GeocodeResult, LatLng, PlaceSummary } from "@/lib/geo/types";
import type { UIAction } from "@/lib/map/actions";
import type { MapContext } from "@/lib/map/state";
import type { ProgressState } from "@/lib/learning/progress";
import type { Providers, Waypoint } from "@/server/providers/types";
import { z } from "zod";

/** Todo lo que una herramienta necesita para ejecutarse en un turno del agente. */
export interface ToolContext {
  providers: Providers;
  mapContext: MapContext;
  progress: ProgressState;
  /** Emite una acción para la interfaz (se aplica en el navegador). */
  emit: (action: UIAction) => void;
  /** Lugares devueltos por Google en este turno, por placeId. */
  knownPlaces: Map<string, PlaceSummary>;
  /** ids de elementos dibujados en este turno (además de los del MapContext). */
  createdFeatures: Map<string, { kind: "road" | "area" | "marker"; name: string }>;
  /** URLs que devolvió web_search en este turno: las únicas que read_web_page puede abrir. */
  webUrls: Set<string>;
  newId: (prefix: string) => string;
}

export function makeIdGenerator(seed = Date.now()) {
  let n = 0;
  const base = seed.toString(36);
  return (prefix: string) => `${prefix}-${base}-${++n}`;
}

/** Ciudad en la que está centrado el mapa, si alguna. */
export function currentCity(ctx: Pick<ToolContext, "mapContext">): City | undefined {
  const c = ctx.mapContext.center;
  return CITIES.find((city) => boundsContains(city.bounds, c));
}

/** Rectángulo donde tiene sentido buscar: la ciudad actual o, si no, la zona visible. */
export function focusBounds(ctx: Pick<ToolContext, "mapContext">): Bounds | undefined {
  return currentCity(ctx)?.bounds ?? ctx.mapContext.bounds;
}

/** Añade la ciudad y el estado a una consulta para que Google no la resuelva en otro país o ciudad. */
export function withCityHint(query: string, ctx: Pick<ToolContext, "mapContext">): string {
  const city = currentCity(ctx);
  if (!city) return `${query}, Venezuela`;
  const q = query.toLowerCase();
  if (q.includes(city.name.toLowerCase()) || q.includes("venezuela")) return query;
  return `${query}, ${city.name}, ${city.state}, Venezuela`;
}

export const anchorSchema = z
  .enum(["map_center", "selected", "visible_area", "city", "none"])
  .describe(
    "Respecto a qué buscar: map_center (centro del mapa), selected (lugar/vía/zona seleccionada), visible_area (lo que se ve), city (la ciudad actual), none (sin sesgo).",
  );
export type Anchor = z.infer<typeof anchorSchema>;

/** Punto de referencia del elemento seleccionado, si tiene posición conocida. */
export function selectedPosition(ctx: Pick<ToolContext, "mapContext">): LatLng | undefined {
  const m = ctx.mapContext;
  if (m.selectedPlace?.position) return m.selectedPlace.position;
  if (m.selectedPoint) return m.selectedPoint;
  const featureId = m.selectedRoad?.id ?? m.selectedArea?.id;
  if (featureId) {
    const f = m.highlightedFeatures.find((h) => h.id === featureId);
    if (f?.samplePath?.length) return f.samplePath[Math.floor(f.samplePath.length / 2)];
    if (f?.bounds) return { lat: (f.bounds.south + f.bounds.north) / 2, lng: (f.bounds.west + f.bounds.east) / 2 };
  }
  return undefined;
}

/** Radio aproximado de la zona visible, en metros. */
export function visibleRadius(ctx: Pick<ToolContext, "mapContext">): number {
  const b = ctx.mapContext.bounds;
  if (!b) return 3000;
  return Math.max(300, Math.min(50_000, distanceMeters({ lat: b.south, lng: b.west }, { lat: b.north, lng: b.east }) / 2));
}

export type LocationBias =
  | { near: { center: LatLng; radiusMeters: number } }
  | { within: Bounds }
  | Record<string, never>;

export function resolveAnchor(ctx: Pick<ToolContext, "mapContext">, anchor: Anchor, radiusMeters?: number): LocationBias {
  switch (anchor) {
    case "map_center":
      return { near: { center: ctx.mapContext.center, radiusMeters: radiusMeters ?? visibleRadius(ctx) } };
    case "selected": {
      const p = selectedPosition(ctx);
      if (p) return { near: { center: p, radiusMeters: radiusMeters ?? 1500 } };
      return { near: { center: ctx.mapContext.center, radiusMeters: radiusMeters ?? visibleRadius(ctx) } };
    }
    case "visible_area":
      return ctx.mapContext.bounds ? { within: ctx.mapContext.bounds } : {};
    case "city": {
      const b = focusBounds(ctx);
      return b ? { within: b } : {};
    }
    case "none":
      return {};
  }
}

/* ---------- Puntos de ruta ---------- */

export const waypointSchema = z
  .object({
    placeId: z.string().optional().describe("placeId de Google obtenido con search_places o del contexto del mapa."),
    address: z
      .string()
      .optional()
      .describe("Nombre o dirección del lugar, tal como lo diría una persona. Se completa con la ciudad actual."),
    use: z
      .enum(["selected", "map_center"])
      .optional()
      .describe("Usar el elemento seleccionado o el centro del mapa."),
  })
  .describe("Indica exactamente uno: placeId, address o use. Nunca pases coordenadas inventadas.");
export type WaypointInput = z.infer<typeof waypointSchema>;

export function resolveWaypoint(ctx: Pick<ToolContext, "mapContext">, w: WaypointInput): Waypoint {
  if (w.placeId) return { placeId: w.placeId };
  if (w.use === "selected") {
    const sel = ctx.mapContext.selectedPlace;
    if (sel?.placeId) return { placeId: sel.placeId };
    const p = selectedPosition(ctx);
    if (p) return { position: p };
    throw new Error("No hay nada seleccionado en el mapa.");
  }
  if (w.use === "map_center") return { position: ctx.mapContext.center };
  if (w.address) return { address: withCityHint(w.address, ctx) };
  throw new Error("El punto de ruta necesita placeId, address o use.");
}

/** Elige el mejor resultado de geocodificación dentro de la zona de interés. */
export function pickGeocode(
  results: GeocodeResult[],
  bounds: Bounds | undefined,
  preferTypes: string[] = [],
): { result?: GeocodeResult; insideFocus: boolean } {
  if (results.length === 0) return { insideFocus: false };
  const inside = bounds ? results.filter((r) => boundsContains(expand(bounds, 0.05), r.position)) : results;
  const pool = inside.length > 0 ? inside : results;
  const preferred = pool.find((r) => r.types.some((t) => preferTypes.includes(t)));
  return { result: preferred ?? pool[0], insideFocus: inside.length > 0 || !bounds };
}

export function expand(b: Bounds, deg: number): Bounds {
  return { south: b.south - deg, west: b.west - deg, north: b.north + deg, east: b.east + deg };
}

/** Nombre corto de zona a partir de una geocodificación inversa. */
export function areaName(results: GeocodeResult[]): string | undefined {
  const order = ["neighborhood", "sublocality_level_1", "sublocality", "administrative_area_level_3", "locality"];
  for (const type of order) {
    for (const r of results) {
      const comp = r.components.find((c) => c.types.includes(type));
      if (comp) {
        const city = r.components.find((c) => c.types.includes("locality"))?.name;
        return city && city !== comp.name ? `${comp.name}, ${city}` : comp.name;
      }
    }
  }
  return results[0]?.formattedAddress;
}
