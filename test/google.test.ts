import { describe, expect, it, vi } from "vitest";
import { createGoogleProviders } from "@/server/providers/google";
import { ProviderError } from "@/server/providers/types";

function mockFetch(responses: unknown[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const body = responses.shift();
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

describe("Places API (New)", () => {
  it("searchText envía la máscara de campos, el idioma y el sesgo de ubicación", async () => {
    const { fetch, calls } = mockFetch([
      {
        places: [
          { id: "abc", displayName: { text: "Farmacia X" }, formattedAddress: "Calle 1", location: { latitude: 10.6, longitude: -71.6 }, types: ["pharmacy"] },
          { id: "sin-ubicacion", displayName: { text: "Sin ubicación" } },
        ],
      },
    ]);
    const { places } = createGoogleProviders("KEY", fetch);
    const result = await places.searchText({ query: "farmacias", near: { center: { lat: 10.6, lng: -71.6 }, radiusMeters: 1000 }, maxResults: 5 });

    expect(calls[0].url).toBe("https://places.googleapis.com/v1/places:searchText");
    const headers = calls[0].init!.headers as Record<string, string>;
    expect(headers["X-Goog-Api-Key"]).toBe("KEY");
    expect(headers["X-Goog-FieldMask"]).toContain("places.location");
    const body = JSON.parse(calls[0].init!.body as string);
    expect(body).toMatchObject({ textQuery: "farmacias", languageCode: "es", regionCode: "VE", pageSize: 5 });
    expect(body.locationBias.circle.radius).toBe(1000);
    // El lugar sin ubicación se descarta: nunca se dibuja algo sin coordenadas de Google.
    expect(result).toEqual([
      expect.objectContaining({ placeId: "abc", name: "Farmacia X", position: { lat: 10.6, lng: -71.6 } }),
    ]);
  });

  it("los errores HTTP se convierten en ProviderError con el mensaje de Google", async () => {
    const { fetch } = mockFetch([new Response(JSON.stringify({ error: { message: "API key not valid" } }), { status: 400 })]);
    const { places } = createGoogleProviders("BAD", fetch);
    await expect(places.searchText({ query: "x" })).rejects.toThrow(ProviderError);
  });

  it("getDetails rechaza ids con caracteres extraños", async () => {
    const { fetch } = mockFetch([]);
    const { places } = createGoogleProviders("KEY", fetch);
    await expect(places.getDetails("../../evil")).rejects.toThrow(/no válido/);
  });
});

describe("Geocoding API", () => {
  it("limita a Venezuela, sesga a la ciudad y trata ZERO_RESULTS como lista vacía", async () => {
    const { fetch, calls } = mockFetch([{ status: "ZERO_RESULTS", results: [] }]);
    const { geocoding } = createGoogleProviders("KEY", fetch);
    const r = await geocoding.geocode("Avenida X", { bounds: { south: 10.5, west: -71.8, north: 10.8, east: -71.5 } });
    expect(r).toEqual([]);
    const url = new URL(calls[0].url);
    expect(url.searchParams.get("components")).toBe("country:VE");
    expect(url.searchParams.get("bounds")).toBe("10.5,-71.8|10.8,-71.5");
    expect(url.searchParams.get("language")).toBe("es");
  });

  it("otros estados son errores", async () => {
    const { fetch } = mockFetch([{ status: "REQUEST_DENIED", error_message: "denied", results: [] }]);
    const { geocoding } = createGoogleProviders("KEY", fetch);
    await expect(geocoding.geocode("x")).rejects.toThrow(/REQUEST_DENIED/);
  });
});

describe("Routes API", () => {
  it("decodifica la polilínea y los pasos de transporte", async () => {
    const { fetch, calls } = mockFetch([
      {
        routes: [
          {
            distanceMeters: 1200,
            duration: "300s",
            polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC" },
            legs: [
              {
                steps: [
                  {
                    travelMode: "TRANSIT",
                    transitDetails: {
                      headsign: "Centro",
                      stopCount: 4,
                      transitLine: { name: "Ruta 1", vehicle: { type: "BUS" } },
                      stopDetails: { departureStop: { name: "Parada A", location: { latLng: { latitude: 10.6, longitude: -71.6 } } } },
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
    const { routes } = createGoogleProviders("KEY", fetch);
    const r = await routes.computeRoute({ origin: { address: "A" }, destination: { placeId: "pid" }, travelMode: "TRANSIT" });
    const body = JSON.parse(calls[0].init!.body as string);
    expect(body.origin).toEqual({ address: "A" });
    expect(body.destination).toEqual({ placeId: "pid" });
    expect((calls[0].init!.headers as Record<string, string>)["X-Goog-FieldMask"]).toContain("routes.legs.steps.transitDetails");
    expect(r?.durationSeconds).toBe(300);
    expect(r?.path).toHaveLength(2);
    expect(r?.steps[0].transit).toMatchObject({ lineName: "Ruta 1", vehicleType: "BUS", stopCount: 4, departureStop: { name: "Parada A", position: { lat: 10.6, lng: -71.6 } } });
  });

  it("sin rutas devuelve null", async () => {
    const { fetch } = mockFetch([{}]);
    const { routes } = createGoogleProviders("KEY", fetch);
    expect(await routes.computeRoute({ origin: { address: "A" }, destination: { address: "B" }, travelMode: "DRIVE" })).toBeNull();
  });
});
