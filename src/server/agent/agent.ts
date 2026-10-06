import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaToolResultBlockParam,
  BetaToolUnion,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { AgentEvent } from "@/lib/chat/events";
import type { SourceRef } from "@/lib/geo/types";
import type { Providers } from "@/server/providers/types";
import { TOOL_BY_NAME, TOOLS } from "@/server/tools/registry";
import { toInputSchema } from "@/server/tools/tool";
import { contextBlock, createToolContext, executeTool, MAX_ITERATIONS, systemPrompt, type AgentTurnInput } from "./shared";

/**
 * Bucle del agente con Claude: LLM → tool call estructurada → backend → resultado → Map Action → UI.
 * (Los modelos compatibles con OpenAI usan el bucle equivalente de ./openai.ts.)
 *
 * Es un bucle manual (no el tool runner del SDK) porque cada herramienta emite acciones
 * para el mapa mientras el turno sigue en curso, y porque se mezclan herramientas propias
 * con la búsqueda web de servidor de Claude (que puede pausar el turno con `pause_turn`).
 */

export type StreamParams = BetaMessageStreamParams;

/** Una llamada al modelo con streaming de texto. Inyectable para los tests. */
export type ModelCall = (params: StreamParams, onText: (delta: string) => void) => Promise<BetaMessage>;

export function anthropicModelCall(client = new Anthropic()): ModelCall {
  return async (params, onText) => {
    const stream = client.beta.messages.stream(params);
    stream.on("text", onText);
    return stream.finalMessage();
  };
}

export interface AgentOptions {
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  webSearch: { enabled: boolean; maxUses: number };
}

export function buildTools(options: AgentOptions): BetaToolUnion[] {
  const tools: BetaToolUnion[] = TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: toInputSchema(t.schema),
  }));
  if (options.webSearch.enabled) {
    tools.push({
      type: "web_search_20260209",
      name: "web_search",
      max_uses: options.webSearch.maxUses,
      user_location: { type: "approximate", city: "Maracaibo", region: "Zulia", country: "VE", timezone: "America/Caracas" },
    });
  }
  return tools;
}

function collectCitations(message: BetaMessage, into: Map<string, SourceRef>) {
  for (const block of message.content) {
    if (block.type !== "text" || !block.citations) continue;
    for (const c of block.citations) {
      if (c.type === "web_search_result_location" && c.url) into.set(c.url, { title: c.title ?? c.url, url: c.url });
    }
  }
}

/** El servidor reintenta en otro modelo si Opus o Fable rechazan por un falso positivo de seguridad. */
const supportsFallbacks = (model: string) => /^claude-(opus|fable)/.test(model);

export async function runAgentTurn(
  input: AgentTurnInput<BetaMessageParam>,
  deps: { providers: Providers; callModel: ModelCall; options: AgentOptions },
  emit: (event: AgentEvent) => void,
): Promise<BetaMessageParam[]> {
  const messages: BetaMessageParam[] = [
    ...input.history,
    {
      role: "user",
      content: [
        { type: "text", text: input.userText },
        { type: "text", text: contextBlock(input.mapContext, input.progress) },
      ],
    },
  ];

  const ctx = createToolContext(input, deps.providers, emit);
  const tools = buildTools(deps.options);
  const system = systemPrompt(deps.options.webSearch.enabled);
  const citations = new Map<string, SourceRef>();
  const fallbacks = supportsFallbacks(deps.options.model);

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const message = await deps.callModel(
      {
        model: deps.options.model,
        max_tokens: 32000,
        system,
        tools,
        messages,
        // drop_block: si se cambia de modelo de Claude a mitad de conversación, el pensamiento anterior se descarta en vez de fallar.
        thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
        output_config: { effort: deps.options.effort },
        cache_control: { type: "ephemeral" },
        ...(fallbacks ? { fallbacks: "default" as const } : {}),
        betas: [...(fallbacks ? ["server-side-fallback-2026-07-01"] : []), "thinking-binding-controls-2026-08-01"],
      },
      (delta) => emit({ type: "text", delta }),
    );
    collectCitations(message, citations);

    if (message.stop_reason === "refusal") {
      // Una negativa puede cortar un tool_use a medias: no se guarda ni se ejecuta ese turno.
      emit({ type: "error", message: "El modelo no pudo responder a esta petición. Prueba a reformularla." });
      break;
    }
    messages.push({ role: "assistant", content: message.content as BetaContentBlockParam[] });
    if (message.stop_reason === "pause_turn") continue;

    const toolUses = message.content.filter((b) => b.type === "tool_use");
    if (toolUses.length === 0) {
      if (message.stop_reason === "max_tokens") emit({ type: "error", message: "La respuesta se cortó por longitud." });
      break;
    }
    if (message.stop_reason === "max_tokens") {
      // Entrada de herramienta posiblemente truncada: no se ejecuta, pero cada tool_use necesita su resultado.
      messages.push({
        role: "user",
        content: toolUses.map((use) => ({ type: "tool_result" as const, tool_use_id: use.id, is_error: true, content: "Interrumpido: la respuesta se cortó por longitud." })),
      });
      emit({ type: "error", message: "La respuesta se cortó antes de terminar de usar una herramienta." });
      break;
    }

    const results: BetaToolResultBlockParam[] = await Promise.all(
      toolUses.map(async (use): Promise<BetaToolResultBlockParam> => {
        const outcome = await executeTool(TOOL_BY_NAME, use.name, use.input, ctx, emit, citations);
        return { type: "tool_result", tool_use_id: use.id, content: outcome.content, ...(outcome.isError ? { is_error: true } : {}) };
      }),
    );
    messages.push({ role: "user", content: results });

    if (i === MAX_ITERATIONS - 1) emit({ type: "error", message: "Se alcanzó el límite de pasos de este turno." });
  }

  if (citations.size > 0) emit({ type: "sources", sources: [...citations.values()] });
  return messages;
}
