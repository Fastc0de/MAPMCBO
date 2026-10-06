import type { GeocodeResult, LatLng, PlaceDetails, PlaceSummary, RouteResult } from "@/lib/geo/types";
import type { UIAction } from "@/lib/map/actions";
import { initialMapState, buildMapContext, type MapContext } from "@/lib/map/state";
import { DEFAULT_CITY } from "@/lib/cities";
import type { Providers, Waypoint } from "@/server/providers/types";
import { makeIdGenerator, type ToolContext } from "@/server/tools/context";

export const BELLA_VISTA: PlaceSummary = {
  placeId: "ChIJplace1",
  name: "Centro Comercial de prueba",
  address: "Av. de prueba, Maracaibo",
  position: { lat: 10.66, lng: -71.61 },
};

export function geocodeResult(position: LatLng, types: string[], extra: Partial<GeocodeResult> = {}): GeocodeResult {
  return {
    formattedAddress: extra.formattedAddress ?? "Dirección de prueba, Maracaibo, Zulia, Venezuela",
    position,
    types,
    components: [{ name: "Maracaibo", types: ["locality"] }],
    ...extra,
  };
}

export interface FakeProviderLog {
  textSearches: unknown[];
  geocodes: string[];
  routes: { origin: Waypoint; destination: Waypoint; travelMode: string }[];
}

export function fakeProviders(overrides: {
  places?: PlaceSummary[];
  geocode?: (address: string) => GeocodeResult[];
  route?: (origin: Waypoint, destination: Waypoint, mode: string) => RouteResult | null;
} = {}): { providers: Providers; log: FakeProviderLog } {
  const log: FakeProviderLog = { textSearches: [], geocodes: [], routes: [] };
  const providers: Providers = {
    places: {
      async searchText(params) {
        log.textSearches.push(params);
        return overrides.places ?? [BELLA_VISTA];
      },
      async searchNearby() {
        return overrides.places ?? [BELLA_VISTA];
      },
      async getDetails(placeId): Promise<PlaceDetails> {
        const p = (overrides.places ?? [BELLA_VISTA]).find((x) => x.placeId === placeId);
        if (!p) throw new Error("not found");
        return { ...p, phone: "0261-0000000" };
      },
    },
    geocoding: {
      async geocode(address) {
        log.geocodes.push(address);
        return overrides.geocode ? overrides.geocode(address) : [geocodeResult({ lat: 10.65, lng: -71.62 }, ["route"])];
      },
      async reverseGeocode() {
        return [geocodeResult({ lat: 10.65, lng: -71.62 }, ["neighborhood"], { components: [{ name: "Sector de prueba", types: ["neighborhood"] }, { name: "Maracaibo", types: ["locality"] }] })];
      },
    },
    routes: {
      async computeRoute({ origin, destination, travelMode }) {
        log.routes.push({ origin, destination, travelMode });
        if (overrides.route) return overrides.route(origin, destination, travelMode);
        return {
          distanceMeters: 2500,
          durationSeconds: 420,
          path: [
            { lat: 10.64, lng: -71.62 },
            { lat: 10.65, lng: -71.615 },
            { lat: 10.66, lng: -71.61 },
          ],
          steps: [{ instruction: "Toma la avenida de prueba", distanceMeters: 2500, travelMode: "DRIVE" }],
        };
      },
    },
  };
  return { providers, log };
}

export function mapContextAtMaracaibo(patch: Partial<MapContext> = {}): MapContext {
  const state = initialMapState({
    center: DEFAULT_CITY.center,
    zoom: 13,
    bounds: { south: 10.6, west: -71.66, north: 10.68, east: -71.56 },
  });
  return { ...buildMapContext(state), ...patch };
}

export function toolContext(providers: Providers, mapContext = mapContextAtMaracaibo()): ToolContext & { actions: UIAction[] } {
  const actions: UIAction[] = [];
  return {
    providers,
    mapContext,
    progress: {},
    emit: (a) => actions.push(a),
    knownPlaces: new Map(),
    createdFeatures: new Map(),
    newId: makeIdGenerator(1),
    actions,
  };
}
