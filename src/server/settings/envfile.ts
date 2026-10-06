import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Edición mínima de `.env.local`: cambia solo las líneas de las variables tocadas y deja
 * el resto (comentarios, otras variables, orden) como estaba.
 */

const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
const PLAIN_VALUE = /^[A-Za-z0-9_.,:/@+=-]*$/;
const HEADER = "# Guardado desde «Ajustes» en la app";

export const ENV_FILE = ".env.local";

export function envFilePath(dir = process.cwd()): string {
  return path.join(dir, ENV_FILE);
}

/** Los valores ya vienen validados (sin comillas, `$`, `\` ni saltos de línea). */
export function formatEnvValue(value: string): string {
  return PLAIN_VALUE.test(value) ? value : `"${value}"`;
}

/** `null` o "" deja la variable vacía (`CLAVE=`), igual que en `.env.example`. */
export function updateEnvText(text: string, updates: Record<string, string | null>): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text === "" ? [] : text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();

  const written = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const key = ASSIGNMENT.exec(line)?.[1];
    if (key === undefined || !Object.hasOwn(updates, key)) {
      out.push(line);
      continue;
    }
    // Si la variable estaba repetida, se queda una sola línea (la última ganaría al cargar).
    if (written.has(key)) continue;
    written.add(key);
    out.push(`${key}=${formatEnvValue(updates[key] ?? "")}`);
  }

  const appended = Object.entries(updates).filter(([key, value]) => !written.has(key) && value);
  if (appended.length > 0) {
    if (out.length > 0 && out.at(-1)!.trim() !== "") out.push("");
    if (!out.includes(HEADER)) out.push(HEADER);
    for (const [key, value] of appended) out.push(`${key}=${formatEnvValue(value!)}`);
  }
  return out.join(eol) + eol;
}

export async function writeEnvFile(file: string, updates: Record<string, string | null>): Promise<void> {
  let text = "";
  try {
    text = await fs.readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const next = updateEnvText(text, updates);
  // Escribir aparte y renombrar: si algo falla a mitad, .env.local no queda cortado.
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, next, { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, file);
}
