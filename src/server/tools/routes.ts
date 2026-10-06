import { boundsContains, round } from "@/lib/geo/math";
import type { LatLng, RouteResult, TransitStop, TransitSegment } from "@/lib/geo/types";
import { z } from "zod";
import { expand, focusBounds, pickGeocode, resolveWaypoint, waypointSchema, withCityHint, type ToolContext } from "./context";
import { defineTool } from "./tool";

const MODE_LABEL: Record<string, string> = {
  DRIVE: "en carro",
  WALK: "a pie",
  BICYCLE: "en bicicleta",
  TWO_WHEELER: "en moto",
  TRANSIT: "en transporte público",
};

function routeForModel(route: RouteResult) {
  return {
    distanceKm: route.distanceMeters ? Math.round(route.distanceMeters / 100) / 10 : undefined,
    durationMinutes: route.durationSeconds ? Math.round(route.durationSeconds / 60) : undefined,
    description: route.description,
    // Las instrucciones nombran las vías por las que pasa la ruta: útil para explicar conexiones.
    steps: route.steps
      .filter((s) => s.instruction || s.transit)
      .slice(0, 40)
      .map((s) => ({
        instruction: s.instruction,
        distanceMeters: s.distanceMeters,
        travelMode: s.travelMode,
        transit: s.transit,
      })),
  };
}

export const calculateRoute = defineTool({
  name: "calculate_route",
  status: "Calculando la ruta con Google…",
  description:
    "Calcula una ruta real con la Routes API de Google (carro, a pie, bici, moto o transporte público) y la dibuja en el mapa. " +
    "Devuelve distancia, duración y los pasos con los nombres de las vías, para explicar por dónde se va.",
  schema: z.object({
    origin: waypointSchema,
    destination: waypointSchema,
    travelMode: z.enum(["DRIVE", "WALK", "BICYCLE", "TWO_WHEELER", "TRANSIT"]).default("DRIVE"),
    draw: z.boolean().default(true),
    label: z.string().optional().describe("Nombre corto para la ruta en el mapa."),
  }),
  async run(input, ctx) {
    const route = await ctx.providers.routes.computeRoute({
      origin: resolveWaypoint(ctx, input.origin),
      destination: resolveWaypoint(ctx, input.destination),
      travelMode: input.travelMode,
    });
    if (!route || route.path.length < 2) {
      return {
        found: false,
        source: "GOOGLE_MAPS_DATA",
        message:
          input.travelMode === "TRANSIT"
            ? "Google no tiene una ruta de transporte público para este trayecto. Usa search_transit_information."
            : "Google no encontró una ruta entre esos puntos.",
      };
    }
    const id = ctx.newId("route");
    if (input.draw) {
      ctx.emit({
        type: "DRAW_ROUTE",
        route: {
          id,
          path: route.path,
          label: input.label ?? `Ruta ${MODE_LABEL[input.travelMode]}`,
          layerId: "routes",
          travelMode: input.travelMode,
          distanceMeters: route.distanceMeters,
          durationSeconds: route.durationSeconds,
          steps: route.steps,
          source: "GOOGLE_MAPS_DATA",
        },
        fit: true,
      });
    }
    return { found: true, routeId: id, drawn: input.draw, source: "GOOGLE_MAPS_DATA", ...routeForModel(route) };
  },
});

export const clearRoute = defineTool({
  name: "clear_route",
  status: "Quitando la ruta…",
  description: "Quita una ruta (o ruta de transporte) por id, o todas si no se indica id.",
  schema: z.object({ routeId: z.string().optional() }),
  async run(input, ctx) {
    ctx.emit({ type: "CLEAR_ROUTE", id: input.routeId });
    return { ok: true };
  },
});

export const searchTransitInformation = defineTool({
  name: "search_transit_information",
  status: "Consultando transporte público en Google…",
  description:
    "Primer paso para preguntas de transporte público: consulta a Google Routes en modo TRANSIT. " +
    "En Venezuela la cobertura de Google suele ser incompleta (por puestos, rutas de autobús locales). " +
    "Si Google no tiene datos, el resultado lo dice y entonces debes investigar con web_search y, si encuentras rutas y paradas con fuentes, " +
    "dibujarlas con show_transit_route.",
  schema: z.object({
    origin: waypointSchema,
    destination: waypointSchema,
  }),
  async run(input, ctx) {
    let route: RouteResult | null = null;
    let error: string | undefined;
    try {
      route = await ctx.providers.routes.computeRoute({
        origin: resolveWaypoint(ctx, input.origin),
        destination: resolveWaypoint(ctx, input.destination),
        travelMode: "TRANSIT",
      });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const transitSteps = route?.steps.filter((s) => s.transit) ?? [];
    if (route && transitSteps.length > 0) {
      const id = ctx.newId("transit-google");
      ctx.emit({
        type: "DRAW_ROUTE",
        route: {
          id,
          path: route.path,
          label: "Transporte público (Google)",
          layerId: "routes",
          travelMode: "TRANSIT",
          distanceMeters: route.distanceMeters,
          durationSeconds: route.durationSeconds,
          steps: route.steps,
          source: "GOOGLE_MAPS_DATA",
        },
        fit: true,
      });
      return { googleTransitAvailable: true, routeId: id, source: "GOOGLE_MAPS_DATA", ...routeForModel(route) };
    }
    return {
      googleTransitAvailable: false,
      source: "GOOGLE_MAPS_DATA",
      error,
      next:
        "Google no tiene datos de transporte para este trayecto. Busca en la web (web_search) rutas de autobuses o por puestos " +
        "que conecten origen y destino, con nombres de paradas y fuentes. Luego usa show_transit_route. " +
        "Si no encuentras fuentes fiables, dilo; no reconstruyas rutas de memoria.",
    };
  },
});

const MAX_STOPS = 15;

async function locateStop(ctx: ToolContext, name: string, hint: string | undefined): Promise<TransitStop> {
  const id = ctx.newId("stop");
  const bounds = focusBounds(ctx);
  try {
    const results = await ctx.providers.geocoding.geocode(withCityHint(hint ?? name, ctx), { bounds });
    const { result } = pickGeocode(results, bounds);
    if (!result) return { id, name, verified: false, resolution: "Google no encontró este punto." };
    if (bounds && !boundsContains(expand(bounds, 0.05), result.position)) {
      return { id, name, verified: false, resolution: `Google lo ubicó fuera de la ciudad (${result.formattedAddress}); se descarta.` };
    }
    const broad = result.types.some((t) => ["locality", "administrative_area_level_1", "administrative_area_level_2", "country"].includes(t));
    if (broad) return { id, name, verified: false, resolution: "Google solo devolvió la ciudad o el municipio, no el punto exacto." };
    return {
      id,
      name,
      position: result.position,
      verified: true,
      resolution: `${result.partialMatch ? "Coincidencia parcial: " : ""}${result.formattedAddress}`,
    };
  } catch (e) {
    return { id, name, verified: false, resolution: e instanceof Error ? e.message : "Error al geocodificar." };
  }
}

export const showTransitRoute = defineTool({
  name: "show_transit_route",
  status: "Ubicando paradas y dibujando la ruta…",
  description:
    "Dibuja una ruta de transporte público reconstruida a partir de fuentes web (o de otra fuente local que cites). " +
    "Tú das la línea, las paradas en orden y las fuentes; Google geocodifica cada parada. Las paradas que Google no pueda ubicar " +
    "quedan como no verificadas y no se dibujan. El trazado entre paradas es aproximado (calles calculadas por Google). " +
    "Nunca pases coordenadas.",
  schema: z.object({
    lineName: z.string().min(1).describe("Nombre de la ruta o línea, como aparece en la fuente."),
    vehicle: z.enum(["bus", "por_puesto", "metro", "trolebus", "tren", "teleferico", "otro"]),
    operator: z.string().optional(),
    stops: z
      .array(
        z.object({
          name: z.string().min(1).describe("Nombre de la parada o referencia tal como aparece en la fuente."),
          searchHint: z.string().optional().describe("Cómo buscarla en Google si el nombre es ambiguo. Ej: 'Plaza de la República, Maracaibo'."),
        }),
      )
      .min(2)
      .max(MAX_STOPS),
    sources: z.array(z.object({ title: z.string(), url: z.string().url() })).min(1).describe("Fuentes web donde aparece la ruta."),
    notes: z.string().optional().describe("Advertencias: fecha de la fuente, horarios no verificados, etc."),
  }),
  async run(input, ctx) {
    const stops = await Promise.all(input.stops.map((s) => locateStop(ctx, s.name, s.searchHint)));
    const verified = stops.filter((s) => s.verified && s.position);
    const segments: TransitSegment[] = [];
    for (let i = 0; i < verified.length - 1; i++) {
      const a = verified[i];
      const b = verified[i + 1];
      let path: LatLng[] = [a.position!, b.position!];
      try {
        const r = await ctx.providers.routes.computeRoute({
          origin: { position: a.position! },
          destination: { position: b.position! },
          travelMode: "DRIVE",
        });
        if (r && r.path.length > 1) path = r.path;
      } catch {
        // Si Google no traza el tramo se deja la línea recta, marcada como aproximada.
      }
      segments.push({ fromStopId: a.id, toStopId: b.id, path, approximate: true });
    }
    const id = ctx.newId("transit");
    const note =
      "Línea y paradas tomadas de fuentes web (no verificadas en Google Maps). Las posiciones de las paradas las dio Google al buscar sus nombres; " +
      "el trazado entre paradas es una aproximación por las calles." + (input.notes ? ` ${input.notes}` : "");
    if (verified.length > 0) {
      ctx.emit({
        type: "DRAW_TRANSIT_ROUTE",
        transit: {
          id,
          line: { name: input.lineName, vehicle: input.vehicle, operator: input.operator },
          stops,
          segments,
          source: "WEB_DATA",
          sourceRefs: input.sources,
          note,
        },
        fit: true,
      });
    }
    return {
      transitRouteId: verified.length > 0 ? id : undefined,
      drawn: verified.length > 0,
      source: "WEB_DATA",
      stops: stops.map((s) => ({
        name: s.name,
        verifiedByGoogle: s.verified,
        position: s.position ? { lat: round(s.position.lat), lng: round(s.position.lng) } : undefined,
        resolution: s.resolution,
      })),
      unverifiedCount: stops.length - verified.length,
      segmentsDrawn: segments.length,
      note,
    };
  },
});
