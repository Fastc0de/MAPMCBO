import "server-only";

import type { MissingConfig } from "@/lib/setup";
import { availableModels } from "./llm/catalog";

/**
 * Configuración del servidor. Las claves solo se leen de variables de entorno
 * (`.env.local` en desarrollo); nunca se envían al navegador salvo la clave
 * pública del mapa, que debe estar restringida por dominio en Google Cloud.
 */
export interface ServerConfig {
  googleServerKey?: string;
  googleBrowserKey?: string;
  googleMapId: string;
  chatConfigured: boolean;
  anthropicEffort: "low" | "medium" | "high" | "xhigh" | "max";
  webSearchMaxUses: number;
  tavilyKey?: string;
}

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export function getConfig(): ServerConfig {
  const effort = process.env.ANTHROPIC_EFFORT as ServerConfig["anthropicEffort"] | undefined;
  // GOOGLE_MAPS_API_KEY sirve para las dos cosas cuando solo tienes una clave (p. ej. la Maps Demo Key).
  const shared = process.env.GOOGLE_MAPS_API_KEY || undefined;
  return {
    googleServerKey: process.env.GOOGLE_MAPS_SERVER_API_KEY || shared,
    googleBrowserKey: process.env.GOOGLE_MAPS_BROWSER_API_KEY || shared,
    // DEMO_MAP_ID es el id de prueba que Google ofrece para usar marcadores avanzados.
    googleMapId: process.env.GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID",
    chatConfigured: availableModels().length > 0,
    anthropicEffort: effort && EFFORTS.includes(effort) ? effort : "medium",
    webSearchMaxUses: Number(process.env.WEB_SEARCH_MAX_USES) || 5,
    tavilyKey: process.env.TAVILY_API_KEY || undefined,
  };
}

/** Lo que falta configurar, en palabras para la interfaz. */
export function missingConfig(config = getConfig()): MissingConfig[] {
  const missing: MissingConfig[] = [];
  if (!config.googleBrowserKey) missing.push({ part: "map", text: "GOOGLE_MAPS_API_KEY (mapa en el navegador)" });
  if (!config.googleServerKey) missing.push({ part: "google", text: "GOOGLE_MAPS_API_KEY (Places, Geocoding y Routes)" });
  if (!config.chatConfigured) {
    missing.push({ part: "chat", text: "una clave de modelo para el chat (GEMINI_API_KEY, OPENCODE_GO_API_KEY, ANTHROPIC_API_KEY u OPENAI_COMPATIBLE_*)" });
  }
  return missing;
}
