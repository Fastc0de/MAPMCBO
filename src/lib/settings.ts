/**
 * Ajustes que se pueden cambiar desde la app (botón «Ajustes»). El servidor los guarda en
 * `.env.local`, que no se sube al repo; el navegador nunca recibe las claves completas.
 */

export type SettingKind = "secret" | "text" | "url" | "models" | "toggle";

export interface SettingField {
  /** Variable de entorno donde se guarda. */
  env: string;
  label: string;
  kind: SettingKind;
  placeholder?: string;
  help?: string;
  /** Lo que se usa cuando está vacío. */
  defaultValue?: string;
}

export type ModelProviderId = "gemini" | "opencode-go" | "anthropic" | "custom";

export interface SettingsSection {
  id: "google" | ModelProviderId | "web";
  title: string;
  description: string;
  link?: { href: string; text: string };
  /** Proveedor de modelos: permite cargar la lista de modelos de la cuenta. */
  provider?: ModelProviderId;
  fields: SettingField[];
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "google",
    title: "Google Maps",
    description: "Una sola clave sirve para el mapa, la búsqueda de lugares, las direcciones y las rutas. La Maps Demo Key funciona.",
    link: { href: "https://console.cloud.google.com/google/maps-apis/credentials", text: "Claves en Google Cloud" },
    fields: [
      { env: "GOOGLE_MAPS_API_KEY", label: "Clave de Google Maps", kind: "secret", placeholder: "AIza…" },
      { env: "GOOGLE_MAPS_MAP_ID", label: "Map ID (opcional)", kind: "text", placeholder: "DEMO_MAP_ID" },
    ],
  },
  {
    id: "gemini",
    provider: "gemini",
    title: "Gemini",
    description: "Tiene nivel gratuito: la opción recomendada si no pagas ninguna API.",
    link: { href: "https://aistudio.google.com/apikey", text: "Crear clave en Google AI Studio" },
    fields: [
      { env: "GEMINI_API_KEY", label: "Clave", kind: "secret", placeholder: "AIza…" },
      { env: "GEMINI_MODELS", label: "Modelos", kind: "models", defaultValue: "gemini-3.8-flash" },
    ],
  },
  {
    id: "opencode-go",
    provider: "opencode-go",
    title: "OpenCode Go",
    description: "Tu suscripción de OpenCode. Solo funcionan los modelos que se sirven por chat/completions.",
    fields: [
      { env: "OPENCODE_GO_API_KEY", label: "Clave", kind: "secret" },
      { env: "OPENCODE_GO_MODELS", label: "Modelos", kind: "models", defaultValue: "kimi-k3,glm-5.3,deepseek-v4-pro" },
    ],
  },
  {
    id: "anthropic",
    provider: "anthropic",
    title: "Claude",
    description: "API de Anthropic, de pago por uso. La suscripción de claude.ai no sirve aquí.",
    fields: [
      { env: "ANTHROPIC_API_KEY", label: "Clave", kind: "secret", placeholder: "sk-ant-…" },
      { env: "ANTHROPIC_MODELS", label: "Modelos", kind: "models", defaultValue: "claude-opus-5-5,claude-sonnet-5-5" },
    ],
  },
  {
    id: "custom",
    provider: "custom",
    title: "Otro compatible con OpenAI",
    description: "OpenRouter, Ollama o LM Studio en tu PC, o cualquier API con /chat/completions.",
    fields: [
      { env: "OPENAI_COMPATIBLE_NAME", label: "Nombre", kind: "text", placeholder: "Ollama" },
      { env: "OPENAI_COMPATIBLE_BASE_URL", label: "URL base", kind: "url", placeholder: "http://localhost:11434/v1" },
      { env: "OPENAI_COMPATIBLE_API_KEY", label: "Clave (si hace falta)", kind: "secret" },
      { env: "OPENAI_COMPATIBLE_MODELS", label: "Modelos", kind: "models" },
    ],
  },
  {
    id: "web",
    title: "Búsqueda web",
    description: "Claude trae su propio buscador. Los demás modelos buscan en tu SearXNG, que la app arranca con Docker.",
    fields: [
      { env: "WEB_SEARCH_ENABLED", label: "Buscar en la web", kind: "toggle", defaultValue: "true" },
      { env: "SEARXNG_AUTOSTART", label: "Arrancar SearXNG automáticamente con Docker", kind: "toggle", defaultValue: "true" },
      { env: "SEARXNG_URL", label: "URL de SearXNG", kind: "url", defaultValue: "http://localhost:8888" },
    ],
  },
];

export const SETTINGS_FIELDS: SettingField[] = SETTINGS_SECTIONS.flatMap((s) => s.fields);

/** Valor actual de un ajuste. De las claves solo llegan los últimos caracteres. */
export interface SettingValue {
  set: boolean;
  value?: string;
  hint?: string;
}

export type SearxngState = "disabled" | "running" | "starting" | "stopped" | "down" | "no-docker" | "docker-off" | "error";

export interface SearxngStatus {
  state: SearxngState;
  url?: string;
  message: string;
  /** Si la app puede intentar arrancarlo (SearXNG local con Docker). */
  canStart: boolean;
  autostart: boolean;
}

export interface SettingsView {
  /** Solo se pueden cambiar abriendo la app en el mismo PC (localhost). */
  editable: boolean;
  reason?: string;
  file: string;
  values: Record<string, SettingValue>;
  warnings: string[];
  searxng: SearxngStatus;
}

/** Lista de modelos escrita como «a, b» o con saltos de línea. */
export function splitModels(value: string | undefined): string[] {
  return [
    ...new Set(
      (value ?? "")
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}
