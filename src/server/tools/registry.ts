import type { AgentTool } from "./tool";
import { createLesson, createQuiz, getCurriculum, getLearningProgress, saveLearningProgress } from "./learning";
import { clearHighlights, clearMap, getMapContext, highlightArea, highlightRoad, setBaseMap, setFeatureLabels, setMapView } from "./map";
import { geocode, getPlaceDetails, removeMarkers, reverseGeocode, searchPlaces, showMarkers } from "./places";
import { calculateRoute, clearRoute, searchTransitInformation, showTransitRoute } from "./routes";

/**
 * Herramientas del agente. El orden es fijo (forma parte del prefijo que se cachea).
 * La búsqueda web no está aquí: es la herramienta de servidor `web_search` de Claude,
 * declarada en el agente.
 */
export const TOOLS: AgentTool[] = [
  // Datos de Google Maps Platform
  searchPlaces,
  getPlaceDetails,
  geocode,
  reverseGeocode,
  calculateRoute,
  searchTransitInformation,
  // Acciones sobre el mapa
  showMarkers,
  removeMarkers,
  clearRoute,
  highlightRoad,
  highlightArea,
  setFeatureLabels,
  clearHighlights,
  setMapView,
  setBaseMap,
  clearMap,
  getMapContext,
  showTransitRoute,
  // Aprendizaje
  getCurriculum,
  createLesson,
  createQuiz,
  saveLearningProgress,
  getLearningProgress,
] as AgentTool[];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
