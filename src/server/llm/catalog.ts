import "server-only";

import type { HistoryFormat, ModelOption } from "@/lib/chat/models";

/**
 * Proveedores de modelos para el chat. Cada uno se activa con su clave en el entorno;
 * el navegador solo ve la lista de modelos disponibles, nunca las claves.
 *
 * - Claude (Anthropic): API de Messages con búsqueda web de servidor.
 * - OpenCode Go, Gemini y uno personalizado: APIs compatibles con OpenAI (chat/completions).
 *   Para buscar en la web usan Tavily si hay TAVILY_API_KEY.
 */

export interface LlmProvider {
  id: string;
  label: string;
  format: HistoryFormat;
  apiKey?: string;
  /** Solo proveedores compatibles con OpenAI: URL base sin `/chat/completions`. */
  baseUrl?: string;
  /** Cabeceras extra que pide el proveedor. */
  headers?: Record<string, string>;
  /** OpenCode Go pide un id de sesión estable por conversación. */
  sessionHeader?: string;
  models: { id: string; label: string }[];
}

export interface ResolvedModel {
  option: ModelOption;
  provider: LlmProvider;
  model: string;
}

type Env = Record<string, string | undefined>;

export const USER_AGENT = "mapa-maracaibo/0.2";

const list = (value: string | undefined, fallback: string[]) => {
  const items = (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
};

const CLAUDE_LABELS: Record<string, string> = {
  "claude-opus-5-5": "Claude Opus 5.5",
  "claude-sonnet-5-5": "Claude Sonnet 5.5",
};

export function configuredProviders(env: Env = process.env): LlmProvider[] {
  const providers: LlmProvider[] = [];

  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) {
    const models = list(env.ANTHROPIC_MODELS, ["claude-opus-5-5", "claude-sonnet-5-5"]);
    // ANTHROPIC_MODEL (de la primera versión) sigue funcionando: va primero.
    if (env.ANTHROPIC_MODEL && !models.includes(env.ANTHROPIC_MODEL)) models.unshift(env.ANTHROPIC_MODEL);
    providers.push({
      id: "anthropic",
      label: "Claude",
      format: "anthropic",
      models: models.map((m) => ({ id: m, label: CLAUDE_LABELS[m] ?? m })),
    });
  }

  if (env.GEMINI_API_KEY) {
    providers.push({
      id: "gemini",
      label: "Gemini",
      format: "openai",
      apiKey: env.GEMINI_API_KEY,
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      models: list(env.GEMINI_MODELS, ["gemini-3.8-flash"]).map((m) => ({ id: m, label: m })),
    });
  }

  if (env.OPENCODE_GO_API_KEY) {
    providers.push({
      id: "opencode-go",
      label: "OpenCode Go",
      format: "openai",
      apiKey: env.OPENCODE_GO_API_KEY,
      baseUrl: "https://opencode.ai/zen/go/v1",
      sessionHeader: "x-opencode-session",
      // Solo modelos servidos por /chat/completions (los de /messages o /responses no se admiten aquí).
      models: list(env.OPENCODE_GO_MODELS, ["kimi-k3", "glm-5.3", "deepseek-v4-pro"]).map((m) => ({ id: m, label: m })),
    });
  }

  if (env.OPENAI_COMPATIBLE_BASE_URL) {
    const models = list(env.OPENAI_COMPATIBLE_MODELS, []);
    if (models.length > 0) {
      providers.push({
        id: "custom",
        label: env.OPENAI_COMPATIBLE_NAME || "Personalizado",
        format: "openai",
        apiKey: env.OPENAI_COMPATIBLE_API_KEY,
        baseUrl: env.OPENAI_COMPATIBLE_BASE_URL.replace(/\/+$/, ""),
        models: models.map((m) => ({ id: m, label: m })),
      });
    }
  }

  return providers;
}

/** ¿Hay búsqueda web para este formato? Claude usa la suya; los demás, Tavily. */
export function webSearchAvailable(format: HistoryFormat, env: Env = process.env): boolean {
  if (env.WEB_SEARCH_ENABLED === "false") return false;
  return format === "anthropic" || Boolean(env.TAVILY_API_KEY);
}

export function availableModels(env: Env = process.env): ModelOption[] {
  const options = configuredProviders(env).flatMap((p) =>
    p.models.map(
      (m): ModelOption => ({
        id: `${p.id}:${m.id}`,
        label: m.label,
        providerLabel: p.label,
        format: p.format,
        webSearch: webSearchAvailable(p.format, env),
      }),
    ),
  );
  // LLM_DEFAULT_MODEL (`proveedor:modelo`) decide cuál aparece primero.
  const preferred = options.findIndex((o) => o.id === env.LLM_DEFAULT_MODEL);
  if (preferred > 0) options.unshift(...options.splice(preferred, 1));
  return options;
}

/** Resuelve el modelo pedido por el navegador; sin id (o si ya no existe), el primero disponible. */
export function resolveModel(id: string | undefined, env: Env = process.env): ResolvedModel | null {
  const options = availableModels(env);
  const option = options.find((o) => o.id === id) ?? options[0];
  if (!option) return null;
  const providerId = option.id.slice(0, option.id.indexOf(":"));
  const provider = configuredProviders(env).find((p) => p.id === providerId)!;
  return { option, provider, model: option.id.slice(providerId.length + 1) };
}
