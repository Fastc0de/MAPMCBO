/**
 * Tipos geográficos compartidos entre el frontend, el agente y la capa de herramientas.
 * No dependen de ningún proveedor concreto (Google, web, LLM).
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * Procedencia de cada dato que aparece en el mapa o en las respuestas.
 * - GOOGLE_MAPS_DATA: viene de Google Maps Platform (Places, Geocoding, Routes).
 * - WEB_DATA: aparece en fuentes web, sin verificar directamente en Google Maps.
 * - MODEL_INFERENCE: lo dedujo el modelo; nunca se usa para coordenadas.
 */
export type DataSource = "GOOGLE_MAPS_DATA" | "WEB_DATA" | "MODEL_INFERENCE";

export interface SourceRef {
  title: string;
  url: string;
}

export interface Provenance {
  source: DataSource;
  sourceRefs?: SourceRef[];
  /** Aclaración visible para el usuario sobre cómo se obtuvo el dato. */
  note?: string;
}

export interface PlaceSummary {
  placeId: string;
  name: string;
  address?: string;
  position: LatLng;
  types?: string[];
  primaryType?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  businessStatus?: string;
}

export interface PlaceDetails extends PlaceSummary {
  phone?: string;
  website?: string;
  openingHours?: string[];
  summary?: string;
  viewport?: Bounds;
}

export interface GeocodeResult {
  placeId?: string;
  formattedAddress: string;
  position: LatLng;
  types: string[];
  viewport?: Bounds;
  bounds?: Bounds;
  /** Componentes relevantes (barrio, parroquia, municipio, estado...). */
  components: { name: string; types: string[] }[];
  partialMatch?: boolean;
}

export type TravelMode = "DRIVE" | "WALK" | "BICYCLE" | "TWO_WHEELER" | "TRANSIT";

export interface RouteStep {
  instruction?: string;
  distanceMeters?: number;
  travelMode?: string;
  transit?: {
    lineName?: string;
    lineShortName?: string;
    vehicleType?: string;
    headsign?: string;
    stopCount?: number;
    departureStop?: { name?: string; position?: LatLng };
    arrivalStop?: { name?: string; position?: LatLng };
  };
}

export interface RouteResult {
  distanceMeters?: number;
  durationSeconds?: number;
  path: LatLng[];
  description?: string;
  steps: RouteStep[];
}

/* ---------- Transporte público ---------- */

export type TransitVehicle =
  | "bus"
  | "por_puesto"
  | "metro"
  | "trolebus"
  | "tren"
  | "teleferico"
  | "otro";

export interface TransitLine {
  name: string;
  vehicle: TransitVehicle;
  operator?: string;
}

export interface TransitStop {
  id: string;
  name: string;
  /** Solo existe si Google pudo geocodificar la parada; nunca la inventa el modelo. */
  position?: LatLng;
  verified: boolean;
  /** Cómo se ubicó la parada (dirección devuelta por Google o motivo del fallo). */
  resolution: string;
}

export interface TransitSegment {
  fromStopId: string;
  toStopId: string;
  path: LatLng[];
  /** true cuando el trazado es una aproximación (calle calculada o línea recta). */
  approximate: boolean;
}

export interface TransitRoute extends Provenance {
  id: string;
  line: TransitLine;
  stops: TransitStop[];
  segments: TransitSegment[];
}
