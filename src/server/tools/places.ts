import { round } from "@/lib/geo/math";
import type { PlaceSummary } from "@/lib/geo/types";
import type { MapMarker } from "@/lib/map/actions";
import { z } from "zod";
import { anchorSchema, areaName, focusBounds, pickGeocode, resolveAnchor, selectedPosition, withCityHint, type ToolContext } from "./context";
import { defineTool } from "./tool";

const layerSchema = z
  .enum(["assistant-places", "landmarks"])
  .describe("Capa del mapa: assistant-places (resultados de búsqueda) o landmarks (puntos de referencia para aprender).");

export function placeForModel(p: PlaceSummary) {
  return {
    placeId: p.placeId,
    name: p.name,
    address: p.address,
    position: { lat: round(p.position.lat), lng: round(p.position.lng) },
    primaryType: p.primaryType,
    rating: p.rating,
    userRatingCount: p.userRatingCount,
    businessStatus: p.businessStatus,
  };
}

export function placeToMarker(p: PlaceSummary, layerId: string): MapMarker {
  return {
    id: `place-${p.placeId}`,
    position: p.position,
    title: p.name,
    subtitle: p.address,
    placeId: p.placeId,
    layerId,
    source: "GOOGLE_MAPS_DATA",
    note: p.businessStatus && p.businessStatus !== "OPERATIONAL" ? `Estado en Google: ${p.businessStatus}` : undefined,
  };
}

function remember(ctx: ToolContext, places: PlaceSummary[]) {
  for (const p of places) ctx.knownPlaces.set(p.placeId, p);
}

export const searchPlaces = defineTool({
  name: "search_places",
  status: "Buscando lugares en Google Maps…",
  description:
    "Busca lugares reales con Google Places (Text Search). Úsala para negocios, instituciones, puntos de referencia, " +
    "tipos de lugar ('farmacias', 'universidades', 'componentes electrónicos') o un sitio por su nombre. " +
    "Devuelve placeId, nombre, dirección y posición verificados por Google. Con showOnMap=true los coloca en el mapa.",
  schema: z.object({
    query: z.string().min(1).describe("Lo que se busca, en español natural. Ej: 'tiendas de componentes electrónicos'."),
    near: anchorSchema.default("city"),
    radiusMeters: z.number().int().min(100).max(50000).optional().describe("Radio de búsqueda cuando near es map_center o selected."),
    includedType: z.string().optional().describe("Tipo de Places API (New), p. ej. 'pharmacy', 'university', 'shopping_mall'. Opcional."),
    maxResults: z.number().int().min(1).max(20).default(10),
    showOnMap: z.boolean().default(true),
    layer: layerSchema.default("assistant-places"),
  }),
  async run(input, ctx) {
    const bias = resolveAnchor(ctx, input.near, input.radiusMeters);
    const places = await ctx.providers.places.searchText({
      query: input.query,
      includedType: input.includedType,
      maxResults: input.maxResults,
      ...bias,
    });
    remember(ctx, places);
    if (input.showOnMap && places.length > 0) {
      const markers = places.map((p) => placeToMarker(p, input.layer));
      for (const m of markers) ctx.createdFeatures.set(m.id, { kind: "marker", name: m.title });
      ctx.emit({ type: "ADD_MARKERS", markers, fit: true });
    }
    return {
      source: "GOOGLE_MAPS_DATA",
      count: places.length,
      shownOnMap: input.showOnMap,
      markerIds: input.showOnMap ? places.map((p) => `place-${p.placeId}`) : [],
      places: places.map(placeForModel),
    };
  },
});

export const getPlaceDetails = defineTool({
  name: "get_place_details",
  status: "Consultando los detalles del lugar…",
  description:
    "Detalles de un lugar de Google Places por placeId: dirección, teléfono, web, horario, valoración y resumen. " +
    "Úsala antes de afirmar cualquier dato concreto de un lugar.",
  schema: z.object({
    placeId: z.string().min(1),
    select: z.boolean().default(false).describe("Si es true, selecciona el lugar en el mapa y lo centra."),
  }),
  async run(input, ctx) {
    const d = await ctx.providers.places.getDetails(input.placeId);
    ctx.knownPlaces.set(d.placeId, d);
    if (input.select) {
      ctx.emit({ type: "ADD_MARKERS", markers: [placeToMarker(d, "assistant-places")] });
      ctx.emit({ type: "SELECT", selection: { kind: "marker", id: `place-${d.placeId}`, name: d.name, position: d.position, placeId: d.placeId } });
      ctx.emit({ type: "SET_CENTER", center: d.position, zoom: 16 });
    }
    return {
      source: "GOOGLE_MAPS_DATA",
      ...placeForModel(d),
      phone: d.phone,
      website: d.website,
      openingHours: d.openingHours,
      summary: d.summary,
      googleMapsUri: d.googleMapsUri,
      types: d.types,
    };
  },
});

export const geocode = defineTool({
  name: "geocode",
  status: "Ubicando la dirección…",
  description:
    "Convierte una dirección, intersección, sector o nombre de lugar en coordenadas con la Geocoding API de Google. " +
    "Es la única forma válida de obtener coordenadas de algo que no salió de search_places.",
  schema: z.object({
    address: z.string().min(1).describe("Dirección o nombre. Ej: 'Avenida 5 de Julio con Avenida 3H' o 'sector Tierra Negra'."),
    maxResults: z.number().int().min(1).max(5).default(3),
  }),
  async run(input, ctx) {
    const bounds = focusBounds(ctx);
    const results = await ctx.providers.geocoding.geocode(withCityHint(input.address, ctx), { bounds });
    const { insideFocus } = pickGeocode(results, bounds);
    return {
      source: "GOOGLE_MAPS_DATA",
      query: input.address,
      insideCurrentCity: insideFocus,
      results: results.slice(0, input.maxResults).map((r) => ({
        placeId: r.placeId,
        formattedAddress: r.formattedAddress,
        position: { lat: round(r.position.lat), lng: round(r.position.lng) },
        types: r.types,
        partialMatch: r.partialMatch ?? false,
        bounds: r.bounds ?? r.viewport,
      })),
      warning: results.length === 0 ? "Google no encontró esa dirección. No la ubiques por tu cuenta." : undefined,
    };
  },
});

export const reverseGeocode = defineTool({
  name: "reverse_geocode",
  status: "Identificando la zona…",
  description:
    "Dice qué hay en un punto (dirección, sector, municipio) con la Geocoding API. Usa target para el centro del mapa o lo seleccionado.",
  schema: z.object({
    target: z.enum(["map_center", "selected"]).default("selected"),
  }),
  async run(input, ctx) {
    const position = input.target === "selected" ? selectedPosition(ctx) ?? ctx.mapContext.center : ctx.mapContext.center;
    const results = await ctx.providers.geocoding.reverseGeocode(position);
    return {
      source: "GOOGLE_MAPS_DATA",
      position,
      area: areaName(results),
      addresses: results.slice(0, 4).map((r) => ({ formattedAddress: r.formattedAddress, types: r.types })),
    };
  },
});

export const showMarkers = defineTool({
  name: "show_markers",
  status: "Colocando lugares en el mapa…",
  description:
    "Muestra en el mapa lugares de Google por placeId (de search_places, get_place_details o del contexto). " +
    "No acepta coordenadas: así nunca se dibuja un lugar inventado.",
  schema: z.object({
    placeIds: z.array(z.string().min(1)).min(1).max(30),
    layer: layerSchema.default("assistant-places"),
    fit: z.boolean().default(true),
  }),
  async run(input, ctx) {
    const markers: MapMarker[] = [];
    const failed: string[] = [];
    for (const placeId of input.placeIds) {
      let place = ctx.knownPlaces.get(placeId);
      if (!place) {
        const fromMap = ctx.mapContext.visibleMarkers.find((m) => m.placeId === placeId);
        if (fromMap) place = { placeId, name: fromMap.title, position: fromMap.position };
      }
      if (!place) {
        try {
          place = await ctx.providers.places.getDetails(placeId);
          ctx.knownPlaces.set(placeId, place);
        } catch {
          failed.push(placeId);
          continue;
        }
      }
      markers.push(placeToMarker(place, input.layer));
    }
    for (const m of markers) ctx.createdFeatures.set(m.id, { kind: "marker", name: m.title });
    if (markers.length) ctx.emit({ type: "ADD_MARKERS", markers, fit: input.fit });
    return { shown: markers.map((m) => ({ markerId: m.id, name: m.title })), failed };
  },
});

export const removeMarkers = defineTool({
  name: "remove_markers",
  status: "Limpiando marcadores…",
  description: "Quita marcadores del mapa: por id de marcador, por capa o todos.",
  schema: z.object({
    markerIds: z.array(z.string()).optional(),
    layer: z.string().optional().describe("Quita todos los marcadores de esta capa."),
    all: z.boolean().default(false),
  }),
  async run(input, ctx) {
    ctx.emit({ type: "REMOVE_MARKERS", ids: input.markerIds, layerId: input.layer, all: input.all });
    return { ok: true };
  },
});
