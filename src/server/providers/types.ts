import type { Bounds, GeocodeResult, LatLng, PlaceDetails, PlaceSummary, RouteResult, TravelMode } from "@/lib/geo/types";

/**
 * Puertos hacia servicios externos. Las herramientas del agente y las rutas de la API
 * dependen de estas interfaces, no de Google directamente, así que se pueden
 * sustituir (o simular en los tests) sin tocar el agente ni la interfaz.
 */

export interface TextSearchParams {
  query: string;
  /** Sesgo de ubicación: círculo alrededor de un punto. */
  near?: { center: LatLng; radiusMeters: number };
  /** Sesgo de ubicación: rectángulo (por ejemplo la zona visible). */
  within?: Bounds;
  includedType?: string;
  maxResults?: number;
}

export interface NearbySearchParams {
  center: LatLng;
  radiusMeters: number;
  includedTypes: string[];
  maxResults?: number;
}

export interface PlacesProvider {
  searchText(params: TextSearchParams): Promise<PlaceSummary[]>;
  searchNearby(params: NearbySearchParams): Promise<PlaceSummary[]>;
  getDetails(placeId: string): Promise<PlaceDetails>;
}

export interface GeocodingProvider {
  geocode(address: string, opts?: { bounds?: Bounds }): Promise<GeocodeResult[]>;
  reverseGeocode(position: LatLng): Promise<GeocodeResult[]>;
}

/** Un punto de ruta: por placeId, por dirección/nombre o por coordenadas ya conocidas. */
export type Waypoint = { placeId: string } | { address: string } | { position: LatLng };

export interface RoutesProvider {
  computeRoute(params: {
    origin: Waypoint;
    destination: Waypoint;
    travelMode: TravelMode;
    departureTime?: string;
  }): Promise<RouteResult | null>;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
}

export interface WebSearchProvider {
  search(query: string, opts?: { maxResults?: number; recent?: boolean }): Promise<WebSearchResult[]>;
}

export interface WebPage {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
}

export interface PageReader {
  read(url: string): Promise<WebPage>;
}

export interface Providers {
  places: PlacesProvider;
  geocoding: GeocodingProvider;
  routes: RoutesProvider;
  /** Búsqueda web propia (SearXNG) para los modelos que no traen una. */
  web?: WebSearchProvider;
  /** Lee el texto de las páginas que encontró la búsqueda web. */
  pages?: PageReader;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly service?: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
