import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSearxngSearch, withAutostart } from "@/server/providers/searxng";
import { ProviderError, type WebSearchProvider } from "@/server/providers/types";
import { createSearxngManager, searxngUrl, type CommandResult, type RunCommand } from "@/server/searxng/manager";
import { settingsAccess } from "@/server/settings/access";
import { updateEnvText } from "@/server/settings/envfile";
import { listProviderModels, ModelListError, type ModelListDeps } from "@/server/settings/models";
import { saveSettings, SettingsError, settingsView, settingValues, validateUpdates } from "@/server/settings/store";

describe(".env.local", () => {
  it("cambia solo las líneas tocadas y conserva comentarios y el resto", () => {
    const before = "# Google\nGOOGLE_MAPS_API_KEY=\n\n# Otros\nOTRA=1\nexport GEMINI_API_KEY=vieja\n";
    const after = updateEnvText(before, { GOOGLE_MAPS_API_KEY: "AIzaNueva", GEMINI_API_KEY: "g-1" });
    expect(after).toBe("# Google\nGOOGLE_MAPS_API_KEY=AIzaNueva\n\n# Otros\nOTRA=1\nGEMINI_API_KEY=g-1\n");
  });

  it("añade al final las que no estaban, y borrar deja la variable vacía", () => {
    const after = updateEnvText("OTRA=1", { OPENCODE_GO_API_KEY: "oc_sk_a__b-c", OTRA: null, NADA: null });
    expect(after).toBe("OTRA=\n\n# Guardado desde «Ajustes» en la app\nOPENCODE_GO_API_KEY=oc_sk_a__b-c\n");
    expect(updateEnvText("", { A: "1" })).toBe("# Guardado desde «Ajustes» en la app\nA=1\n");
  });

  it("respeta los saltos de línea de Windows, quita duplicados y pone comillas si hay espacios", () => {
    const after = updateEnvText("A=1\r\nB=2\r\nA=3\r\n", { A: "x", OPENAI_COMPATIBLE_NAME: "LM Studio" });
    expect(after).toBe('A=x\r\nB=2\r\n\r\n# Guardado desde «Ajustes» en la app\r\nOPENAI_COMPATIBLE_NAME="LM Studio"\r\n');
  });

  it("guarda en el archivo y aplica al proceso sin reiniciar", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mapmcbo-"));
    try {
      const file = path.join(dir, ".env.local");
      await writeFile(file, "GEMINI_API_KEY=vieja\nANTHROPIC_API_KEY=a\n");
      const env: Record<string, string | undefined> = { GEMINI_API_KEY: "vieja", ANTHROPIC_API_KEY: "a" };
      await saveSettings({ GEMINI_API_KEY: "nueva", ANTHROPIC_API_KEY: null }, env, file);
      expect(await readFile(file, "utf8")).toBe("GEMINI_API_KEY=nueva\nANTHROPIC_API_KEY=\n");
      expect(env).toEqual({ GEMINI_API_KEY: "nueva" });
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

describe("validación de ajustes", () => {
  it("acepta claves, listas de modelos, URLs e interruptores", () => {
    expect(
      validateUpdates({
        OPENCODE_GO_API_KEY: "  oc_sk_7c61__AjM7-x ",
        GEMINI_MODELS: "gemini-3.8-flash,\n gemini-3.8-pro , gemini-3.8-flash",
        SEARXNG_URL: "http://localhost:8888/",
        WEB_SEARCH_ENABLED: "false",
        GEMINI_API_KEY: null,
        OPENAI_COMPATIBLE_NAME: "",
      }),
    ).toEqual({
      OPENCODE_GO_API_KEY: "oc_sk_7c61__AjM7-x",
      GEMINI_MODELS: "gemini-3.8-flash,gemini-3.8-pro",
      SEARXNG_URL: "http://localhost:8888",
      WEB_SEARCH_ENABLED: "false",
      GEMINI_API_KEY: null,
      OPENAI_COMPATIBLE_NAME: null,
    });
  });

  it("rechaza variables desconocidas y valores que romperían .env.local", () => {
    expect(() => validateUpdates({ PATH: "/tmp" })).toThrow(SettingsError);
    expect(() => validateUpdates({ GEMINI_API_KEY: "abc\nINYECTADA=1" })).toThrow(/caracteres no válidos/);
    expect(() => validateUpdates({ GEMINI_API_KEY: "abc$HOME" })).toThrow(SettingsError);
    expect(() => validateUpdates({ SEARXNG_URL: "file:///etc/passwd" })).toThrow(/URL completa/);
    expect(() => validateUpdates({ GEMINI_MODELS: "bien, mal modelo" })).toThrow(/mal modelo/);
    expect(() => validateUpdates({ WEB_SEARCH_ENABLED: "quizás" })).toThrow(SettingsError);
    expect(() => validateUpdates({ GOOGLE_MAPS_MAP_ID: "id con espacios" })).toThrow(/Map ID/);
  });

  it("el navegador solo ve si hay clave y sus últimos caracteres", () => {
    const values = settingValues({ GEMINI_API_KEY: "AIzaSyAbCdEfGhIjKl1234", GEMINI_MODELS: "a,b", OPENCODE_GO_API_KEY: "" });
    expect(values.GEMINI_API_KEY).toEqual({ set: true, hint: "…1234" });
    expect(JSON.stringify(values)).not.toContain("AIzaSy");
    expect(values.GEMINI_MODELS).toEqual({ set: true, value: "a,b" });
    expect(values.OPENCODE_GO_API_KEY).toEqual({ set: false });
    expect(settingValues({ ANTHROPIC_API_KEY: "corta" }).ANTHROPIC_API_KEY).toEqual({ set: true, hint: "…" });
  });

  it("sin acceso no se devuelve ningún valor", () => {
    const searxng = { state: "disabled" as const, message: "", canStart: false, autostart: true };
    const view = settingsView({ GEMINI_API_KEY: "AIzaSyAbCdEfGhIjKl1234" }, { ok: false, reason: "no" }, searxng);
    expect(view).toMatchObject({ editable: false, reason: "no", values: {} });
  });
});

describe("acceso a los ajustes", () => {
  const req = (headers: Record<string, string>) => new Request("http://localhost:3000/api/settings", { headers });
  const local = { host: "localhost:3000", "x-forwarded-for": "::1" };

  it("desde el mismo PC y la propia app, sí", () => {
    expect(settingsAccess(req(local))).toEqual({ ok: true });
    expect(settingsAccess(req({ host: "127.0.0.1:3000", "x-forwarded-for": "::ffff:127.0.0.1" }))).toEqual({ ok: true });
    const put = req({ ...local, origin: "http://localhost:3000", "content-type": "application/json" });
    expect(settingsAccess(put, { mutating: true })).toEqual({ ok: true });
  });

  it("desde otro aparato de la red o con SETTINGS_UI=off, no", () => {
    expect(settingsAccess(req({ host: "192.168.1.20:3000" })).ok).toBe(false);
    expect(settingsAccess(req({ host: "localhost:3000", "x-forwarded-for": "192.168.1.30" })).ok).toBe(false);
    expect(settingsAccess(req(local), {}, { SETTINGS_UI: "off" }).ok).toBe(false);
  });

  it("una web cualquiera (CSRF o DNS rebinding) no puede leer ni cambiar nada", () => {
    expect(settingsAccess(req({ ...local, origin: "https://malo.example" })).ok).toBe(false);
    expect(settingsAccess(req({ host: "malo.example:3000", "x-forwarded-for": "127.0.0.1" })).ok).toBe(false);
    expect(settingsAccess(req({ ...local, origin: "null" })).ok).toBe(false);
    // Un POST sin Origin o sin JSON no viene de la app.
    expect(settingsAccess(req({ ...local, "content-type": "application/json" }), { mutating: true }).ok).toBe(false);
    expect(settingsAccess(req({ ...local, origin: "http://localhost:3000", "content-type": "text/plain" }), { mutating: true }).ok).toBe(false);
  });
});

describe("lista de modelos de la cuenta", () => {
  const calls: { url: string; auth: string | null }[] = [];
  afterEach(() => {
    calls.length = 0;
  });
  const deps = (respond: (url: string) => Response): ModelListDeps => ({
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
      return respond(url);
    }) as unknown as typeof fetch,
    anthropic: () => {
      throw new Error("no debería usarse");
    },
  });

  it("Gemini: quita el prefijo models/ y los que no son de chat", async () => {
    const d = deps(() =>
      Response.json({ data: [{ id: "models/gemini-3.8-flash" }, { id: "models/text-embedding-004" }, { id: "models/gemini-3.8-pro" }, { id: "models/imagen-4" }] }),
    );
    expect(await listProviderModels("gemini", {}, { GEMINI_API_KEY: "g" }, d)).toEqual(["gemini-3.8-flash", "gemini-3.8-pro"]);
    expect(calls[0]).toEqual({ url: "https://generativelanguage.googleapis.com/v1beta/openai/models", auth: "Bearer g" });
  });

  it("usa la clave recién escrita antes que la guardada, y explica una clave mala", async () => {
    const ok = deps(() => Response.json({ data: [{ id: "kimi-k3" }, { id: "glm-5.3" }] }));
    expect(await listProviderModels("opencode-go", { apiKey: "nueva" }, { OPENCODE_GO_API_KEY: "vieja" }, ok)).toEqual(["glm-5.3", "kimi-k3"]);
    expect(calls[0]).toEqual({ url: "https://opencode.ai/zen/go/v1/models", auth: "Bearer nueva" });
    const denied = deps(() => new Response("no", { status: 401 }));
    await expect(listProviderModels("opencode-go", {}, { OPENCODE_GO_API_KEY: "x" }, denied)).rejects.toThrow(/rechazó la clave/);
    await expect(listProviderModels("gemini", {}, {}, ok)).rejects.toThrow(ModelListError);
    const geminiBadKey = deps(() => Response.json([{ error: { code: 400, message: "API key not valid. Please pass a valid API key." } }], { status: 400 }));
    await expect(listProviderModels("gemini", {}, { GEMINI_API_KEY: "x" }, geminiBadKey)).rejects.toThrow(/Gemini rechazó la clave/);
    const down = deps(() => Response.json({ error: { message: "mantenimiento" } }, { status: 503 }));
    await expect(listProviderModels("opencode-go", {}, { OPENCODE_GO_API_KEY: "x" }, down)).rejects.toThrow("OpenCode Go respondió HTTP 503 al pedir la lista de modelos: mantenimiento");
  });

  it("personalizado: la URL base del formulario, sin clave si no hace falta", async () => {
    const d = deps(() => Response.json({ data: [{ id: "qwen3:8b" }] }));
    expect(await listProviderModels("custom", { baseUrl: "http://localhost:11434/v1/" }, {}, d)).toEqual(["qwen3:8b"]);
    expect(calls[0]).toEqual({ url: "http://localhost:11434/v1/models", auth: null });
    await expect(listProviderModels("custom", { baseUrl: "ftp://x" }, {}, d)).rejects.toThrow(/URL base/);
  });

  it("Claude: con el SDK de Anthropic", async () => {
    const d: ModelListDeps = {
      fetch: (async () => {
        throw new Error("no");
      }) as unknown as typeof fetch,
      anthropic: (key) => {
        expect(key).toBe("sk-ant-x");
        return {
          models: {
            async *list() {
              yield { id: "claude-opus-5-5" };
              yield { id: "claude-sonnet-5-5" };
            },
          },
        } as unknown as ReturnType<ModelListDeps["anthropic"]>;
      },
    };
    expect(await listProviderModels("anthropic", {}, { ANTHROPIC_API_KEY: "sk-ant-x" }, d)).toEqual(["claude-opus-5-5", "claude-sonnet-5-5"]);
  });
});

describe("SearXNG automático", () => {
  const ok: CommandResult = { code: 0, stderr: "", notFound: false };

  function setup(opts: { up?: boolean; afterStart?: boolean; run?: RunCommand } = {}) {
    let up = opts.up ?? false;
    const commands: string[] = [];
    const manager = createSearxngManager({
      run:
        opts.run ??
        (async (cmd, args) => {
          commands.push([cmd, ...args].join(" "));
          up = opts.afterStart ?? true;
          return ok;
        }),
      fetch: (async () => {
        if (!up) throw new TypeError("fetch failed");
        return new Response("OK");
      }) as unknown as typeof fetch,
      sleep: async () => {},
      projectDir: "/proyecto",
      log: () => {},
      healthWaitSeconds: 3,
    });
    return { manager, commands };
  }

  it("la URL por defecto es la del docker-compose del repo, y se puede apagar", () => {
    expect(searxngUrl({})).toBe("http://localhost:8888");
    expect(searxngUrl({ SEARXNG_URL: "http://127.0.0.1:9000/" })).toBe("http://127.0.0.1:9000");
    expect(searxngUrl({ WEB_SEARCH_ENABLED: "false" })).toBeUndefined();
  });

  it("si no responde, lo arranca con docker compose una sola vez aunque lo pidan varios", async () => {
    const { manager, commands } = setup();
    expect((await manager.status({})).state).toBe("stopped");
    const [a, b] = await Promise.all([manager.ensure({}, 1000), manager.ensure({}, 1000)]);
    expect(a.state).toBe("running");
    expect(b.state).toBe("running");
    expect(commands).toEqual([`docker compose -f ${path.join("/proyecto", "docker-compose.yml")} up -d searxng`]);
  });

  it("si ya funciona o no es local, no ejecuta nada", async () => {
    const running = setup({ up: true });
    expect((await running.manager.ensure({})).state).toBe("running");
    const remote = setup();
    expect((await remote.manager.ensure({ SEARXNG_URL: "https://searx.example" }, 1000)).state).toBe("down");
    expect([...running.commands, ...remote.commands]).toEqual([]);
  });

  it("explica si Docker no está instalado o no está abierto", async () => {
    const missing = setup({ run: async () => ({ code: null, stderr: "spawn docker ENOENT", notFound: true }) });
    expect(await missing.manager.ensure({}, 1000)).toMatchObject({ state: "no-docker", canStart: true });
    const closed = setup({
      run: async () => ({ code: 1, stderr: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?", notFound: false }),
    });
    expect(await closed.manager.ensure({}, 1000)).toMatchObject({ state: "docker-off", message: expect.stringMatching(/Docker Desktop/) });
  });

  it("con Docker antiguo prueba docker-compose", async () => {
    const commands: string[] = [];
    let up = false;
    const { manager } = setup({
      run: async (cmd) => {
        commands.push(cmd);
        if (cmd === "docker") return { code: 1, stderr: "docker: 'compose' is not a docker command.", notFound: false };
        up = true;
        return ok;
      },
    });
    // El fetch del setup no ve `up`: se comprueba solo qué comandos se probaron.
    await manager.start({});
    expect(commands).toEqual(["docker", "docker-compose"]);
    expect(up).toBe(true);
  });

  it("si arranca pero no responde, lo dice", async () => {
    const { manager } = setup({ afterStart: false });
    await manager.start({});
    expect(await manager.status({})).toMatchObject({ state: "error", message: expect.stringMatching(/no responde/) });
  });

  it("la búsqueda lo arranca y repite una vez; si no puede, da el motivo", async () => {
    let up = false;
    const search = createSearxngSearch("http://localhost:8888", (async () => {
      if (!up) throw new TypeError("fetch failed");
      return Response.json({ results: [{ url: "https://a.b", title: "A", content: "x" }] });
    }) as unknown as typeof fetch);
    const started = withAutostart(search, async () => {
      up = true;
      return { state: "running", message: "", canStart: false, autostart: true };
    });
    expect(await started.search("ruta")).toHaveLength(1);

    const failing: WebSearchProvider = withAutostart(createSearxngSearch("http://localhost:8888", (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch), async () => ({ state: "no-docker", message: "Docker no está instalado.", canStart: true, autostart: true }));
    await expect(failing.search("ruta")).rejects.toThrow(ProviderError);
    await expect(failing.search("ruta")).rejects.toThrow("Búsqueda web no disponible: Docker no está instalado.");
  });
});
