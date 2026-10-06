import { findCity, VENEZUELA } from "@/lib/cities";
import { boundsCenter, cardinalDirection, round, samplePath } from "@/lib/geo/math";
import type { LatLng } from "@/lib/geo/types";
import type { MapHighlight } from "@/lib/map/actions";
import { z } from "zod";
import { areaName, focusBounds, pickGeocode, resolveWaypoint, withCityHint } from "./context";
import { defineTool } from "./tool";

export const getMapContext = defineTool({
  name: "get_map_context",
  status: "Mirando el mapa…",
  description:
    "Devuelve el estado actual del mapa (centro, zoom, zona, selección, marcadores, rutas y resaltados) y el nombre " +
    "del sector bajo el centro según Google. El contexto básico ya viene en cada mensaje; úsala si necesitas la zona exacta.",
  schema: z.object({}),
  async run(_input, ctx) {
    let area: string | undefined;
    try {
      area = areaName(await ctx.providers.geocoding.reverseGeocode(ctx.mapContext.center));
    } catch {
      area = ctx.mapContext.currentArea;
    }
    return { ...ctx.mapContext, currentArea: area, currentAreaSource: "GOOGLE_MAPS_DATA" };
  },
});

export const setMapView = defineTool({
  name: "set_map_view",
  status: "Moviendo el mapa…",
  description:
    "Mueve la cámara: a Venezuela completa, a una ciudad configurada (maracaibo, caracas, valencia, barquisimeto, merida, puerto-la-cruz), " +
    "a un lugar por placeId o a una dirección geocodificada por Google. También cambia el zoom (3 = continente, 6 = país, 12 = ciudad, 15 = barrio, 18 = calle).",
  schema: z.object({
    target: z
      .object({
        venezuela: z.boolean().optional(),
        city: z.string().optional(),
        placeId: z.string().optional(),
        address: z.string().optional(),
      })
      .optional()
      .describe("Indica uno. Si se omite, solo cambia el zoom."),
    zoom: z.number().min(3).max(21).optional(),
  }),
  async run(input, ctx) {
    const t = input.target;
    if (!t) {
      if (input.zoom === undefined) throw new Error("Indica target o zoom.");
      ctx.emit({ type: "SET_ZOOM", zoom: input.zoom });
      return { ok: true, zoom: input.zoom };
    }
    if (t.venezuela) {
      ctx.emit({ type: "FIT_BOUNDS", bounds: VENEZUELA.bounds });
      return { ok: true, target: "Venezuela" };
    }
    if (t.city) {
      const city = findCity(t.city);
      if (!city) throw new Error(`Ciudad no configurada: ${t.city}. Usa address para otras ciudades.`);
      ctx.emit({ type: "SET_CENTER", center: city.center, zoom: input.zoom ?? city.zoom });
      return { ok: true, target: city.name };
    }
    if (t.placeId) {
      const d = ctx.knownPlaces.get(t.placeId) ?? (await ctx.providers.places.getDetails(t.placeId));
      ctx.emit({ type: "SET_CENTER", center: d.position, zoom: input.zoom ?? 16 });
      return { ok: true, target: d.name, source: "GOOGLE_MAPS_DATA" };
    }
    if (t.address) {
      const results = await ctx.providers.geocoding.geocode(withCityHint(t.address, ctx), { bounds: focusBounds(ctx) });
      const { result } = pickGeocode(results, focusBounds(ctx));
      if (!result) return { ok: false, error: "Google no encontró esa dirección." };
      const box = result.bounds ?? result.viewport;
      if (box && input.zoom === undefined) ctx.emit({ type: "FIT_BOUNDS", bounds: box });
      else ctx.emit({ type: "SET_CENTER", center: result.position, zoom: input.zoom ?? 15 });
      return { ok: true, target: result.formattedAddress, source: "GOOGLE_MAPS_DATA" };
    }
    throw new Error("target vacío.");
  },
});

export const setBaseMap = defineTool({
  name: "set_base_map",
  status: "Cambiando la vista del mapa…",
  description:
    "Cambia el mapa base: roadmap (normal), labels-hidden (satélite sin nombres, para practicar reconocimiento de zonas) o hybrid (satélite con nombres).",
  schema: z.object({ mode: z.enum(["roadmap", "labels-hidden", "hybrid"]) }),
  async run(input, ctx) {
    ctx.emit({ type: "SET_BASE_MAP", mode: input.mode });
    return { ok: true };
  },
});

export const clearMap = defineTool({
  name: "clear_map",
  status: "Limpiando el mapa…",
  description: "Limpia lo que dibujó el asistente: todo, o solo marcadores, rutas o resaltados.",
  schema: z.object({ what: z.enum(["all", "markers", "routes", "highlights"]).default("all") }),
  async run(input, ctx) {
    if (input.what === "all") ctx.emit({ type: "CLEAR_ALL" });
    if (input.what === "markers") ctx.emit({ type: "REMOVE_MARKERS", all: true });
    if (input.what === "routes") ctx.emit({ type: "CLEAR_ROUTE" });
    if (input.what === "highlights") ctx.emit({ type: "CLEAR_HIGHLIGHTS" });
    return { ok: true };
  },
});

const ROAD_TYPES = ["route", "intersection", "street_address"];

export const highlightRoad = defineTool({
  name: "highlight_road",
  status: "Resaltando la vía…",
  description:
    "Resalta una avenida o calle real. Google ubica la vía; si das from y to (dos intersecciones o puntos de referencia por los que pasa la vía), " +
    "se traza el tramo con la Routes API siguiendo las calles. Sin from/to se marca la extensión aproximada que Google da para esa vía. " +
    "hideName=true muestra 'Vía A' en lugar del nombre (para practicar).",
  schema: z.object({
    roadName: z.string().min(1).describe("Nombre de la vía. Ej: 'Avenida Bella Vista'."),
    from: z.string().optional().describe("Inicio del tramo: intersección o referencia sobre la vía. Ej: 'Avenida Bella Vista con Calle 67'."),
    to: z.string().optional().describe("Fin del tramo."),
    hideName: z.boolean().default(false),
    anonymousLabel: z.string().max(3).optional().describe("Letra para el modo práctica, p. ej. 'A'."),
    color: z.string().optional().describe("Color CSS opcional."),
  }),
  async run(input, ctx) {
    const bounds = focusBounds(ctx);
    const results = await ctx.providers.geocoding.geocode(withCityHint(input.roadName, ctx), { bounds });
    const { result, insideFocus } = pickGeocode(results, bounds, ROAD_TYPES);
    if (!result) return { found: false, error: `Google no encontró «${input.roadName}». No la dibujes de memoria.` };

    let path: LatLng[] | undefined;
    let note: string;
    if (input.from && input.to) {
      const route = await ctx.providers.routes.computeRoute({
        origin: resolveWaypoint(ctx, { address: input.from }),
        destination: resolveWaypoint(ctx, { address: input.to }),
        travelMode: "DRIVE",
      });
      if (route && route.path.length > 1) {
        path = route.path;
        note = `Tramo trazado por Google Routes entre «${input.from}» y «${input.to}». Los extremos los propuso el asistente; verifica que el trazado sigue la vía.`;
      } else {
        note = "Google no pudo trazar el tramo; se muestra la extensión aproximada de la vía.";
      }
    } else {
      note = "Extensión aproximada de la vía según Google (rectángulo), no su trazado exacto.";
    }

    const box = result.bounds ?? result.viewport;
    if (!path && !box) path = [result.position];
    const id = ctx.newId("road");
    const name = input.roadName;
    const anon = input.hideName ? input.anonymousLabel ?? "?" : null;
    const highlight: MapHighlight = {
      id,
      kind: "road",
      name,
      label: anon ? `Vía ${anon}` : name,
      hiddenName: Boolean(anon),
      path,
      bounds: path ? undefined : box,
      color: input.color,
      layerId: "roads",
      source: "GOOGLE_MAPS_DATA",
      note,
    };
    ctx.createdFeatures.set(id, { kind: "road", name });
    ctx.emit({ type: "HIGHLIGHT_ROAD", highlight, fit: true });

    const ends = path && path.length > 1 ? { start: path[0], end: path[path.length - 1] } : undefined;
    return {
      found: true,
      highlightId: id,
      source: "GOOGLE_MAPS_DATA",
      googleMatch: result.formattedAddress,
      matchTypes: result.types,
      partialMatch: result.partialMatch ?? false,
      insideCurrentCity: insideFocus,
      traced: Boolean(path && path.length > 1),
      approximateDirection: ends ? `de ${cardinalDirection(ends.end, ends.start)} a ${cardinalDirection(ends.start, ends.end)}` : undefined,
      samplePath: path ? samplePath(path, 6).map((p) => ({ lat: round(p.lat), lng: round(p.lng) })) : undefined,
      note,
    };
  },
});

export const highlightArea = defineTool({
  name: "highlight_area",
  status: "Resaltando la zona…",
  description:
    "Resalta un sector, urbanización, barrio, parroquia o municipio que Google pueda ubicar. Se dibuja el rectángulo que Google da para esa zona " +
    "(límites aproximados, no oficiales). hideName=true muestra 'Zona A' para practicar.",
  schema: z.object({
    areaName: z.string().min(1),
    hideName: z.boolean().default(false),
    anonymousLabel: z.string().max(3).optional(),
    color: z.string().optional(),
  }),
  async run(input, ctx) {
    const bounds = focusBounds(ctx);
    const results = await ctx.providers.geocoding.geocode(withCityHint(input.areaName, ctx), { bounds });
    const { result, insideFocus } = pickGeocode(results, bounds, [
      "neighborhood",
      "sublocality",
      "sublocality_level_1",
      "administrative_area_level_3",
      "administrative_area_level_2",
      "locality",
    ]);
    if (!result) return { found: false, error: `Google no encontró «${input.areaName}».` };
    const box = result.bounds ?? result.viewport;
    if (!box) return { found: false, error: "Google no da límites para esa zona." };
    const id = ctx.newId("area");
    const anon = input.hideName ? input.anonymousLabel ?? "?" : null;
    const note = "Límites aproximados (rectángulo de Google), no los límites oficiales del sector.";
    ctx.createdFeatures.set(id, { kind: "area", name: input.areaName });
    ctx.emit({
      type: "HIGHLIGHT_AREA",
      highlight: {
        id,
        kind: "area",
        name: input.areaName,
        label: anon ? `Zona ${anon}` : input.areaName,
        hiddenName: Boolean(anon),
        bounds: box,
        color: input.color,
        layerId: "areas",
        source: "GOOGLE_MAPS_DATA",
        note,
      },
      fit: true,
    });
    const c = boundsCenter(box);
    return {
      found: true,
      highlightId: id,
      source: "GOOGLE_MAPS_DATA",
      googleMatch: result.formattedAddress,
      matchTypes: result.types,
      partialMatch: result.partialMatch ?? false,
      insideCurrentCity: insideFocus,
      center: { lat: round(c.lat), lng: round(c.lng) },
      bounds: box,
      note,
    };
  },
});

export const setFeatureLabels = defineTool({
  name: "set_feature_labels",
  status: "Ajustando etiquetas…",
  description:
    "Oculta o revela los nombres de vías, zonas o marcadores ya dibujados (por id). Pasa una letra ('A') para ocultar o null para revelar.",
  schema: z.object({
    labels: z.record(z.string(), z.string().max(3).nullable()),
  }),
  async run(input, ctx) {
    ctx.emit({ type: "SET_FEATURE_LABELS", labels: input.labels });
    return { ok: true };
  },
});

export const clearHighlights = defineTool({
  name: "clear_highlights",
  status: "Quitando resaltados…",
  description: "Quita resaltados de vías o zonas por id, o todos si no se indican ids.",
  schema: z.object({ ids: z.array(z.string()).optional() }),
  async run(input, ctx) {
    ctx.emit({ type: "CLEAR_HIGHLIGHTS", ids: input.ids });
    return { ok: true };
  },
});
