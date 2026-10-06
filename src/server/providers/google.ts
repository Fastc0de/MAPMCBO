import "server-only";

import { decodePolyline } from "@/lib/geo/math";
import type { Bounds, GeocodeResult, LatLng, PlaceDetails, PlaceSummary, RouteStep } from "@/lib/geo/types";
import {
  ProviderError,
  type GeocodingProvider,
  type NearbySearchParams,
  type PlacesProvider,
  type Providers,
  type RoutesProvider,
  type TextSearchParams,
  type Waypoint,
} from "./types";

/**
 * Implementación con las APIs oficiales de Google Maps Platform:
 * - Places API (New): places:searchText, places:searchNearby, places/{id}
 * - Geocoding API: /maps/api/geocode/json
 * - Routes API: directions/v2:computeRoutes
 * Todas se llaman desde el servidor con GOOGLE_MAPS_SERVER_API_KEY.
 */

const LANGUAGE = "es";
const REGION = "VE";

type FetchLike = typeof fetch;

const PLACE_FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "shortFormattedAddress",
  "location",
  "types",
  "primaryType",
  "rating",
  "userRatingCount",
  "googleMapsUri",
  "businessStatus",
];
const DETAIL_FIELDS = [
  ...PLACE_FIELDS,
  "nationalPhoneNumber",
  "websiteUri",
  "regularOpeningHours.weekdayDescriptions",
  "editorialSummary",
  "viewport",
];

interface GPlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  shortFormattedAddress?: string;
  location?: { latitude: number; longitude: number };
  types?: string[];
  primaryType?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  businessStatus?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  editorialSummary?: { text: string };
  viewport?: { low: { latitude: number; longitude: number }; high: { latitude: number; longitude: number } };
}

function toSummary(p: GPlace): PlaceSummary | null {
  if (!p.location) return null;
  return {
    placeId: p.id,
    name: p.displayName?.text ?? p.shortFormattedAddress ?? p.id,
    address: p.formattedAddress ?? p.shortFormattedAddress,
    position: { lat: p.location.latitude, lng: p.location.longitude },
    types: p.types,
    primaryType: p.primaryType,
    rating: p.rating,
    userRatingCount: p.userRatingCount,
    googleMapsUri: p.googleMapsUri,
    businessStatus: p.businessStatus,
  };
}

async function readError(res: Response, service: string): Promise<ProviderError> {
  let detail = "";
  try {
    const body = await res.json();
    detail = body?.error?.message ?? body?.error_message ?? JSON.stringify(body).slice(0, 300);
  } catch {
    detail = res.statusText;
  }
  return new ProviderError(`${service}: HTTP ${res.status} ${detail}`, res.status, service);
}

export function createGooglePlaces(apiKey: string, fetchImpl: FetchLike = fetch): PlacesProvider {
  const post = async (path: string, body: unknown, fields: string[]) => {
    const res = await fetchImpl(`https://places.googleapis.com/v1/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": fields.map((f) => `places.${f}`).join(","),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await readError(res, "Places API");
    const data = (await res.json()) as { places?: GPlace[] };
    return (data.places ?? []).map(toSummary).filter((p): p is PlaceSummary => p !== null);
  };

  return {
    async searchText(params: TextSearchParams) {
      const body: Record<string, unknown> = {
        textQuery: params.query,
        languageCode: LANGUAGE,
        regionCode: REGION,
        pageSize: Math.min(20, Math.max(1, params.maxResults ?? 10)),
      };
      if (params.includedType) body.includedType = params.includedType;
      if (params.near) {
        body.locationBias = {
          circle: {
            center: { latitude: params.near.center.lat, longitude: params.near.center.lng },
            radius: Math.min(50_000, Math.max(1, params.near.radiusMeters)),
          },
        };
      } else if (params.within) {
        body.locationBias = {
          rectangle: {
            low: { latitude: params.within.south, longitude: params.within.west },
            high: { latitude: params.within.north, longitude: params.within.east },
          },
        };
      }
      return post("places:searchText", body, PLACE_FIELDS);
    },

    async searchNearby(params: NearbySearchParams) {
      return post(
        "places:searchNearby",
        {
          includedTypes: params.includedTypes,
          maxResultCount: Math.min(20, Math.max(1, params.maxResults ?? 15)),
          languageCode: LANGUAGE,
          regionCode: REGION,
          locationRestriction: {
            circle: {
              center: { latitude: params.center.lat, longitude: params.center.lng },
              radius: Math.min(50_000, Math.max(1, params.radiusMeters)),
            },
          },
        },
        PLACE_FIELDS,
      );
    },

    async getDetails(placeId: string) {
      if (!/^[A-Za-z0-9_-]+$/.test(placeId)) throw new ProviderError(`placeId no válido: ${placeId}`, 400, "Places API");
      const url = `https://places.googleapis.com/v1/places/${placeId}?languageCode=${LANGUAGE}&regionCode=${REGION}`;
      const res = await fetchImpl(url, {
        headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": DETAIL_FIELDS.join(",") },
      });
      if (!res.ok) throw await readError(res, "Places API");
      const p = (await res.json()) as GPlace;
      const summary = toSummary(p);
      if (!summary) throw new ProviderError(`El lugar ${placeId} no tiene ubicación`, 404, "Places API");
      const details: PlaceDetails = {
        ...summary,
        phone: p.nationalPhoneNumber,
        website: p.websiteUri,
        openingHours: p.regularOpeningHours?.weekdayDescriptions,
        summary: p.editorialSummary?.text,
      };
      if (p.viewport) {
        details.viewport = {
          south: p.viewport.low.latitude,
          west: p.viewport.low.longitude,
          north: p.viewport.high.latitude,
          east: p.viewport.high.longitude,
        };
      }
      return details;
    },
  };
}

interface GGeocodeResult {
  place_id?: string;
  formatted_address: string;
  types: string[];
  partial_match?: boolean;
  address_components: { long_name: string; types: string[] }[];
  geometry: {
    location: { lat: number; lng: number };
    viewport?: GBounds;
    bounds?: GBounds;
  };
}
interface GBounds {
  northeast: { lat: number; lng: number };
  southwest: { lat: number; lng: number };
}

const fromGBounds = (b?: GBounds): Bounds | undefined =>
  b ? { south: b.southwest.lat, west: b.southwest.lng, north: b.northeast.lat, east: b.northeast.lng } : undefined;

export function createGoogleGeocoding(apiKey: string, fetchImpl: FetchLike = fetch): GeocodingProvider {
  const call = async (params: Record<string, string>) => {
    const qs = new URLSearchParams({ ...params, key: apiKey, language: LANGUAGE });
    const res = await fetchImpl(`https://maps.googleapis.com/maps/api/geocode/json?${qs}`);
    if (!res.ok) throw await readError(res, "Geocoding API");
    const data = (await res.json()) as { status: string; results: GGeocodeResult[]; error_message?: string };
    if (data.status === "ZERO_RESULTS") return [];
    if (data.status !== "OK") {
      throw new ProviderError(`Geocoding API: ${data.status} ${data.error_message ?? ""}`.trim(), undefined, "Geocoding API");
    }
    return data.results.map(
      (r): GeocodeResult => ({
        placeId: r.place_id,
        formattedAddress: r.formatted_address,
        position: r.geometry.location,
        types: r.types,
        viewport: fromGBounds(r.geometry.viewport),
        bounds: fromGBounds(r.geometry.bounds),
        components: r.address_components.map((c) => ({ name: c.long_name, types: c.types })),
        partialMatch: r.partial_match,
      }),
    );
  };

  return {
    geocode(address, opts) {
      const params: Record<string, string> = { address, region: "ve", components: "country:VE" };
      if (opts?.bounds) {
        const b = opts.bounds;
        params.bounds = `${b.south},${b.west}|${b.north},${b.east}`;
      }
      return call(params);
    },
    reverseGeocode(position: LatLng) {
      return call({ latlng: `${position.lat},${position.lng}` });
    },
  };
}

interface GRouteStep {
  distanceMeters?: number;
  travelMode?: string;
  navigationInstruction?: { instructions?: string };
  transitDetails?: {
    headsign?: string;
    stopCount?: number;
    stopDetails?: {
      arrivalStop?: { name?: string; location?: { latLng?: { latitude: number; longitude: number } } };
      departureStop?: { name?: string; location?: { latLng?: { latitude: number; longitude: number } } };
    };
    transitLine?: { name?: string; nameShort?: string; vehicle?: { type?: string } };
  };
}
interface GRoute {
  distanceMeters?: number;
  duration?: string;
  description?: string;
  polyline?: { encodedPolyline?: string };
  legs?: { steps?: GRouteStep[] }[];
}

const toWaypoint = (w: Waypoint) => {
  if ("placeId" in w) return { placeId: w.placeId };
  if ("address" in w) return { address: w.address };
  return { location: { latLng: { latitude: w.position.lat, longitude: w.position.lng } } };
};

const stopPosition = (loc?: { latLng?: { latitude: number; longitude: number } }): LatLng | undefined =>
  loc?.latLng ? { lat: loc.latLng.latitude, lng: loc.latLng.longitude } : undefined;

export function createGoogleRoutes(apiKey: string, fetchImpl: FetchLike = fetch): RoutesProvider {
  return {
    async computeRoute({ origin, destination, travelMode, departureTime }) {
      const transit = travelMode === "TRANSIT";
      const fields = [
        "routes.distanceMeters",
        "routes.duration",
        "routes.description",
        "routes.polyline.encodedPolyline",
        "routes.legs.steps.distanceMeters",
        "routes.legs.steps.travelMode",
        "routes.legs.steps.navigationInstruction.instructions",
      ];
      if (transit) fields.push("routes.legs.steps.transitDetails");
      const body: Record<string, unknown> = {
        origin: toWaypoint(origin),
        destination: toWaypoint(destination),
        travelMode,
        languageCode: LANGUAGE,
        regionCode: REGION,
        units: "METRIC",
      };
      if (departureTime) body.departureTime = departureTime;
      const res = await fetchImpl("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": fields.join(","),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw await readError(res, "Routes API");
      const data = (await res.json()) as { routes?: GRoute[] };
      const route = data.routes?.[0];
      if (!route) return null;
      const steps: RouteStep[] = (route.legs ?? []).flatMap((leg) =>
        (leg.steps ?? []).map((s): RouteStep => {
          const step: RouteStep = {
            instruction: s.navigationInstruction?.instructions,
            distanceMeters: s.distanceMeters,
            travelMode: s.travelMode,
          };
          const t = s.transitDetails;
          if (t) {
            step.transit = {
              lineName: t.transitLine?.name,
              lineShortName: t.transitLine?.nameShort,
              vehicleType: t.transitLine?.vehicle?.type,
              headsign: t.headsign,
              stopCount: t.stopCount,
              departureStop: { name: t.stopDetails?.departureStop?.name, position: stopPosition(t.stopDetails?.departureStop?.location) },
              arrivalStop: { name: t.stopDetails?.arrivalStop?.name, position: stopPosition(t.stopDetails?.arrivalStop?.location) },
            };
          }
          return step;
        }),
      );
      return {
        distanceMeters: route.distanceMeters,
        durationSeconds: route.duration ? Number.parseInt(route.duration, 10) : undefined,
        description: route.description,
        path: route.polyline?.encodedPolyline ? decodePolyline(route.polyline.encodedPolyline) : [],
        steps,
      };
    },
  };
}

export function createGoogleProviders(apiKey: string, fetchImpl: FetchLike = fetch): Providers {
  return {
    places: createGooglePlaces(apiKey, fetchImpl),
    geocoding: createGoogleGeocoding(apiKey, fetchImpl),
    routes: createGoogleRoutes(apiKey, fetchImpl),
  };
}
