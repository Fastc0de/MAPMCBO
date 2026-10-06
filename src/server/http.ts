import "server-only";

import { z } from "zod";
import { getConfig } from "./config";
import { createGoogleProviders } from "./providers/google";
import { createPageReader } from "./providers/pages";
import { createSearxngSearch, withAutostart } from "./providers/searxng";
import { ProviderError, type Providers } from "./providers/types";
import { autostartEnabled, isLocalUrl, searxngManager } from "./searxng/manager";

export class ConfigError extends Error {}

export function getProviders(): Providers {
  const config = getConfig();
  if (!config.googleServerKey) throw new ConfigError("Falta la clave de Google Maps. Ponla en «Ajustes».");
  const providers = createGoogleProviders(config.googleServerKey);
  if (config.searxngUrl) {
    const search = createSearxngSearch(config.searxngUrl);
    // SearXNG local apagado: se arranca con Docker y se espera un poco antes de rendirse.
    providers.web =
      autostartEnabled() && isLocalUrl(config.searxngUrl) ? withAutostart(search, () => searxngManager().ensure(process.env, 45_000)) : search;
    providers.pages = createPageReader();
  }
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
