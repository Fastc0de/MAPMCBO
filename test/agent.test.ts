import { describe, expect, it } from "vitest";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { AgentEvent } from "@/lib/chat/events";
import { buildTools, runAgentTurn, type AgentOptions, type ModelCall, type StreamParams } from "@/server/agent/agent";
import { fakeProviders, mapContextAtMaracaibo } from "./fakes";

const OPTIONS: AgentOptions = { model: "claude-opus-5-5", effort: "medium", webSearch: { enabled: true, maxUses: 3 } };

type Block = Record<string, unknown>;

const blocks = (message: StreamParams["messages"][number]) => message.content as unknown as Block[];
const hasTool = (options: AgentOptions, name: string) => buildTools(options).some((t) => "name" in t && t.name === name);

function reply(content: Block[], stopReason: string): BetaMessage {
  return {
    id: "msg",
    type: "message",
    role: "assistant",
    model: OPTIONS.model,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  } as unknown as BetaMessage;
}

/** Modelo simulado: devuelve las respuestas en orden y guarda una copia de cada petición. */
function scriptedModel(replies: BetaMessage[]): { call: ModelCall; requests: StreamParams[] } {
  const requests: StreamParams[] = [];
  const call: ModelCall = async (params, onText) => {
    requests.push(structuredClone(params));
    const next = replies.shift();
    if (!next) throw new Error("el modelo simulado se quedó sin respuestas");
    for (const b of next.content) if (b.type === "text") onText(b.text);
    return next;
  };
  return { call, requests };
}

async function run(replies: BetaMessage[], history: StreamParams["messages"] = []) {
  const { providers, log } = fakeProviders();
  const { call, requests } = scriptedModel(replies);
  const events: AgentEvent[] = [];
  const messages = await runAgentTurn(
    { history, userText: "¿Dónde hay un centro comercial?", mapContext: mapContextAtMaracaibo(), progress: {} },
    { providers, callModel: call, options: OPTIONS },
    (e) => events.push(e),
  );
  return { messages, events, requests, log };
}

describe("runAgentTurn", () => {
  it("ejecuta la herramienta, emite acciones para el mapa y devuelve el resultado al modelo", async () => {
    const { messages, events, requests, log } = await run([
      reply([{ type: "tool_use", id: "tu1", name: "search_places", input: { query: "centro comercial" } }], "tool_use"),
      reply([{ type: "text", text: "Te marqué el centro comercial en el mapa." }], "end_turn"),
    ]);

    expect(log.textSearches).toHaveLength(1);
    const kinds = events.map((e) => e.type);
    expect(kinds).toContain("status");
    expect(kinds).toContain("action");
    const action = events.find((e) => e.type === "action");
    expect(action).toMatchObject({ action: { type: "ADD_MARKERS" } });
    expect(events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("")).toBe(
      "Te marqué el centro comercial en el mapa.",
    );

    // user → assistant(tool_use) → user(tool_result) → assistant(text)
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    const toolResult = blocks(requests[1].messages[2])[0];
    expect(toolResult).toMatchObject({ type: "tool_result", tool_use_id: "tu1" });
    expect(toolResult.is_error).toBeUndefined();
    expect(String(toolResult.content)).toContain("ChIJplace1");
  });

  it("el historial solo crece: cada petición empieza con la anterior tal cual", async () => {
    const previous: StreamParams["messages"] = [
      { role: "user", content: "hola" },
      { role: "assistant", content: [{ type: "text", text: "¡Hola!" }] },
    ];
    const { requests, messages } = await run(
      [
        reply([{ type: "tool_use", id: "tu1", name: "get_map_context", input: {} }], "tool_use"),
        reply([{ type: "text", text: "Listo." }], "end_turn"),
      ],
      previous,
    );
    expect(requests[0].messages.slice(0, 2)).toEqual(previous);
    expect(requests[1].messages.slice(0, requests[0].messages.length)).toEqual(requests[0].messages);
    expect(messages.slice(0, requests[1].messages.length)).toEqual(requests[1].messages);
  });

  it("una entrada no válida vuelve como error al modelo sin llamar a Google", async () => {
    const { requests, log, events } = await run([
      reply([{ type: "tool_use", id: "tu1", name: "search_places", input: { query: "" } }], "tool_use"),
      reply([{ type: "text", text: "Perdón." }], "end_turn"),
    ]);
    expect(log.textSearches).toHaveLength(0);
    expect(events.some((e) => e.type === "action")).toBe(false);
    const toolResult = blocks(requests[1].messages.at(-1)!)[0];
    expect(toolResult).toMatchObject({ is_error: true });
    expect(String(toolResult.content)).toMatch(/Entrada no válida: query/);
  });

  it("una herramienta desconocida también es un error para el modelo", async () => {
    const { requests } = await run([
      reply([{ type: "tool_use", id: "tu1", name: "teleport", input: {} }], "tool_use"),
      reply([{ type: "text", text: "Ok." }], "end_turn"),
    ]);
    expect(blocks(requests[1].messages.at(-1)!)[0]).toMatchObject({ is_error: true, content: "Herramienta desconocida: teleport" });
  });

  it("pause_turn continúa con el mismo historial sin añadir mensajes del usuario", async () => {
    const { requests, messages } = await run([
      reply([{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: "rutas de autobús Maracaibo" } }], "pause_turn"),
      reply([{ type: "text", text: "Encontré información." }], "end_turn"),
    ]);
    expect(requests).toHaveLength(2);
    expect(requests[1].messages.at(-1)!.role).toBe("assistant");
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "assistant"]);
  });

  it("una negativa no se guarda en el historial ni ejecuta herramientas", async () => {
    const { messages, events, log } = await run([
      reply([{ type: "tool_use", id: "tu1", name: "search_places", input: { query: "x" } }], "refusal"),
    ]);
    expect(log.textSearches).toHaveLength(0);
    expect(messages.map((m) => m.role)).toEqual(["user"]);
    expect(events.at(-1)).toMatchObject({ type: "error" });
  });

  it("max_tokens con tool_use no ejecuta la herramienta pero cierra cada tool_use", async () => {
    const { messages, log } = await run([
      reply([{ type: "tool_use", id: "tu1", name: "search_places", input: { query: "centro" } }], "max_tokens"),
    ]);
    expect(log.textSearches).toHaveLength(0);
    expect(blocks(messages.at(-1)!)[0]).toMatchObject({ type: "tool_result", tool_use_id: "tu1", is_error: true });
  });

  it("las citas de la búsqueda web llegan como fuentes", async () => {
    const { events } = await run([
      reply(
        [
          {
            type: "text",
            text: "La línea pasa por el centro.",
            citations: [{ type: "web_search_result_location", url: "https://ejemplo.org/ruta", title: "Ruta", cited_text: "…", encrypted_index: "x" }],
          },
        ],
        "end_turn",
      ),
    ]);
    expect(events.at(-1)).toEqual({ type: "sources", sources: [{ title: "Ruta", url: "https://ejemplo.org/ruta" }] });
  });

  it("el contexto del mapa viaja con el mensaje del usuario, no en el system prompt", async () => {
    const { requests } = await run([reply([{ type: "text", text: "Hola" }], "end_turn")]);
    const first = blocks(requests[0].messages[0]);
    expect(first[0]).toEqual({ type: "text", text: "¿Dónde hay un centro comercial?" });
    expect(String(first[1].text)).toContain("<map_context>");
    expect(JSON.stringify(requests[0].system)).not.toContain("map_context>\n{");
  });
});

describe("buildTools", () => {
  it("añade la búsqueda web de servidor solo si está activada", () => {
    expect(hasTool(OPTIONS, "web_search")).toBe(true);
    expect(hasTool({ ...OPTIONS, webSearch: { enabled: false, maxUses: 0 } }, "web_search")).toBe(false);
  });
});
