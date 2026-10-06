import type { Bounds, LatLng, Provenance, RouteStep, TransitRoute } from "@/lib/geo/types";
import type { Lesson } from "@/lib/learning/lesson";
import type { Quiz } from "@/lib/learning/quiz";
import type { ProgressUpdate } from "@/lib/learning/progress";

/**
 * Sistema formal de Map Actions.
 *
 * El agente nunca toca el DOM: sus herramientas devuelven acciones serializables
 * que la interfaz aplica con un reducer puro (ver `state.ts`).
 * LLM → tool call → backend → resultado → MapAction → UI
 *
 * Para añadir una capacidad nueva: define la acción aquí, trátala en el reducer
 * y emítela desde una herramienta. El chat no cambia.
 */

export interface MapMarker extends Provenance {
  id: string;
  position: LatLng;
  title: string;
  subtitle?: string;
  placeId?: string;
  layerId: string;
  /** Etiqueta corta dentro del pin (por ejemplo "A" en un quiz). */
  glyph?: string;
  /** Nombre anónimo durante un quiz ("Lugar A"); oculta el título real. */
  quizLabel?: string;
}

export interface MapRoute extends Provenance {
  id: string;
  path: LatLng[];
  label: string;
  layerId: string;
  color?: string;
  travelMode?: string;
  distanceMeters?: number;
  durationSeconds?: number;
  steps?: RouteStep[];
}

export interface MapHighlight extends Provenance {
  id: string;
  kind: "road" | "area";
  name: string;
  /** Texto que se muestra; en modo quiz puede ser "Avenida A" para ocultar el nombre real. */
  label: string;
  hiddenName: boolean;
  path?: LatLng[];
  bounds?: Bounds;
  color?: string;
  layerId: string;
}

export interface AddMarkersAction {
  type: "ADD_MARKERS";
  markers: MapMarker[];
  /** Si es true, encuadra el mapa para que se vean todos. */
  fit?: boolean;
}
export interface RemoveMarkersAction {
  type: "REMOVE_MARKERS";
  ids?: string[];
  layerId?: string;
  all?: boolean;
}
export interface DrawRouteAction {
  type: "DRAW_ROUTE";
  route: MapRoute;
  fit?: boolean;
}
export interface ClearRouteAction {
  type: "CLEAR_ROUTE";
  id?: string;
}
export interface HighlightRoadAction {
  type: "HIGHLIGHT_ROAD";
  highlight: MapHighlight;
  fit?: boolean;
}
export interface HighlightAreaAction {
  type: "HIGHLIGHT_AREA";
  highlight: MapHighlight;
  fit?: boolean;
}
export interface ClearHighlightsAction {
  type: "CLEAR_HIGHLIGHTS";
  ids?: string[];
}
export interface SetFeatureLabelsAction {
  type: "SET_FEATURE_LABELS";
  /**
   * id de resaltado o marcador → etiqueta anónima ("A", "B"…) o null para revelar el nombre real.
   * Así se ocultan y se revelan los nombres durante un quiz.
   */
  labels: Record<string, string | null>;
}
export interface DrawTransitRouteAction {
  type: "DRAW_TRANSIT_ROUTE";
  transit: TransitRoute;
  fit?: boolean;
}
export interface SetMapCenterAction {
  type: "SET_CENTER";
  center: LatLng;
  zoom?: number;
}
export interface SetZoomAction {
  type: "SET_ZOOM";
  zoom: number;
}
export interface FitBoundsAction {
  type: "FIT_BOUNDS";
  bounds: Bounds;
}
export interface SetBaseMapAction {
  type: "SET_BASE_MAP";
  /** "labels-hidden" usa la vista satélite sin nombres, útil para reconocer zonas. */
  mode: "roadmap" | "labels-hidden" | "hybrid";
}
export interface SelectFeatureAction {
  type: "SELECT";
  selection: Selection | null;
}
export interface ClearMapAction {
  type: "CLEAR_ALL";
}

export type MapAction =
  | AddMarkersAction
  | RemoveMarkersAction
  | DrawRouteAction
  | ClearRouteAction
  | HighlightRoadAction
  | HighlightAreaAction
  | ClearHighlightsAction
  | SetFeatureLabelsAction
  | DrawTransitRouteAction
  | SetMapCenterAction
  | SetZoomAction
  | FitBoundsAction
  | SetBaseMapAction
  | SelectFeatureAction
  | ClearMapAction;

/** Acciones de aplicación que no son del mapa: lecciones, quizzes y progreso. */
export type AppAction =
  | { type: "SHOW_LESSON"; lesson: Lesson }
  | { type: "START_QUIZ"; quiz: Quiz }
  | { type: "UPDATE_PROGRESS"; update: ProgressUpdate };

export type UIAction = MapAction | AppAction;

export const APP_ACTION_TYPES = new Set<UIAction["type"]>(["SHOW_LESSON", "START_QUIZ", "UPDATE_PROGRESS"]);

export function isAppAction(action: UIAction): action is AppAction {
  return APP_ACTION_TYPES.has(action.type);
}

export type Selection =
  | { kind: "place"; placeId: string; name: string; position?: LatLng }
  | { kind: "marker"; id: string; name: string; position: LatLng; placeId?: string }
  | { kind: "road"; id: string; name: string }
  | { kind: "area"; id: string; name: string }
  | { kind: "route"; id: string; name: string }
  | { kind: "transit"; id: string; name: string }
  | { kind: "point"; position: LatLng; name?: string };
