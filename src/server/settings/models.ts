import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { ModelProviderId } from "@/lib/settings";
import { PROVIDER_BASE_URLS, USER_AGENT } from "@/server/llm/catalog";

/** Lista de modelos de la cuenta de cada proveedor, para elegirlos en «Ajustes». */

type Env = Record<string, string | undefined>;

export class ModelListError extends Error {}

export interface ModelListDeps {
  fetch: typeof fetch;
  anthropic: (apiKey: string) => Pick<Anthropic, "models">;
}

const defaultDeps: ModelListDeps = {
  fetch: (input, init) => fetch(input, init),
  anthropic: (apiKey) => new Anthropic({ apiKey }),
};

// Gemini también lista modelos de embeddings, imágenes, vídeo o voz que no sirven para chatear.
const GEMINI_NOT_CHAT = /embed|imagen|veo|tts|aqa|image|audio|live|robotics|computer-use/i;

async function openAIModels(label: string, baseUrl: string, apiKey: string | undefined, fetchImpl: typeof fetch): Promise<string[]> {
  const base = baseUrl.replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetchImpl(`${base}/models`, {
      headers: { "User-Agent": USER_AGENT, ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ModelListError(`No se pudo conectar con ${label} (${new URL(base).host}).`);
  }
  if (!res.ok) {
    const detail = providerMessage(await res.text().catch(() => ""));
    // Gemini contesta 400 «API key not valid» a una clave mala.
    if (res.status === 401 || res.status === 403 || /api.?key/i.test(detail)) {
      throw new ModelListError(`${label} rechazó la clave (HTTP ${res.status}). Revisa que esté bien copiada.`);
    }
    throw new ModelListError(`${label} respondió HTTP ${res.status} al pedir la lista de modelos${detail ? `: ${detail}` : "."}`);
  }
  const data = (await res.json().catch(() => null)) as { data?: unknown; models?: unknown } | null;
  const items = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
  const ids = items
    .map((m: unknown) => (typeof m === "string" ? m : ((m as { id?: unknown; name?: unknown })?.id ?? (m as { name?: unknown })?.name)))
    .filter((id: unknown): id is string => typeof id === "string" && id.length > 0);
  return [...new Set(ids)].sort();
}

/** Mensaje de error de la respuesta (`{error:{message}}`, `[{error:…}]` o texto), corto. */
function providerMessage(text: string): string {
  try {
    const body = JSON.parse(text);
    const err = Array.isArray(body) ? body[0]?.error : body?.error;
    const message = typeof err === "string" ? err : err?.message;
    if (typeof message === "string") return message.slice(0, 200);
  } catch {
    // no es JSON
  }
  return text.trim().slice(0, 200);
}

/**
 * Pide la lista al proveedor con la clave escrita en el formulario o, si no hay, la guardada.
 * Las URL de Gemini, OpenCode Go y Anthropic son fijas; la del personalizado la pone el usuario.
 */
export async function listProviderModels(
  provider: ModelProviderId,
  opts: { apiKey?: string; baseUrl?: string },
  env: Env = process.env,
  deps: ModelListDeps = defaultDeps,
): Promise<string[]> {
  switch (provider) {
    case "gemini": {
      const key = opts.apiKey || env.GEMINI_API_KEY;
      if (!key) throw new ModelListError("Pon primero la clave de Gemini.");
      const ids = await openAIModels("Gemini", PROVIDER_BASE_URLS.gemini, key, deps.fetch);
      return ids.map((id) => id.replace(/^models\//, "")).filter((id) => !GEMINI_NOT_CHAT.test(id));
    }
    case "opencode-go": {
      const key = opts.apiKey || env.OPENCODE_GO_API_KEY;
      if (!key) throw new ModelListError("Pon primero la clave de OpenCode Go.");
      return openAIModels("OpenCode Go", PROVIDER_BASE_URLS["opencode-go"], key, deps.fetch);
    }
    case "custom": {
      const base = opts.baseUrl || env.OPENAI_COMPATIBLE_BASE_URL;
      let url: URL | null = null;
      try {
        url = base ? new URL(base) : null;
      } catch {
        // abajo
      }
      if (!url || !["http:", "https:"].includes(url.protocol)) throw new ModelListError("Pon primero la URL base del proveedor.");
      return openAIModels(env.OPENAI_COMPATIBLE_NAME || "El proveedor", url.toString(), opts.apiKey || env.OPENAI_COMPATIBLE_API_KEY, deps.fetch);
    }
    case "anthropic": {
      const key = opts.apiKey || env.ANTHROPIC_API_KEY;
      if (!key) throw new ModelListError("Pon primero la clave de Claude.");
      const ids: string[] = [];
      try {
        for await (const model of deps.anthropic(key).models.list({ limit: 100 })) ids.push(model.id);
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
          throw new ModelListError("Anthropic rechazó la clave. Revisa que esté bien copiada.");
        }
        if (e instanceof Anthropic.APIConnectionError) throw new ModelListError("No se pudo conectar con Anthropic.");
        if (e instanceof Anthropic.APIError) throw new ModelListError(`Anthropic respondió HTTP ${e.status ?? "?"} al pedir la lista de modelos.`);
        throw e;
      }
      return ids;
    }
  }
}
