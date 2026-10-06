import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import type { AgentEvent } from "@/lib/chat/events";
import type { ProgressState } from "@/lib/learning/progress";
import type { MapContext } from "@/lib/map/state";
import { anthropicModelCall, runAgentTurn } from "@/server/agent/agent";
import { LlmError, openAICompatibleCall, runOpenAICompatibleTurn, type ChatMessage } from "@/server/agent/openai";
import { getConfig } from "@/server/config";
import { ConfigError, getProviders, latLngSchema } from "@/server/http";
import { resolveModel, USER_AGENT, type ResolvedModel } from "@/server/llm/catalog";
import { ProviderError } from "@/server/providers/types";

export const maxDuration = 300;

const MAX_HISTORY_BYTES = 3_000_000;

const bodySchema = z.object({
  message: z.string().min(1).max(4000),
  /** `proveedor:modelo` elegido en el chat; sin él se usa el primero disponible. */
  model: z.string().max(200).optional(),
  history: z.array(z.unknown()).max(400),
  historyFormat: z.enum(["anthropic", "openai"]).optional(),
  /** Id estable de la conversación (OpenCode Go lo usa para enrutar y cachear). */
  conversationId: z.string().max(100).optional(),
  mapContext: z.looseObject({ center: latLngSchema, zoom: z.number() }),
  progress: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Un turno del chat. Responde con NDJSON en streaming: texto, estados, acciones para el mapa,
 * fuentes y, al final, el historial completo que el navegador debe reenviar en el siguiente turno.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_HISTORY_BYTES) {
    return Response.json(
      { error: "La conversación es demasiado larga. Empieza una nueva desde el botón «Nueva conversación»." },
      { status: 413 },
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Petición no válida" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return Response.json({ error: "Petición no válida" }, { status: 400 });
  const body = parsed.data;

  const config = getConfig();
  const resolved = resolveModel(body.model);
  if (!resolved) {
    return Response.json({ error: "No hay ningún modelo configurado para el chat. Añade una clave en «Ajustes»." }, { status: 503 });
  }
  let providers;
  try {
    providers = getProviders();
  } catch (e) {
    if (e instanceof ConfigError) return Response.json({ error: e.message }, { status: 503 });
    throw e;
  }

  // El navegador convierte el historial al cambiar de proveedor; si aun así no cuadra, se empieza de cero.
  const history = body.historyFormat && body.historyFormat !== resolved.option.format ? [] : body.history;
  const turnInput = {
    userText: body.message,
    mapContext: body.mapContext as unknown as MapContext,
    progress: body.progress as ProgressState,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        let messages: unknown[];
        if (resolved.provider.format === "anthropic") {
          messages = await runAgentTurn(
            { ...turnInput, history: history as BetaMessageParam[] },
            {
              providers,
              callModel: anthropicModelCall(),
              options: {
                model: resolved.model,
                effort: config.anthropicEffort,
                webSearch: { enabled: resolved.option.webSearch, maxUses: config.webSearchMaxUses },
              },
            },
            send,
          );
        } else {
          messages = await runOpenAICompatibleTurn(
            { ...turnInput, history: history as ChatMessage[] },
            {
              providers,
              callModel: openAICompatibleCall({
                baseUrl: resolved.provider.baseUrl!,
                apiKey: resolved.provider.apiKey,
                providerLabel: resolved.provider.label,
                headers: {
                  "User-Agent": USER_AGENT,
                  ...(resolved.provider.sessionHeader && body.conversationId
                    ? { [resolved.provider.sessionHeader]: body.conversationId }
                    : {}),
                },
              }),
              model: resolved.model,
              webSearch: resolved.option.webSearch,
            },
            send,
          );
        }
        send({ type: "done", history: messages, format: resolved.option.format, model: resolved.option.id });
      } catch (e) {
        send({ type: "error", message: describeError(e, resolved) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function describeError(e: unknown, resolved: ResolvedModel): string {
  const who = resolved.provider.label;
  if (e instanceof Anthropic.AuthenticationError) return "La clave de Claude no es válida. Cámbiala en «Ajustes».";
  if (e instanceof Anthropic.RateLimitError) return "Demasiadas peticiones al modelo. Espera un momento y vuelve a intentarlo.";
  if (e instanceof Anthropic.BadRequestError) return `El modelo rechazó la petición: ${e.message}`;
  if (e instanceof Anthropic.APIError) return `Error del modelo (${e.status ?? "sin estado"}): ${e.message}`;
  if (e instanceof LlmError) {
    if (e.status === 401 || e.status === 403) return `${who} rechazó la clave (HTTP ${e.status}): ${e.message}`;
    if (e.status === 429) return `${who}: límite de uso alcanzado. Espera un momento o elige otro modelo. (${e.message})`;
    return `Error de ${who}${e.status ? ` (HTTP ${e.status})` : ""}: ${e.message}`;
  }
  if (e instanceof ProviderError) return e.message;
  console.error(e);
  return "Error inesperado en el servidor.";
}
