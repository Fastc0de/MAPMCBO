import "server-only";

import { ProviderError, type PageReader } from "./types";

/**
 * Lector de páginas web: descarga el HTML y se queda con el texto legible.
 * Solo http(s) a hosts públicos, siguiendo como mucho 3 redirecciones y leyendo hasta 2 MB.
 */

const MAX_BYTES = 2_000_000;
const MAX_CHARS = 8000;

export function isPublicHttpUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) {
      return false;
    }
  }
  if (host.includes(":")) return false; // IPv6 literal: no se admite
  return true;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Texto legible de un HTML: prioriza <article>/<main>, quita scripts, estilos y navegación. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = decodeEntities((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim());
  let body = html.replace(/<!--[\s\S]*?-->/g, "");
  body = body.replace(/<(script|style|noscript|svg|template|iframe|nav|footer|form)\b[\s\S]*?<\/\1>/gi, " ");
  const main = /<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(body)?.[2];
  if (main && main.length > 500) body = main;
  const text = decodeEntities(
    body
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n• ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text };
}

async function readLimited(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size >= MAX_BYTES) {
      await reader.cancel();
      break;
    }
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export function createPageReader(fetchImpl: typeof fetch = fetch, userAgent = "mapa-maracaibo/0.2"): PageReader {
  return {
    async read(startUrl) {
      let url = startUrl;
      for (let hop = 0; hop <= 3; hop++) {
        if (!isPublicHttpUrl(url)) throw new ProviderError("Solo se pueden leer páginas web públicas (http/https).", undefined, "Web");
        let res: Response;
        try {
          res = await fetchImpl(url, {
            redirect: "manual",
            headers: { "User-Agent": userAgent, Accept: "text/html,text/plain;q=0.9" },
            signal: AbortSignal.timeout(15_000),
          });
        } catch {
          throw new ProviderError(`No se pudo abrir ${url}.`, undefined, "Web");
        }
        if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
          url = new URL(res.headers.get("location")!, url).toString();
          continue;
        }
        if (!res.ok) throw new ProviderError(`La página respondió HTTP ${res.status}.`, res.status, "Web");
        const type = res.headers.get("content-type") ?? "";
        if (!/text\/html|text\/plain|application\/xhtml\+xml/i.test(type)) {
          throw new ProviderError(`La página no es texto (${type || "tipo desconocido"}).`, undefined, "Web");
        }
        const raw = await readLimited(res);
        const { title, text } = /text\/plain/i.test(type) ? { title: "", text: raw.trim() } : htmlToText(raw);
        return { url, title: title || url, text: text.slice(0, MAX_CHARS), truncated: text.length > MAX_CHARS };
      }
      throw new ProviderError("Demasiadas redirecciones.", undefined, "Web");
    },
  };
}
