import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@/lib/chat/events";
import { transcriptHistory } from "@/lib/chat/models";
import {
  openAICompatibleCall,
  runOpenAICompatibleTurn,
  toFunctionParameters,
  type ChatCall,
  type ChatMessage,
  type ChatTurn,
} from "@/server/agent/openai";
import { availableModels, resolveModel } from "@/server/llm/catalog";
import { createPageReader, htmlToText, isPublicHttpUrl } from "@/server/providers/pages";
import { createSearxngSearch } from "@/server/providers/searxng";
import { TOOL_BY_NAME } from "@/server/tools/registry";
import { fakeProviders, mapContextAtMaracaibo } from "./fakes";

describe("catálogo de modelos", () => {
  it("sin claves no hay modelos", () => {
    expect(availableModels({})).toEqual([]);
    expect(resolveModel(undefined, {})).toBeNull();
  });

  it("cada clave activa su proveedor, con modelos por defecto o los del entorno", () => {
    const env = {
      GEMINI_API_KEY: "g",
      OPENCODE_GO_API_KEY: "o",
      OPENCODE_GO_MODELS: "kimi-k3, glm-5.3",
      ANTHROPIC_API_KEY: "a",
    };
    const ids = availableModels(env).map((m) => m.id);
    expect(ids).toEqual([
      "anthropic:claude-opus-5-5",
      "anthropic:claude-sonnet-5-5",
      "gemini:gemini-3.8-flash",
      "opencode-go:kimi-k3",
      "opencode-go:glm-5.3",
    ]);
  });

  it("LLM_DEFAULT_MODEL va primero y la búsqueda web depende del proveedor", () => {
    const env = { GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a", LLM_DEFAULT_MODEL: "gemini:gemini-3.8-flash" };
    const models = availableModels(env);
    expect(models[0]).toMatchObject({ id: "gemini:gemini-3.8-flash", format: "openai", webSearch: false });
    expect(models.find((m) => m.id.startsWith("anthropic"))?.webSearch).toBe(true);
    expect(availableModels({ ...env, SEARXNG_URL: "http://localhost:8888" })[0].webSearch).toBe(true);
    expect(availableModels({ ...env, WEB_SEARCH_ENABLED: "false" }).some((m) => m.webSearch)).toBe(false);
  });

  it("resuelve el modelo pedido o cae en el primero; el personalizado necesita modelos", () => {
    const env = {
      OPENAI_COMPATIBLE_BASE_URL: "http://localhost:11434/v1/",
      OPENAI_COMPATIBLE_MODELS: "qwen3:8b",
      OPENAI_COMPATIBLE_NAME: "Ollama",
    };
    const r = resolveModel("custom:qwen3:8b", env)!;
    expect(r.model).toBe("qwen3:8b");
    expect(r.provider).toMatchObject({ label: "Ollama", baseUrl: "http://localhost:11434/v1", apiKey: undefined });
    expect(resolveModel("gemini:otro", env)!.option.id).toBe("custom:qwen3:8b");
    expect(availableModels({ OPENAI_COMPATIBLE_BASE_URL: "http://x" })).toEqual([]);
  });

  it("OpenCode Go usa su endpoint y pide id de sesión", () => {
    const r = resolveModel(undefined, { OPENCODE_GO_API_KEY: "o" })!;
    expect(r.provider).toMatchObject({ baseUrl: "https://opencode.ai/zen/go/v1", sessionHeader: "x-opencode-session" });
    expect(r.model).toBe("kimi-k3");
  });
});

describe("historial al cambiar de proveedor", () => {
  it("convierte lo visible en texto, une turnos seguidos y quita los extremos sueltos", () => {
    expect(
      transcriptHistory([
        { role: "assistant", text: "saludo suelto" },
        { role: "user", text: "hola" },
        { role: "user", text: "¿sigues ahí?" },
        { role: "assistant", text: "" },
        { role: "assistant", text: "Sí." },
        { role: "user", text: "pregunta sin respuesta" },
      ]),
    ).toEqual([
      { role: "user", content: "hola\n\n¿sigues ahí?" },
      { role: "assistant", content: "Sí." },
    ]);
  });
});

/** Respuesta SSE como la de chat/completions con streaming. */
function sse(chunks: unknown[], status = 200): Response {
  const body = chunks.map((c) => `data: ${typeof c === "string" ? c : JSON.stringify(c)}\n\n`).join("");
  return new Response(body, { status, headers: { "Content-Type": "text/event-stream" } });
}

describe("cliente chat/completions", () => {
  it("envía la petición con streaming, cabeceras y clave, y junta texto y llamadas a herramientas", async () => {
    let request: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      request = { url, init };
      return sse([
        { choices: [{ delta: { content: "Hola, " } }] },
        { choices: [{ delta: { content: "busco.", reasoning_content: "pienso" } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "search_places", arguments: '{"que' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ry":"farmacia"}' } }] } }] },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
        "[DONE]",
      ]);
    }) as unknown as typeof fetch;
    const deltas: string[] = [];
    const call = openAICompatibleCall({ baseUrl: "https://api.x/v1", apiKey: "K", headers: { "x-opencode-session": "s1" }, providerLabel: "X" }, fetchImpl);
    const turn = await call({ model: "m", messages: [] }, (d) => deltas.push(d));

    expect(request!.url).toBe("https://api.x/v1/chat/completions");
    const headers = request!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer K");
    expect(headers["x-opencode-session"]).toBe("s1");
    expect(JSON.parse(request!.init.body as string)).toMatchObject({ model: "m", stream: true });
    expect(deltas.join("")).toBe("Hola, busco.");
    expect(turn).toEqual({
      content: "Hola, busco.",
      finishReason: "tool_calls",
      reasoning: "pienso",
      toolCalls: [{ id: "c1", type: "function", function: { name: "search_places", arguments: '{"query":"farmacia"}' } }],
    });
  });

  it("los errores HTTP y los errores dentro del stream se convierten en LlmError", async () => {
    const httpError = (async () =>
      new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 401 })) as unknown as typeof fetch;
    await expect(openAICompatibleCall({ baseUrl: "u", providerLabel: "X" }, httpError)({}, () => {})).rejects.toMatchObject({
      name: "LlmError",
      status: 401,
      message: "Invalid API key",
    });
    const streamError = (async () => sse([{ error: { message: "overloaded" } }])) as unknown as typeof fetch;
    await expect(openAICompatibleCall({ baseUrl: "u", providerLabel: "X" }, streamError)({}, () => {})).rejects.toThrow("overloaded");
  });
});

describe("esquemas para proveedores compatibles con OpenAI", () => {
  it("sin oneOf, const ni propertyNames", () => {
    for (const tool of TOOL_BY_NAME.values()) {
      const json = JSON.stringify(toFunctionParameters(tool));
      expect(json).not.toMatch(/"oneOf"|"const"|"propertyNames"/);
    }
  });
});

function turn(partial: Partial<ChatTurn>): ChatTurn {
  return { content: "", toolCalls: [], finishReason: "stop", ...partial };
}

const toolCall = (id: string, name: string, args: string) => ({ id, type: "function" as const, function: { name, arguments: args } });

async function runTurns(turns: ChatTurn[], opts: { web?: boolean; history?: ChatMessage[] } = {}) {
  const { providers, log } = fakeProviders();
  if (opts.web) {
    providers.web = { search: async () => [{ title: "Ruta 5", url: "https://ejemplo.org/ruta5", snippet: "Pasa por la Curva de Molina" }] };
    providers.pages = { read: async (url) => ({ url, title: "Ruta 5", text: "Paradas: A, B", truncated: false }) };
  }
  const requests: Record<string, unknown>[] = [];
  const callModel: ChatCall = async (body, onText) => {
    requests.push(structuredClone(body));
    const next = turns.shift()!;
    if (next.content) onText(next.content);
    return next;
  };
  const events: AgentEvent[] = [];
  const messages = await runOpenAICompatibleTurn(
    { history: opts.history ?? [], userText: "¿Dónde hay farmacias?", mapContext: mapContextAtMaracaibo(), progress: {} },
    { providers, callModel, model: "kimi-k3", webSearch: Boolean(opts.web) },
    (e) => events.push(e),
  );
  return { messages, events, requests, log };
}

describe("runOpenAICompatibleTurn", () => {
  it("ejecuta herramientas, devuelve resultados como mensajes tool y emite acciones", async () => {
    const { messages, events, requests, log } = await runTurns([
      turn({ toolCalls: [toolCall("c1", "search_places", '{"query":"farmacias"}')], finishReason: "tool_calls", reasoning: "r" }),
      turn({ content: "Te marqué una farmacia." }),
    ]);
    expect(log.textSearches).toHaveLength(1);
    expect(events.some((e) => e.type === "action")).toBe(true);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(messages[1]).toMatchObject({ content: null, reasoning_content: "r" });
    expect(messages[2]).toMatchObject({ role: "tool", tool_call_id: "c1" });

    const first = requests[0] as { model: string; messages: ChatMessage[]; tools: { function: { name: string } }[] };
    expect(first.model).toBe("kimi-k3");
    expect(first.messages[0].role).toBe("system");
    expect(String(first.messages[1].content)).toContain("<map_context>");
    // Sin proveedor web no se ofrece web_search y el prompt lo dice.
    expect(first.tools.some((t) => t.function.name === "web_search")).toBe(false);
    expect(String(first.messages[0].content)).toContain("Sin búsqueda web");
    // El historial que vuelve no incluye el system: el siguiente turno lo añade otra vez.
    expect((requests[1] as { messages: ChatMessage[] }).messages.slice(1)).toEqual(messages.slice(0, 3));
  });

  it("argumentos que no son JSON y herramientas desconocidas vuelven como error", async () => {
    const { messages, log } = await runTurns([
      turn({ toolCalls: [toolCall("c1", "search_places", "{roto"), toolCall("c2", "teleport", "{}")], finishReason: "tool_calls" }),
      turn({ content: "Perdón." }),
    ]);
    expect(log.textSearches).toHaveLength(0);
    const tools = messages.filter((m) => m.role === "tool");
    expect(tools[0].content).toMatch(/^ERROR: Los argumentos no son JSON/);
    expect(tools[1].content).toBe("ERROR: Herramienta desconocida: teleport");
  });

  it("con proveedor web ofrece web_search y muestra las páginas como fuentes", async () => {
    const { events, requests } = await runTurns(
      [turn({ toolCalls: [toolCall("c1", "web_search", '{"query":"ruta Curva de Molina"}')], finishReason: "tool_calls" }), turn({ content: "Según [Web: ejemplo.org]…" })],
      { web: true },
    );
    const tools = (requests[0] as { tools: { function: { name: string } }[] }).tools;
    expect(tools.some((t) => t.function.name === "web_search")).toBe(true);
    expect(events.at(-1)).toEqual({ type: "sources", sources: [{ title: "Ruta 5", url: "https://ejemplo.org/ruta5" }] });
  });

  it("si se corta por longitud con llamadas pendientes, no las ejecuta pero las cierra", async () => {
    const { messages, log, events } = await runTurns([
      turn({ toolCalls: [toolCall("c1", "search_places", '{"query":"far')], finishReason: "length" }),
    ]);
    expect(log.textSearches).toHaveLength(0);
    expect(messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "c1" });
    expect(events.at(-1)).toMatchObject({ type: "error" });
  });
});

describe("SearXNG", () => {
  it("pide JSON en español, quita duplicados y limita resultados", async () => {
    let url = "";
    const fetchImpl = (async (u: string) => {
      url = u;
      return Response.json({
        results: [
          { title: "T", url: "https://a.b/1", content: "texto", publishedDate: "2026-01-02T00:00:00" },
          { title: "T otra vez", url: "https://a.b/1", content: "dup" },
          { title: "sin url" },
          { title: "", url: "https://a.b/2", content: null, publishedDate: null },
        ],
      });
    }) as unknown as typeof fetch;
    const results = await createSearxngSearch("http://localhost:8888/", fetchImpl).search("por puestos Maracaibo", { recent: true });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("http://localhost:8888/search");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ q: "por puestos Maracaibo", format: "json", language: "es", time_range: "year" });
    expect(results).toEqual([
      { title: "T", url: "https://a.b/1", snippet: "texto", publishedDate: "2026-01-02T00:00:00" },
      { title: "https://a.b/2", url: "https://a.b/2", snippet: "", publishedDate: undefined },
    ]);
  });

  it("explica los fallos típicos: sin JSON activado o sin arrancar", async () => {
    const forbidden = (async () => new Response("Forbidden", { status: 403 })) as unknown as typeof fetch;
    await expect(createSearxngSearch("http://s", forbidden).search("x")).rejects.toThrow(/formato JSON/);
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(createSearxngSearch("http://s", down).search("x")).rejects.toThrow(/docker compose up/);
    const enginesDown = (async () => Response.json({ results: [], unresponsive_engines: [["duckduckgo", "access denied"]] })) as unknown as typeof fetch;
    await expect(createSearxngSearch("http://s", enginesDown).search("x")).rejects.toThrow(/duckduckgo \(access denied\)/);
  });
});

describe("lectura de páginas", () => {
  it("extrae el texto legible y el título", () => {
    const html = `<html><head><title>Ruta 5 &amp; más</title><style>.x{}</style></head><body>
      <nav>menú</nav><script>alert(1)</script>
      <article><h1>Ruta 5</h1><p>Sale de la Curva de Molina&nbsp;y pasa por <b>Las Delicias</b>.</p>
      <ul><li>Parada A</li><li>Parada B</li></ul>${"<p>relleno</p>".repeat(60)}</article><footer>pie</footer></body></html>`;
    const { title, text } = htmlToText(html);
    expect(title).toBe("Ruta 5 & más");
    expect(text).toContain("Sale de la Curva de Molina y pasa por Las Delicias .");
    expect(text).toContain("• Parada A");
    expect(text).not.toMatch(/menú|alert|pie|\.x\{/);
  });

  it("solo hosts públicos por http(s)", () => {
    expect(isPublicHttpUrl("https://www.ejemplo.com/ruta")).toBe(true);
    for (const bad of ["file:///etc/passwd", "http://localhost:3000", "http://127.0.0.1", "http://192.168.1.1", "http://10.0.0.5/x", "http://[::1]/", "ftp://a.b"]) {
      expect(isPublicHttpUrl(bad)).toBe(false);
    }
  });

  it("sigue redirecciones pero no hacia la red local", async () => {
    const fetchImpl = (async (u: string) =>
      u === "https://a.b/x"
        ? new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } })
        : new Response("<p>hola</p>", { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    await expect(createPageReader(fetchImpl).read("https://a.b/x")).rejects.toThrow(/públicas/);
    const ok = await createPageReader(fetchImpl).read("https://a.b/y");
    expect(ok).toMatchObject({ url: "https://a.b/y", text: "hola", truncated: false });
  });

  it("read_web_page solo abre URLs que devolvió web_search en el turno", async () => {
    const { messages } = await runTurns(
      [
        turn({ toolCalls: [toolCall("c1", "read_web_page", '{"url":"https://otro.sitio/x"}')], finishReason: "tool_calls" }),
        turn({ toolCalls: [toolCall("c2", "web_search", '{"query":"ruta"}')], finishReason: "tool_calls" }),
        turn({ toolCalls: [toolCall("c3", "read_web_page", '{"url":"https://ejemplo.org/ruta5"}')], finishReason: "tool_calls" }),
        turn({ content: "Listo." }),
      ],
      { web: true },
    );
    const tools = messages.filter((m) => m.role === "tool");
    expect(tools[0].content).toMatch(/^ERROR: Solo se pueden leer URLs/);
    expect(JSON.parse(tools[2].content)).toMatchObject({ source: "WEB_DATA", text: "Paradas: A, B" });
  });
});
