import "server-only";

import { z } from "zod";
import { getConfig } from "./config";
import { createGoogleProviders } from "./providers/google";
import { createTavilySearch } from "./providers/tavily";
import { ProviderError, type Providers } from "./providers/types";

export class ConfigError extends Error {}

export function getProviders(): Providers {
  const config = getConfig();
  if (!config.googleServerKey) throw new ConfigError("Falta GOOGLE_MAPS_API_KEY en el servidor.");
  const providers = createGoogleProviders(config.googleServerKey);
  if (config.tavilyKey) providers.web = createTavilySearch(config.tavilyKey);
  return providers;
}

export const latLngSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
export const boundsSchema = z.object({
  south: z.number(),
  west: z.number(),
  north: z.number(),
  east: z.number(),
});

/** Ejecuta un handler JSON y traduce los errores conocidos a respuestas HTTP con mensaje en español. */
export async function jsonHandler(fn: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await fn());
  } catch (e) {
    if (e instanceof ConfigError) return Response.json({ error: e.message }, { status: 503 });
    if (e instanceof z.ZodError) return Response.json({ error: "Petición no válida", issues: e.issues }, { status: 400 });
    if (e instanceof SyntaxError) return Response.json({ error: "Petición no válida" }, { status: 400 });
    if (e instanceof ProviderError) return Response.json({ error: e.message }, { status: 502 });
    console.error(e);
    return Response.json({ error: "Error inesperado en el servidor" }, { status: 500 });
  }
}
