import { boundsOfPoints, round, samplePath } from "@/lib/geo/math";
import type { Bounds, LatLng, TransitRoute } from "@/lib/geo/types";
import type { MapAction, MapHighlight, MapMarker, MapRoute, Selection } from "./actions";

export interface CameraState {
  center: LatLng;
  zoom: number;
  bounds?: Bounds;
}

/** Petición de movimiento de cámara pendiente; la vista del mapa la ejecuta y la consume. */
export type CameraCommand =
  | { kind: "center"; center: LatLng; zoom?: number; seq: number }
  | { kind: "zoom"; zoom: number; seq: number }
  | { kind: "fit"; bounds: Bounds; seq: number };

export interface MapState {
  camera: CameraState;
  cameraCommand: CameraCommand | null;
  markers: MapMarker[];
  routes: MapRoute[];
  highlights: MapHighlight[];
  transitRoutes: TransitRoute[];
  selection: Selection | null;
  baseMap: "roadmap" | "labels-hidden" | "hybrid";
  /** Nombre del sector/zona bajo el centro del mapa, cuando se conoce. */
  currentArea?: string;
}

export const initialMapState = (camera: CameraState): MapState => ({
  camera,
  cameraCommand: null,
  markers: [],
  routes: [],
  highlights: [],
  transitRoutes: [],
  selection: null,
  baseMap: "roadmap",
});

let seq = 0;
const nextSeq = () => ++seq;

function upsert<T extends { id: string }>(list: T[], items: T[]): T[] {
  const byId = new Map(list.map((item) => [item.id, item]));
  for (const item of items) byId.set(item.id, item);
  return [...byId.values()];
}

function fitCommand(points: LatLng[]): CameraCommand | null {
  const bounds = boundsOfPoints(points);
  if (!bounds) return null;
  if (points.length === 1) return { kind: "center", center: points[0], zoom: 16, seq: nextSeq() };
  return { kind: "fit", bounds, seq: nextSeq() };
}

/** Reducer puro: aplica una MapAction al estado del mapa. */
export function applyMapAction(state: MapState, action: MapAction): MapState {
  switch (action.type) {
    case "ADD_MARKERS": {
      const markers = upsert(state.markers, action.markers);
      const cameraCommand = action.fit
        ? fitCommand(action.markers.map((m) => m.position)) ?? state.cameraCommand
        : state.cameraCommand;
      return { ...state, markers, cameraCommand };
    }
    case "REMOVE_MARKERS": {
      if (action.all) return { ...state, markers: [] };
      const ids = new Set(action.ids ?? []);
      return {
        ...state,
        markers: state.markers.filter((m) => !ids.has(m.id) && (!action.layerId || m.layerId !== action.layerId)),
      };
    }
    case "DRAW_ROUTE":
      return {
        ...state,
        routes: upsert(state.routes, [action.route]),
        cameraCommand: action.fit ? fitCommand(action.route.path) ?? state.cameraCommand : state.cameraCommand,
      };
    case "CLEAR_ROUTE":
      return {
        ...state,
        routes: action.id ? state.routes.filter((r) => r.id !== action.id) : [],
        transitRoutes: action.id ? state.transitRoutes.filter((t) => t.id !== action.id) : [],
      };
    case "HIGHLIGHT_ROAD":
    case "HIGHLIGHT_AREA": {
      const h = action.highlight;
      const points = h.path ?? (h.bounds ? [
        { lat: h.bounds.south, lng: h.bounds.west },
        { lat: h.bounds.north, lng: h.bounds.east },
      ] : []);
      return {
        ...state,
        highlights: upsert(state.highlights, [h]),
        cameraCommand: action.fit ? fitCommand(points) ?? state.cameraCommand : state.cameraCommand,
      };
    }
    case "CLEAR_HIGHLIGHTS": {
      if (!action.ids) return { ...state, highlights: [] };
      const ids = new Set(action.ids);
      return { ...state, highlights: state.highlights.filter((h) => !ids.has(h.id)) };
    }
    case "SET_FEATURE_LABELS": {
      const { labels } = action;
      return {
        ...state,
        highlights: state.highlights.map((h) => {
          if (!(h.id in labels)) return h;
          const anon = labels[h.id];
          const noun = h.kind === "road" ? "Vía" : "Zona";
          return anon ? { ...h, label: `${noun} ${anon}`, hiddenName: true } : { ...h, label: h.name, hiddenName: false };
        }),
        markers: state.markers.map((m) => {
          if (!(m.id in labels)) return m;
          const anon = labels[m.id];
          return anon ? { ...m, quizLabel: `Lugar ${anon}`, glyph: anon } : { ...m, quizLabel: undefined, glyph: undefined };
        }),
      };
    }
    case "DRAW_TRANSIT_ROUTE": {
      const points = action.transit.segments.flatMap((s) => s.path);
      for (const stop of action.transit.stops) if (stop.position) points.push(stop.position);
      return {
        ...state,
        transitRoutes: upsert(state.transitRoutes, [action.transit]),
        cameraCommand: action.fit ? fitCommand(points) ?? state.cameraCommand : state.cameraCommand,
      };
    }
    case "SET_CENTER":
      return { ...state, cameraCommand: { kind: "center", center: action.center, zoom: action.zoom, seq: nextSeq() } };
    case "SET_ZOOM":
      return { ...state, cameraCommand: { kind: "zoom", zoom: action.zoom, seq: nextSeq() } };
    case "FIT_BOUNDS":
      return { ...state, cameraCommand: { kind: "fit", bounds: action.bounds, seq: nextSeq() } };
    case "SET_BASE_MAP":
      return { ...state, baseMap: action.mode };
    case "SELECT":
      return { ...state, selection: action.selection };
    case "CLEAR_ALL":
      return { ...state, markers: [], routes: [], highlights: [], transitRoutes: [], selection: null };
  }
}

/* ---------- MapContext: lo que el agente sabe del mapa ---------- */

export interface MapContext {
  center: LatLng;
  zoom: number;
  bounds?: Bounds;
  currentArea?: string;
  baseMap: MapState["baseMap"];
  selectedPlace?: { placeId?: string; name: string; position?: LatLng; markerId?: string };
  selectedRoad?: { id: string; name: string };
  selectedArea?: { id: string; name: string };
  selectedPoint?: LatLng;
  selectedRoute?: { id: string; name: string };
  visibleMarkers: { id: string; title: string; placeId?: string; position: LatLng; layerId: string; source: string }[];
  activeRoutes: {
    id: string;
    label: string;
    travelMode?: string;
    distanceMeters?: number;
    durationSeconds?: number;
    samplePath: LatLng[];
    source: string;
  }[];
  highlightedFeatures: {
    id: string;
    kind: "road" | "area";
    name: string;
    label: string;
    hiddenName: boolean;
    samplePath?: LatLng[];
    bounds?: Bounds;
    source: string;
  }[];
  transitRoutes: { id: string; line: string; stops: string[]; source: string }[];
}

const MAX_CONTEXT_MARKERS = 40;

const roundPoint = (p: LatLng): LatLng => ({ lat: round(p.lat), lng: round(p.lng) });

/** Resume el estado del mapa en un objeto compacto para enviarlo al agente en cada turno. */
export function buildMapContext(state: MapState): MapContext {
  const { camera, selection } = state;
  const ctx: MapContext = {
    center: roundPoint(camera.center),
    zoom: Math.round(camera.zoom * 10) / 10,
    bounds: camera.bounds,
    currentArea: state.currentArea,
    baseMap: state.baseMap,
    visibleMarkers: state.markers.slice(-MAX_CONTEXT_MARKERS).map((m) => ({
      id: m.id,
      title: m.quizLabel ? `${m.quizLabel} (nombre oculto: ${m.title})` : m.title,
      placeId: m.placeId,
      position: roundPoint(m.position),
      layerId: m.layerId,
      source: m.source,
    })),
    activeRoutes: state.routes.map((r) => ({
      id: r.id,
      label: r.label,
      travelMode: r.travelMode,
      distanceMeters: r.distanceMeters,
      durationSeconds: r.durationSeconds,
      samplePath: samplePath(r.path, 8).map(roundPoint),
      source: r.source,
    })),
    highlightedFeatures: state.highlights.map((h) => ({
      id: h.id,
      kind: h.kind,
      name: h.name,
      label: h.label,
      hiddenName: h.hiddenName,
      samplePath: h.path ? samplePath(h.path, 6).map(roundPoint) : undefined,
      bounds: h.bounds,
      source: h.source,
    })),
    transitRoutes: state.transitRoutes.map((t) => ({
      id: t.id,
      line: t.line.name,
      stops: t.stops.map((s) => s.name),
      source: t.source,
    })),
  };

  if (selection) {
    switch (selection.kind) {
      case "place":
        ctx.selectedPlace = { placeId: selection.placeId, name: selection.name, position: selection.position };
        break;
      case "marker":
        ctx.selectedPlace = {
          markerId: selection.id,
          placeId: selection.placeId,
          name: selection.name,
          position: roundPoint(selection.position),
        };
        break;
      case "road":
        ctx.selectedRoad = { id: selection.id, name: selection.name };
        break;
      case "area":
        ctx.selectedArea = { id: selection.id, name: selection.name };
        break;
      case "point":
        ctx.selectedPoint = roundPoint(selection.position);
        break;
      case "route":
      case "transit":
        ctx.selectedRoute = { id: selection.id, name: selection.name };
        break;
    }
  }
  return ctx;
}
