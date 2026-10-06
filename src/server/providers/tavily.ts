import "server-only";

import { ProviderError, type WebSearchProvider } from "./types";

/** Búsqueda web con la API de Tavily (POST /search). Solo se usa con modelos que no traen búsqueda propia. */
export function createTavilySearch(apiKey: string, fetchImpl: typeof fetch = fetch): WebSearchProvider {
  return {
    async search(query, opts) {
      const res = await fetchImpl("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          query,
          max_results: Math.min(10, Math.max(1, opts?.maxResults ?? 6)),
          search_depth: "basic",
          topic: "general",
          ...(opts?.recent ? { time_range: "year" } : {}),
        }),
      });
      if (!res.ok) {
        let detail = res.statusText;
        try {
          const body = await res.json();
          detail = body?.detail?.error ?? body?.error ?? JSON.stringify(body).slice(0, 300);
        } catch {}
        throw new ProviderError(`Búsqueda web (Tavily): HTTP ${res.status} ${detail}`, res.status, "Tavily");
      }
      const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string; published_date?: string }[] };
      return (data.results ?? [])
        .filter((r) => r.url)
        .map((r) => ({ title: r.title || r.url!, url: r.url!, snippet: (r.content ?? "").slice(0, 1200), publishedDate: r.published_date }));
    },
  };
}
