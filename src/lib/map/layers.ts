/**
 * Sistema de capas extensible. Cada capa declara de dónde salen sus datos:
 * - "places": lugares de Google Places (Nearby Search) en la zona visible.
 * - "google": capas nativas de Google Maps (transporte, tráfico).
 * - "overlay": lo que dibuja el asistente (rutas, resaltados, marcadores).
 * Añadir una capa nueva es añadir una entrada a LAYERS.
 */

export type LayerKind = "places" | "google" | "overlay";

export interface LayerDefinition {
  id: string;
  label: string;
  kind: LayerKind;
  color: string;
  defaultVisible: boolean;
  /** Tipos de Places API (New), tabla A, para capas "places". */
  includedTypes?: string[];
  /** Capa nativa de Google para capas "google". */
  googleLayer?: "transit" | "traffic";
  group: "Del asistente" | "Lugares" | "Google Maps";
}

export const LAYERS: LayerDefinition[] = [
  { id: "assistant-places", label: "Lugares del asistente", kind: "overlay", color: "#2563eb", defaultVisible: true, group: "Del asistente" },
  { id: "landmarks", label: "Puntos de referencia", kind: "overlay", color: "#7c3aed", defaultVisible: true, group: "Del asistente" },
  { id: "roads", label: "Avenidas y calles resaltadas", kind: "overlay", color: "#f97316", defaultVisible: true, group: "Del asistente" },
  { id: "areas", label: "Sectores y zonas", kind: "overlay", color: "#0d9488", defaultVisible: true, group: "Del asistente" },
  { id: "routes", label: "Rutas", kind: "overlay", color: "#16a34a", defaultVisible: true, group: "Del asistente" },
  { id: "transit-web", label: "Transporte (rutas reconstruidas)", kind: "overlay", color: "#db2777", defaultVisible: true, group: "Del asistente" },
  { id: "search", label: "Resultados del buscador", kind: "overlay", color: "#0ea5e9", defaultVisible: true, group: "Del asistente" },
  { id: "restaurants", label: "Restaurantes", kind: "places", color: "#ef4444", defaultVisible: false, includedTypes: ["restaurant"], group: "Lugares" },
  { id: "malls", label: "Centros comerciales", kind: "places", color: "#a855f7", defaultVisible: false, includedTypes: ["shopping_mall"], group: "Lugares" },
  { id: "hospitals", label: "Hospitales", kind: "places", color: "#dc2626", defaultVisible: false, includedTypes: ["hospital"], group: "Lugares" },
  { id: "universities", label: "Universidades", kind: "places", color: "#4f46e5", defaultVisible: false, includedTypes: ["university"], group: "Lugares" },
  { id: "pharmacies", label: "Farmacias", kind: "places", color: "#059669", defaultVisible: false, includedTypes: ["pharmacy"], group: "Lugares" },
  { id: "supermarkets", label: "Supermercados", kind: "places", color: "#ca8a04", defaultVisible: false, includedTypes: ["supermarket"], group: "Lugares" },
  { id: "historic", label: "Lugares históricos", kind: "places", color: "#92400e", defaultVisible: false, includedTypes: ["historical_landmark", "museum"], group: "Lugares" },
  { id: "parks", label: "Parques y plazas", kind: "places", color: "#15803d", defaultVisible: false, includedTypes: ["park"], group: "Lugares" },
  { id: "google-transit", label: "Transporte (Google)", kind: "google", color: "#334155", defaultVisible: false, googleLayer: "transit", group: "Google Maps" },
  { id: "google-traffic", label: "Tráfico", kind: "google", color: "#334155", defaultVisible: false, googleLayer: "traffic", group: "Google Maps" },
];

export const LAYER_BY_ID = new Map(LAYERS.map((l) => [l.id, l]));

export const OVERLAY_LAYER_IDS = LAYERS.filter((l) => l.kind === "overlay").map((l) => l.id);

export const layerColor = (layerId: string) => LAYER_BY_ID.get(layerId)?.color ?? "#2563eb";

export const defaultLayerVisibility = (): Record<string, boolean> =>
  Object.fromEntries(LAYERS.map((l) => [l.id, l.defaultVisible]));
