import "server-only";

import { z } from "zod";
import { SETTINGS_FIELDS, splitModels, type SearxngStatus, type SettingField, type SettingsView, type SettingValue } from "@/lib/settings";
import type { SettingsAccess } from "./access";
import { ENV_FILE, envFilePath, writeEnvFile } from "./envfile";

type Env = Record<string, string | undefined>;

export class SettingsError extends Error {}

const FIELD_BY_ENV = new Map(SETTINGS_FIELDS.map((f) => [f.env, f]));

/** Lo que el navegador ve de una clave: solo si está puesta y sus últimos caracteres. */
export function maskSecret(value: string): string {
  return value.length >= 12 ? `…${value.slice(-4)}` : "…";
}

export function settingValues(env: Env): Record<string, SettingValue> {
  return Object.fromEntries(
    SETTINGS_FIELDS.map((f): [string, SettingValue] => {
      const value = env[f.env] || undefined;
      if (f.kind === "secret") return [f.env, value ? { set: true, hint: maskSecret(value) } : { set: false }];
      return [f.env, { set: Boolean(value), value }];
    }),
  );
}

function warnings(env: Env): string[] {
  const out: string[] = [];
  if (env.GOOGLE_MAPS_BROWSER_API_KEY) out.push("GOOGLE_MAPS_BROWSER_API_KEY (en .env.local) tiene prioridad sobre esta clave para el mapa.");
  if (env.GOOGLE_MAPS_SERVER_API_KEY) out.push("GOOGLE_MAPS_SERVER_API_KEY (en .env.local) tiene prioridad sobre esta clave para lugares, direcciones y rutas.");
  return out;
}

export function settingsView(env: Env, access: SettingsAccess, searxng: SearxngStatus): SettingsView {
  if (!access.ok) return { editable: false, reason: access.reason, file: ENV_FILE, values: {}, warnings: [], searxng };
  return { editable: true, file: ENV_FILE, values: settingValues(env), warnings: warnings(env), searxng };
}

export const updatesSchema = z.object({
  values: z.record(z.string(), z.string().max(2000).nullable()),
});

// Nada que pueda romper .env.local o que dotenv interprete: comillas, `$`, `\`, `#`, espacios ni saltos de línea.
const SECRET = /^[^\s"'`$\\#]{1,400}$/;
const URL_TEXT = /^[^\s"'`$\\#]{1,300}$/;
const MODEL_ID = /^[A-Za-z0-9._:/@+-]{1,100}$/;
const TEXT_PATTERNS: Record<string, { re: RegExp; error: string }> = {
  GOOGLE_MAPS_MAP_ID: { re: /^[A-Za-z0-9_-]{1,100}$/, error: "El Map ID solo puede tener letras, números, guiones y guiones bajos." },
  OPENAI_COMPATIBLE_NAME: { re: /^[\p{L}\p{N} ._()-]{1,40}$/u, error: "El nombre solo puede tener letras, números y espacios (máximo 40)." },
};

function validateField(field: SettingField, raw: string): string | null {
  const value = raw.trim();
  if (value === "") return null;
  switch (field.kind) {
    case "secret":
      if (!SECRET.test(value)) throw new SettingsError(`${field.label}: la clave tiene caracteres no válidos (espacios, comillas, $, # o \\).`);
      return value;
    case "url": {
      let url: URL | null = null;
      try {
        url = new URL(value);
      } catch {
        // abajo
      }
      if (!url || !["http:", "https:"].includes(url.protocol) || !URL_TEXT.test(value)) {
        throw new SettingsError(`${field.label}: escribe una URL completa, por ejemplo http://localhost:8888.`);
      }
      return value.replace(/\/+$/, "");
    }
    case "models": {
      const models = splitModels(value);
      const bad = models.find((m) => !MODEL_ID.test(m));
      if (bad) throw new SettingsError(`${field.label}: «${bad}» no parece un nombre de modelo.`);
      if (models.length > 50) throw new SettingsError(`${field.label}: como mucho 50 modelos.`);
      return models.join(",");
    }
    case "toggle":
      if (value !== "true" && value !== "false") throw new SettingsError(`${field.label}: valor no válido.`);
      return value;
    case "text": {
      const pattern = TEXT_PATTERNS[field.env];
      if (pattern && !pattern.re.test(value)) throw new SettingsError(pattern.error);
      if (!pattern && !URL_TEXT.test(value)) throw new SettingsError(`${field.label}: valor no válido.`);
      return value;
    }
  }
}

/** Solo se aceptan las variables de la pantalla de Ajustes, validadas. `null` = borrar. */
export function validateUpdates(values: Record<string, string | null>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [env, raw] of Object.entries(values)) {
    const field = FIELD_BY_ENV.get(env);
    if (!field) throw new SettingsError(`Ajuste desconocido: ${env}`);
    out[env] = raw === null ? null : validateField(field, raw);
  }
  return out;
}

/** Guarda en .env.local y aplica al proceso en marcha, sin reiniciar el servidor. */
export async function saveSettings(updates: Record<string, string | null>, env: Env = process.env, file = envFilePath()): Promise<void> {
  if (Object.keys(updates).length === 0) return;
  await writeEnvFile(file, updates);
  for (const [key, value] of Object.entries(updates)) {
    if (value) env[key] = value;
    else delete env[key];
  }
}
