import "server-only";

import type { AgentEvent } from "@/lib/chat/events";
import type { SourceRef } from "@/lib/geo/types";
import type { Providers } from "@/server/providers/types";
import { TOOLS } from "@/server/tools/registry";
import { toInputSchema, type AgentTool } from "@/server/tools/tool";
import { webSearch } from "@/server/tools/web";
import { contextBlock, createToolContext, executeTool, MAX_ITERATIONS, systemPrompt, type AgentTurnInput } from "./shared";

/**
 * El mismo bucle del agente para proveedores compatibles con la API de OpenAI
 * (`POST {baseUrl}/chat/completions` con streaming): OpenCode Go, Gemini, OpenRouter, Ollama…
 */

export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[]; reasoning_content?: string }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ChatTurn {
  content: string;
  toolCalls: ChatToolCall[];
  finishReason: string | null;
  /** Razonamiento que algunos modelos (DeepSeek, Kimi) piden recibir de vuelta en las llamadas a herramientas. */
  reasoning?: string;
}

export type ChatCall = (body: Record<string, unknown>, onText: (delta: string) => void) => Promise<ChatTurn>;

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly provider: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export interface ChatEndpoint {
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  providerLabel: string;
}

/** Cliente mínimo de chat/completions con streaming (SSE). */
export function openAICompatibleCall(endpoint: ChatEndpoint, fetchImpl: typeof fetch = fetch): ChatCall {
  return async (body, onText) => {
    const res = await fetchImpl(`${endpoint.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}),
        ...endpoint.headers,
      },
      body: JSON.stringify({ ...body, stream: true }),
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new LlmError(errorMessage(text) || res.statusText, res.status, endpoint.providerLabel);
    }

    const turn: ChatTurn = { content: "", toolCalls: [], finishReason: null };
    const calls: { id?: string; name: string; arguments: string }[] = [];
    let reasoning = "";

    const handle = (data: string) => {
      if (data === "[DONE]") return;
      const chunk = JSON.parse(data) as {
        error?: { message?: string };
        choices?: {
          delta?: {
            content?: string | null;
            reasoning_content?: string | null;
            tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
          };
          finish_reason?: string | null;
        }[];
      };
      if (chunk.error) throw new LlmError(chunk.error.message ?? "Error del modelo", undefined, endpoint.providerLabel);
      const choice = chunk.choices?.[0];
      if (!choice) return;
      const delta = choice.delta ?? {};
      if (delta.content) {
        turn.content += delta.content;
        onText(delta.content);
      }
      if (delta.reasoning_content) reasoning += delta.reasoning_content;
      for (const tc of delta.tool_calls ?? []) {
        const i = tc.index ?? calls.length;
        calls[i] ??= { name: "", arguments: "" };
        if (tc.id) calls[i].id = tc.id;
        if (tc.function?.name) calls[i].name += tc.function.name;
        if (tc.function?.arguments) calls[i].arguments += tc.function.arguments;
      }
      if (choice.finish_reason) turn.finishReason = choice.finish_reason;
    };

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.startsWith("data:")) handle(line.slice(5).trim());
      }
    }
    const rest = buffer.trim();
    if (rest.startsWith("data:")) handle(rest.slice(5).trim());

    turn.toolCalls = calls
      .filter((c) => c && c.name)
      .map((c, i) => ({ id: c.id ?? `call_${i}`, type: "function" as const, function: { name: c.name, arguments: c.arguments || "{}" } }));
    if (reasoning) turn.reasoning = reasoning;
    return turn;
  };
}

function errorMessage(text: string): string {
  try {
    const body = JSON.parse(text);
    const err = Array.isArray(body) ? body[0]?.error : body?.error;
    return (typeof err === "string" ? err : err?.message) ?? text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

/**
 * Esquema de parámetros para proveedores con soporte parcial de JSON Schema (p. ej. Gemini):
 * `oneOf` → `anyOf`, `const` → `enum` y fuera `propertyNames`.
 */
export function toFunctionParameters(tool: AgentTool): Record<string, unknown> {
  const simplify = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(simplify);
    if (!v || typeof v !== "object") return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === "propertyNames") continue;
      if (k === "oneOf") out.anyOf = simplify(x);
      else if (k === "const") out.enum = [x];
      else out[k] = simplify(x);
    }
    return out;
  };
  return simplify(toInputSchema(tool.schema)) as Record<string, unknown>;
}

export function openAITools(webSearchEnabled: boolean): AgentTool[] {
  return webSearchEnabled ? [...TOOLS, webSearch as unknown as AgentTool] : TOOLS;
}

export async function runOpenAICompatibleTurn(
  input: AgentTurnInput<ChatMessage>,
  deps: { providers: Providers; callModel: ChatCall; model: string; webSearch: boolean },
  emit: (event: AgentEvent) => void,
): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [
    ...input.history,
    { role: "user", content: `${input.userText}\n\n${contextBlock(input.mapContext, input.progress)}` },
  ];
  const ctx = createToolContext(input, deps.providers, emit);
  const toolList = openAITools(deps.webSearch && Boolean(deps.providers.web));
  const byName = new Map(toolList.map((t) => [t.name, t]));
  const tools = toolList.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: toFunctionParameters(t) },
  }));
  const system: ChatMessage = { role: "system", content: systemPrompt(byName.has("web_search")) };
  const sources = new Map<string, SourceRef>();

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const turn = await deps.callModel({ model: deps.model, messages: [system, ...messages], tools }, (delta) =>
      emit({ type: "text", delta }),
    );
    messages.push({
      role: "assistant",
      content: turn.content || null,
      ...(turn.toolCalls.length > 0 ? { tool_calls: turn.toolCalls } : {}),
      ...(turn.reasoning ? { reasoning_content: turn.reasoning } : {}),
    });

    if (turn.toolCalls.length === 0) {
      if (turn.finishReason === "length") emit({ type: "error", message: "La respuesta se cortó por longitud." });
      if (turn.finishReason === "content_filter") emit({ type: "error", message: "El proveedor bloqueó la respuesta por su filtro de contenido." });
      break;
    }
    if (turn.finishReason === "length") {
      // Argumentos posiblemente truncados: no se ejecutan, pero cada llamada necesita su respuesta.
      for (const call of turn.toolCalls) {
        messages.push({ role: "tool", tool_call_id: call.id, content: "Interrumpido: la respuesta se cortó por longitud." });
      }
      emit({ type: "error", message: "La respuesta se cortó antes de terminar de usar una herramienta." });
      break;
    }

    const outcomes = await Promise.all(
      turn.toolCalls.map(async (call) => {
        let args: unknown;
        try {
          args = JSON.parse(call.function.arguments);
        } catch {
          return { isError: true, content: "Los argumentos no son JSON válido. Vuelve a llamar a la herramienta con JSON correcto." };
        }
        return executeTool(byName, call.function.name, args, ctx, emit, sources);
      }),
    );
    turn.toolCalls.forEach((call, j) => {
      const o = outcomes[j];
      messages.push({ role: "tool", tool_call_id: call.id, content: o.isError ? `ERROR: ${o.content}` : o.content });
    });

    if (i === MAX_ITERATIONS - 1) emit({ type: "error", message: "Se alcanzó el límite de pasos de este turno." });
  }

  if (sources.size > 0) emit({ type: "sources", sources: [...sources.values()] });
  return messages;
}
