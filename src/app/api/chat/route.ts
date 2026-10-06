import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import type { AgentEvent } from "@/lib/chat/events";
import type { ProgressState } from "@/lib/learning/progress";
import type { MapContext } from "@/lib/map/state";
import { anthropicModelCall, runAgentTurn } from "@/server/agent/agent";
import { getConfig } from "@/server/config";
import { ConfigError, getProviders, latLngSchema } from "@/server/http";
import { ProviderError } from "@/server/providers/types";

export const maxDuration = 300;

const MAX_HISTORY_BYTES = 3_000_000;

const bodySchema = z.object({
  message: z.string().min(1).max(4000),
  history: z.array(z.unknown()).max(400),
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
  if (!config.anthropicConfigured) {
    return Response.json({ error: "Falta ANTHROPIC_API_KEY en el servidor para usar el chat." }, { status: 503 });
  }
  let providers;
  try {
    providers = getProviders();
  } catch (e) {
    if (e instanceof ConfigError) return Response.json({ error: e.message }, { status: 503 });
    throw e;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        const history = await runAgentTurn(
          {
            history: body.history as BetaMessageParam[],
            userText: body.message,
            mapContext: body.mapContext as unknown as MapContext,
            progress: body.progress as ProgressState,
          },
          {
            providers,
            callModel: anthropicModelCall(),
            options: {
              model: config.anthropicModel,
              effort: config.anthropicEffort,
              webSearch: { enabled: config.webSearchEnabled, maxUses: config.webSearchMaxUses },
            },
          },
          send,
        );
        send({ type: "done", history });
      } catch (e) {
        send({ type: "error", message: describeError(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "La clave de Anthropic no es válida (ANTHROPIC_API_KEY).";
  if (e instanceof Anthropic.RateLimitError) return "Demasiadas peticiones al modelo. Espera un momento y vuelve a intentarlo.";
  if (e instanceof Anthropic.BadRequestError) return `El modelo rechazó la petición: ${e.message}`;
  if (e instanceof Anthropic.APIError) return `Error del modelo (${e.status ?? "sin estado"}): ${e.message}`;
  if (e instanceof ProviderError) return e.message;
  console.error(e);
  return "Error inesperado en el servidor.";
}
