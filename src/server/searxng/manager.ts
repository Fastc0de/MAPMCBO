import { spawn } from "node:child_process";
import path from "node:path";
import type { SearxngStatus } from "@/lib/settings";

/**
 * SearXNG local: comprueba si responde y, si su URL es de este PC, lo arranca con
 * `docker compose up -d searxng` usando el docker-compose.yml del repo.
 *
 * Sin `server-only` a propósito: también lo importa src/instrumentation.ts al arrancar el servidor.
 */

type Env = Record<string, string | undefined>;

export const DEFAULT_SEARXNG_URL = "http://localhost:8888";

/** URL de SearXNG, o nada si la búsqueda web está desactivada. */
export function searxngUrl(env: Env = process.env): string | undefined {
  if (env.WEB_SEARCH_ENABLED === "false") return undefined;
  return (env.SEARXNG_URL || DEFAULT_SEARXNG_URL).replace(/\/+$/, "");
}

export function isLocalUrl(url: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function autostartEnabled(env: Env = process.env): boolean {
  return env.SEARXNG_AUTOSTART !== "false";
}

export interface CommandResult {
  code: number | null;
  stderr: string;
  /** El programa no existe (Docker no instalado o fuera del PATH). */
  notFound: boolean;
}

export type RunCommand = (command: string, args: string[], opts: { cwd: string; timeoutMs: number }) => Promise<CommandResult>;

export const runCommand: RunCommand = (command, args, { cwd, timeoutMs }) =>
  new Promise((resolve) => {
    let stderr = "";
    const child = spawn(command, args, { cwd, timeout: timeoutMs, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 20_000) stderr += chunk.toString();
    });
    child.on("error", (e: NodeJS.ErrnoException) => resolve({ code: null, stderr: stderr || e.message, notFound: e.code === "ENOENT" }));
    child.on("close", (code) => resolve({ code, stderr, notFound: false }));
  });

type Problem = { state: "no-docker" | "docker-off" | "error"; message: string };

const NO_DOCKER: Problem = {
  state: "no-docker",
  message: "Docker no está instalado (o no está en el PATH). Instálalo para que SearXNG arranque solo; mientras tanto el chat funciona sin búsqueda web.",
};

export function classifyDockerError(stderr: string): Problem {
  if (/cannot connect to the docker daemon|docker daemon is not running|is the docker daemon running|error during connect|dockerDesktopLinuxEngine|docker_engine/i.test(stderr)) {
    return { state: "docker-off", message: "Docker está instalado pero no está abierto. Abre Docker Desktop y pulsa «Arrancar»." };
  }
  if (/permission denied/i.test(stderr)) {
    return { state: "error", message: "Tu usuario no tiene permiso para usar Docker (en Linux, añádelo al grupo docker)." };
  }
  if (/port is already allocated|address already in use/i.test(stderr)) {
    return { state: "error", message: "El puerto de SearXNG (8888) ya lo usa otro programa. Cámbialo en docker-compose.yml y en la URL de SearXNG." };
  }
  const last = stderr.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "error desconocido";
  return { state: "error", message: `Docker no pudo arrancar SearXNG: ${last.slice(0, 300)}` };
}

export interface SearxngManagerDeps {
  run: RunCommand;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  projectDir: string;
  log: (message: string) => void;
  /** Segundos que se espera a que responda tras `docker compose up`. */
  healthWaitSeconds?: number;
}

export interface SearxngManager {
  status(env?: Env): Promise<SearxngStatus>;
  /** Arranca SearXNG (si es local); si ya se está arrancando, devuelve ese mismo intento. */
  start(env?: Env): Promise<void>;
  /** Arranca SearXNG si no responde y espera como mucho `waitMs`. */
  ensure(env?: Env, waitMs?: number): Promise<SearxngStatus>;
}

export function createSearxngManager(deps: SearxngManagerDeps): SearxngManager {
  let starting: Promise<void> | undefined;
  let problem: Problem | undefined;

  const ping = async (url: string) => {
    try {
      const res = await deps.fetch(`${url}/healthz`, { signal: AbortSignal.timeout(2500) });
      return res.status < 500;
    } catch {
      return false;
    }
  };

  const status = async (env: Env = process.env): Promise<SearxngStatus> => {
    const url = searxngUrl(env);
    const autostart = autostartEnabled(env);
    if (!url) return { state: "disabled", message: "La búsqueda web está desactivada.", canStart: false, autostart };
    if (await ping(url)) {
      problem = undefined;
      return { state: "running", url, message: "SearXNG está funcionando.", canStart: false, autostart };
    }
    if (starting) {
      return {
        state: "starting",
        url,
        message: "Arrancando SearXNG con Docker… La primera vez descarga la imagen y puede tardar unos minutos.",
        canStart: false,
        autostart,
      };
    }
    if (!isLocalUrl(url)) {
      return { state: "down", url, message: `SearXNG no responde en ${url}. Como no está en este PC, la app no puede arrancarlo.`, canStart: false, autostart };
    }
    if (problem) return { ...problem, url, canStart: true, autostart };
    return { state: "stopped", url, message: "SearXNG está detenido.", canStart: true, autostart };
  };

  const start = (env: Env = process.env): Promise<void> => {
    const url = searxngUrl(env);
    if (!url || !isLocalUrl(url)) return Promise.resolve();
    if (starting) return starting;
    starting = (async () => {
      deps.log("Arrancando SearXNG con Docker…");
      const file = path.join(deps.projectDir, "docker-compose.yml");
      const opts = { cwd: deps.projectDir, timeoutMs: 15 * 60_000 };
      let result = await deps.run("docker", ["compose", "-f", file, "up", "-d", "searxng"], opts);
      // Docker antiguo sin el subcomando `compose`: se prueba con `docker-compose`.
      if (!result.notFound && result.code !== 0 && /not a docker command|unknown command|unknown flag|unknown shorthand/i.test(result.stderr)) {
        const legacy = await deps.run("docker-compose", ["-f", file, "up", "-d", "searxng"], opts);
        if (!legacy.notFound) result = legacy;
      }
      problem = result.notFound ? NO_DOCKER : result.code !== 0 ? classifyDockerError(result.stderr) : undefined;
      if (problem) {
        deps.log(problem.message);
        return;
      }
      for (let i = 0; i < (deps.healthWaitSeconds ?? 30); i++) {
        if (await ping(url)) {
          deps.log(`SearXNG listo en ${url}`);
          return;
        }
        await deps.sleep(1000);
      }
      problem = { state: "error", message: `Docker arrancó SearXNG pero no responde en ${url}. Mira «docker compose logs searxng».` };
      deps.log(problem.message);
    })().finally(() => {
      starting = undefined;
    });
    return starting;
  };

  const ensure = async (env: Env = process.env, waitMs = 0): Promise<SearxngStatus> => {
    const url = searxngUrl(env);
    if (url && isLocalUrl(url) && !(await ping(url))) {
      const attempt = start(env);
      if (waitMs > 0) await Promise.race([attempt, deps.sleep(waitMs)]);
    }
    return status(env);
  };

  return { status, start, ensure };
}

// Uno solo por proceso: en desarrollo Next recarga los módulos, pero globalThis se mantiene.
const holder = globalThis as { __mapmcboSearxng?: SearxngManager };

export function searxngManager(): SearxngManager {
  holder.__mapmcboSearxng ??= createSearxngManager({
    run: runCommand,
    fetch: (input, init) => fetch(input, init),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    projectDir: process.cwd(),
    log: (message) => console.log(`[SearXNG] ${message}`),
  });
  return holder.__mapmcboSearxng;
}

/** Al arrancar el servidor (o al cambiar los ajustes): pone en marcha SearXNG si toca, sin esperar. */
export function autostartSearxng(env: Env = process.env): void {
  const url = searxngUrl(env);
  if (!url || !isLocalUrl(url) || !autostartEnabled(env)) return;
  void searxngManager().ensure(env);
}
