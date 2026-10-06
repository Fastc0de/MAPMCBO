import { describe, expect, it } from "vitest";
import { createQuiz, createLesson } from "@/server/tools/learning";
import { highlightArea, highlightRoad, setMapView } from "@/server/tools/map";
import { getPlaceDetails, searchPlaces, showMarkers } from "@/server/tools/places";
import { calculateRoute, searchTransitInformation, showTransitRoute } from "@/server/tools/routes";
import { TOOLS } from "@/server/tools/registry";
import { toInputSchema } from "@/server/tools/tool";
import { BELLA_VISTA, fakeProviders, geocodeResult, mapContextAtMaracaibo, toolContext } from "./fakes";

const run = <T extends (typeof TOOLS)[number]>(tool: T, input: unknown, ctx: ReturnType<typeof toolContext>) =>
  tool.run(tool.schema.parse(input), ctx) as Promise<Record<string, unknown>>;

describe("registro de herramientas", () => {
  it("nombres únicos y esquemas de tipo object para la API de Claude", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of TOOLS) {
      const schema = toInputSchema(t.schema);
      expect(schema.type).toBe("object");
      expect(schema).not.toHaveProperty("$schema");
    }
    for (const required of ["search_places", "get_place_details", "geocode", "reverse_geocode", "calculate_route", "search_transit_information", "show_markers", "remove_markers", "clear_route", "highlight_road", "highlight_area", "get_map_context", "create_lesson", "create_quiz", "save_learning_progress", "get_learning_progress"]) {
      expect(names).toContain(required);
    }
  });

  it("ninguna herramienta acepta coordenadas del modelo", () => {
    for (const t of TOOLS) {
      const json = JSON.stringify(toInputSchema(t.schema));
      expect(json, t.name).not.toMatch(/"(lat|lng|latitude|longitude)"/);
    }
  });
});

describe("search_places", () => {
  it("busca con sesgo y coloca marcadores de Google", async () => {
    const { providers, log } = fakeProviders();
    const ctx = toolContext(providers);
    const out = await run(searchPlaces, { query: "centros comerciales" }, ctx);
    expect(out.source).toBe("GOOGLE_MAPS_DATA");
    expect(log.textSearches[0]).toMatchObject({ query: "centros comerciales", within: expect.any(Object) });
    expect(ctx.actions[0]).toMatchObject({ type: "ADD_MARKERS", fit: true });
    expect(ctx.knownPlaces.get(BELLA_VISTA.placeId)).toBeDefined();
  });

  it("near=selected busca alrededor de la vía seleccionada", async () => {
    const { providers, log } = fakeProviders();
    const ctx = toolContext(
      providers,
      mapContextAtMaracaibo({
        selectedRoad: { id: "road-1", name: "Avenida de prueba" },
        highlightedFeatures: [
          {
            id: "road-1",
            kind: "road",
            name: "Avenida de prueba",
            label: "Avenida de prueba",
            hiddenName: false,
            samplePath: [
              { lat: 10.7, lng: -71.6 },
              { lat: 10.71, lng: -71.6 },
              { lat: 10.72, lng: -71.6 },
            ],
            source: "GOOGLE_MAPS_DATA",
          },
        ],
      }),
    );
    await run(searchPlaces, { query: "restaurantes", near: "selected", radiusMeters: 800 }, ctx);
    expect(log.textSearches[0]).toMatchObject({ near: { center: { lat: 10.71, lng: -71.6 }, radiusMeters: 800 } });
  });
});

describe("show_markers", () => {
  it("resuelve placeIds conocidos o con Place Details; nunca coordenadas", async () => {
    const { providers } = fakeProviders();
    const ctx = toolContext(providers);
    const out = await run(showMarkers, { placeIds: [BELLA_VISTA.placeId, "desconocido"] }, ctx);
    expect(out.failed).toEqual(["desconocido"]);
    expect(ctx.actions[0]).toMatchObject({ type: "ADD_MARKERS", markers: [expect.objectContaining({ placeId: BELLA_VISTA.placeId })] });
  });

  it("get_place_details con select centra y selecciona", async () => {
    const { providers } = fakeProviders();
    const ctx = toolContext(providers);
    const out = await run(getPlaceDetails, { placeId: BELLA_VISTA.placeId, select: true }, ctx);
    expect(out.phone).toBe("0261-0000000");
    expect(ctx.actions.map((a) => a.type)).toEqual(["ADD_MARKERS", "SELECT", "SET_CENTER"]);
  });
});

describe("highlight_road / highlight_area", () => {
  it("con from/to traza el tramo con Routes y añade la ciudad a la consulta", async () => {
    const { providers, log } = fakeProviders();
    const ctx = toolContext(providers);
    const out = await run(highlightRoad, { roadName: "Avenida de prueba", from: "Avenida de prueba con Calle 1", to: "Avenida de prueba con Calle 9" }, ctx);
    expect(out.traced).toBe(true);
    expect(log.geocodes[0]).toBe("Avenida de prueba, Maracaibo, Zulia, Venezuela");
    expect(log.routes[0]).toMatchObject({ travelMode: "DRIVE", origin: { address: "Avenida de prueba con Calle 1, Maracaibo, Zulia, Venezuela" } });
    expect(ctx.actions[0]).toMatchObject({ type: "HIGHLIGHT_ROAD", highlight: { kind: "road", layerId: "roads", source: "GOOGLE_MAPS_DATA" } });
    expect(ctx.createdFeatures.has(out.highlightId as string)).toBe(true);
  });

  it("si Google no la encuentra, no dibuja nada", async () => {
    const { providers } = fakeProviders({ geocode: () => [] });
    const ctx = toolContext(providers);
    const out = await run(highlightRoad, { roadName: "Avenida Inventada" }, ctx);
    expect(out.found).toBe(false);
    expect(ctx.actions).toHaveLength(0);
  });

  it("highlight_area usa los límites de Google y lo avisa", async () => {
    const bounds = { south: 10.62, west: -71.64, north: 10.64, east: -71.62 };
    const { providers } = fakeProviders({ geocode: () => [geocodeResult({ lat: 10.63, lng: -71.63 }, ["neighborhood"], { bounds })] });
    const ctx = toolContext(providers);
    const out = await run(highlightArea, { areaName: "Sector de prueba", hideName: true, anonymousLabel: "B" }, ctx);
    expect(out.note).toMatch(/aproximados/);
    expect(ctx.actions[0]).toMatchObject({ type: "HIGHLIGHT_AREA", highlight: { bounds, label: "Zona B", hiddenName: true } });
  });

  it("prefiere resultados dentro de la ciudad", async () => {
    const { providers } = fakeProviders({
      geocode: () => [
        geocodeResult({ lat: 10.48, lng: -66.9 }, ["route"], { formattedAddress: "Caracas" }),
        geocodeResult({ lat: 10.66, lng: -71.62 }, ["route"], { formattedAddress: "Maracaibo" }),
      ],
    });
    const ctx = toolContext(providers);
    const out = await run(highlightRoad, { roadName: "Avenida de prueba" }, ctx);
    expect(out.googleMatch).toBe("Maracaibo");
    expect(out.insideCurrentCity).toBe(true);
  });
});

describe("rutas y transporte", () => {
  it("calculate_route dibuja la ruta de Google", async () => {
    const { providers } = fakeProviders();
    const ctx = toolContext(providers, mapContextAtMaracaibo({ selectedPlace: { placeId: "pid-sel", name: "Sel" } }));
    const out = await run(calculateRoute, { origin: { use: "selected" }, destination: { address: "Plaza de prueba" }, travelMode: "WALK" }, ctx);
    expect(out).toMatchObject({ found: true, durationMinutes: 7, distanceKm: 2.5 });
    expect(ctx.actions[0]).toMatchObject({ type: "DRAW_ROUTE", route: { travelMode: "WALK", source: "GOOGLE_MAPS_DATA" } });
  });

  it("search_transit_information sin datos de Google pide investigar en la web", async () => {
    const { providers } = fakeProviders({ route: () => null });
    const ctx = toolContext(providers);
    const out = await run(searchTransitInformation, { origin: { address: "A" }, destination: { address: "B" } }, ctx);
    expect(out.googleTransitAvailable).toBe(false);
    expect(out.next).toMatch(/web_search/);
    expect(ctx.actions).toHaveLength(0);
  });

  it("show_transit_route: Google ubica las paradas; las que no ubica quedan sin verificar", async () => {
    const { providers } = fakeProviders({
      geocode: (q) => {
        if (q.startsWith("Parada fantasma")) return [];
        if (q.startsWith("Parada lejana")) return [geocodeResult({ lat: 8.6, lng: -71.15 }, ["bus_station"])];
        if (q.startsWith("Parada A")) return [geocodeResult({ lat: 10.64, lng: -71.62 }, ["bus_station"])];
        return [geocodeResult({ lat: 10.66, lng: -71.6 }, ["bus_station"])];
      },
    });
    const ctx = toolContext(providers);
    const out = await run(
      showTransitRoute,
      {
        lineName: "Ruta de prueba",
        vehicle: "por_puesto",
        stops: [{ name: "Parada A" }, { name: "Parada fantasma" }, { name: "Parada lejana" }, { name: "Parada B" }],
        sources: [{ title: "Fuente", url: "https://example.com/ruta" }],
      },
      ctx,
    );
    expect(out.unverifiedCount).toBe(2);
    const action = ctx.actions[0];
    expect(action.type).toBe("DRAW_TRANSIT_ROUTE");
    if (action.type !== "DRAW_TRANSIT_ROUTE") return;
    expect(action.transit.source).toBe("WEB_DATA");
    expect(action.transit.stops.filter((s) => s.verified)).toHaveLength(2);
    expect(action.transit.stops.find((s) => s.name === "Parada fantasma")?.position).toBeUndefined();
    expect(action.transit.segments).toHaveLength(1);
    expect(action.transit.segments[0].approximate).toBe(true);
  });
});

describe("aprendizaje", () => {
  it("create_quiz valida los ids del mapa y oculta sus nombres", async () => {
    const { providers } = fakeProviders();
    const ctx = toolContext(providers);
    ctx.createdFeatures.set("road-a", { kind: "road", name: "Avenida 1" });
    ctx.createdFeatures.set("road-b", { kind: "road", name: "Avenida 2" });
    await run(
      createQuiz,
      {
        title: "Avenidas",
        topicId: "mcbo-corredores",
        questions: [
          { kind: "identify_feature", prompt: "¿Cuál es la Avenida 1?", featureIds: ["road-a", "road-b"], correctFeatureId: "road-a" },
          { kind: "locate", prompt: "Encuentra la Avenida 2", target: { featureId: "road-b" } },
          { kind: "locate", prompt: "Encuentra el centro comercial", target: { placeId: BELLA_VISTA.placeId } },
        ],
      },
      ctx,
    );
    expect(ctx.actions[0]).toEqual({ type: "SET_FEATURE_LABELS", labels: { "road-a": "A", "road-b": "B" } });
    const start = ctx.actions[1];
    expect(start.type).toBe("START_QUIZ");
    if (start.type !== "START_QUIZ") return;
    expect(start.quiz.questions[1]).toMatchObject({ kind: "locate", target: { featureId: "road-b", name: "Avenida 2" }, toleranceMeters: 150 });
    expect(start.quiz.questions[2]).toMatchObject({ target: { position: BELLA_VISTA.position } });
  });

  it("create_quiz rechaza elementos que no están en el mapa", async () => {
    const { providers } = fakeProviders();
    const ctx = toolContext(providers);
    await expect(
      run(createQuiz, { title: "x", topicId: "mcbo-corredores", questions: [{ kind: "identify_feature", prompt: "?", featureIds: ["nope-1", "nope-2"], correctFeatureId: "nope-1" }] }, ctx),
    ).rejects.toThrow(/no están en el mapa/);
  });

  it("create_lesson muestra la lección y marca el tema como estudiado", async () => {
    const { providers } = fakeProviders();
    const ctx = toolContext(providers);
    await run(createLesson, { title: "Intersecciones", topicId: "intersecciones", sections: [{ heading: "Redomas", body: "…" }] }, ctx);
    expect(ctx.actions.map((a) => a.type)).toEqual(["SHOW_LESSON", "UPDATE_PROGRESS"]);
  });

  it("set_map_view a Venezuela encuadra el país", async () => {
    const { providers } = fakeProviders();
    const ctx = toolContext(providers);
    await run(setMapView, { target: { venezuela: true } }, ctx);
    expect(ctx.actions[0].type).toBe("FIT_BOUNDS");
  });
});
