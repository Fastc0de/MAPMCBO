import "server-only";

import type { SearxngStatus } from "@/lib/settings";
import { ProviderError, type WebSearchProvider } from "./types";

/** SearXNG no contesta (apagado o URL mala), a diferencia de un error de los buscadores. */
export class SearxngUnreachableError extends ProviderError {}

/**
 * Búsqueda web con un SearXNG propio (GET /search?format=json). El formato JSON tiene que
 * estar activado en su settings.yml (search.formats); el docker-compose del repo ya lo trae.
 */
export function createSearxngSearch(baseUrl: string, fetchImpl: typeof fetch = fetch): WebSearchProvider {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    async search(query, opts) {
      const qs = new URLSearchParams({ q: query, format: "json", language: "es", safesearch: "0" });
      if (opts?.recent) qs.set("time_range", "year");
      let res: Response;
      try {
        res = await fetchImpl(`${base}/search?${qs}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      } catch {
        throw new SearxngUnreachableError(
          `No se pudo conectar con SearXNG en ${base}. Arráncalo desde «Ajustes» o con «docker compose up -d».`,
          undefined,
          "SearXNG",
        );
      }
      if (res.status === 403) {
        throw new ProviderError("SearXNG no tiene activado el formato JSON (search.formats en settings.yml).", 403, "SearXNG");
      }
      if (!res.ok) throw new ProviderError(`SearXNG: HTTP ${res.status}`, res.status, "SearXNG");
      const data = (await res.json()) as {
        results?: { url?: string; title?: string; content?: string; publishedDate?: string | null }[];
        unresponsive_engines?: [string, string][];
      };
      // Sin resultados porque los buscadores fallaron no es lo mismo que "no hay información".
      if (!data.results?.length && data.unresponsive_engines?.length) {
        const engines = data.unresponsive_engines.map(([name, reason]) => `${name} (${reason})`).join(", ");
        throw new ProviderError(`SearXNG no obtuvo respuesta de los buscadores: ${engines}. Prueba más tarde.`, undefined, "SearXNG");
      }
      const seen = new Set<string>();
      const results = [];
      for (const r of data.results ?? []) {
        if (!r.url || seen.has(r.url)) continue;
        seen.add(r.url);
        results.push({ title: r.title || r.url, url: r.url, snippet: (r.content ?? "").slice(0, 1200), publishedDate: r.publishedDate ?? undefined });
        if (results.length >= Math.min(10, Math.max(1, opts?.maxResults ?? 6))) break;
      }
      return results;
    },
  };
}

/**
 * Si SearXNG no contesta, intenta arrancarlo (Docker) y repite la búsqueda una vez.
 * `ensure` devuelve el estado tras esperar a que arranque.
 */
export function withAutostart(search: WebSearchProvider, ensure: () => Promise<SearxngStatus>): WebSearchProvider {
  return {
    async search(query, opts) {
      try {
        return await search.search(query, opts);
      } catch (e) {
        if (!(e instanceof SearxngUnreachableError)) throw e;
        const status = await ensure();
        if (status.state !== "running") throw new ProviderError(`Búsqueda web no disponible: ${status.message}`, undefined, "SearXNG");
        return search.search(query, opts);
      }
    },
  };
}
