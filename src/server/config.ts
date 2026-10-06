import "server-only";

/**
 * Configuración del servidor. Las claves solo se leen de variables de entorno
 * (`.env.local` en desarrollo); nunca se envían al navegador salvo la clave
 * pública del mapa, que debe estar restringida por dominio en Google Cloud.
 */
export interface ServerConfig {
  googleServerKey?: string;
  googleBrowserKey?: string;
  googleMapId: string;
  anthropicConfigured: boolean;
  anthropicModel: string;
  anthropicEffort: "low" | "medium" | "high" | "xhigh" | "max";
  webSearchEnabled: boolean;
  webSearchMaxUses: number;
}

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export function getConfig(): ServerConfig {
  const effort = process.env.ANTHROPIC_EFFORT as ServerConfig["anthropicEffort"] | undefined;
  return {
    googleServerKey: process.env.GOOGLE_MAPS_SERVER_API_KEY || undefined,
    googleBrowserKey: process.env.GOOGLE_MAPS_BROWSER_API_KEY || undefined,
    // DEMO_MAP_ID es el id de prueba que Google ofrece para usar marcadores avanzados.
    googleMapId: process.env.GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID",
    anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    anthropicModel: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
    anthropicEffort: effort && EFFORTS.includes(effort) ? effort : "medium",
    webSearchEnabled: process.env.WEB_SEARCH_ENABLED !== "false",
    webSearchMaxUses: Number(process.env.WEB_SEARCH_MAX_USES) || 5,
  };
}

/** Lo que falta configurar, en palabras para la interfaz. */
export function missingConfig(config = getConfig()): string[] {
  const missing: string[] = [];
  if (!config.googleBrowserKey) missing.push("GOOGLE_MAPS_BROWSER_API_KEY (mapa en el navegador)");
  if (!config.googleServerKey) missing.push("GOOGLE_MAPS_SERVER_API_KEY (Places, Geocoding y Routes)");
  if (!config.anthropicConfigured) missing.push("ANTHROPIC_API_KEY (chatbot)");
  return missing;
}
