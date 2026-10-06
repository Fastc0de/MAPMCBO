import "server-only";

import type { AgentEvent } from "@/lib/chat/events";
import type { SourceRef } from "@/lib/geo/types";
import { recommend, summarizeProgress, type ProgressState } from "@/lib/learning/progress";
import type { MapContext } from "@/lib/map/state";
import type { Providers } from "@/server/providers/types";
import { makeIdGenerator, type ToolContext } from "@/server/tools/context";
import type { AgentTool } from "@/server/tools/tool";
import { SYSTEM_PROMPT } from "./prompt";

/** Lo que el navegador manda en cada turno, sea cual sea el proveedor del modelo. */
export interface AgentTurnInput<M> {
  history: M[];
  userText: string;
  mapContext: MapContext;
  progress: ProgressState;
}

export const MAX_ITERATIONS = 16;

const NO_WEB_SEARCH =
  "\n\n## Sin búsqueda web\nEn este servidor no hay búsqueda web disponible. Si algo solo se puede saber buscando en Internet " +
  "(rutas de por puestos, negocios pequeños, noticias), dilo y sugiere cómo averiguarlo; no lo supongas.";

/** Instrucciones del agente. Es texto fijo por configuración, para que el prefijo se cachee. */
export function systemPrompt(webSearch: boolean): string {
  return webSearch ? SYSTEM_PROMPT : SYSTEM_PROMPT + NO_WEB_SEARCH;
}

/** Bloque de contexto que acompaña a cada mensaje del usuario (se añade, nunca se edita después). */
export function contextBlock(mapContext: MapContext, progress: ProgressState): string {
  const learning = { progress: summarizeProgress(progress), recommendations: recommend(progress) };
  return `<map_context>\n${JSON.stringify(mapContext)}\n</map_context>\n<learning_progress>\n${JSON.stringify(learning)}\n</learning_progress>`;
}

export function createToolContext(
  input: Pick<AgentTurnInput<unknown>, "mapContext" | "progress">,
  providers: Providers,
  emit: (event: AgentEvent) => void,
): ToolContext {
  return {
    providers,
    mapContext: input.mapContext,
    progress: input.progress,
    emit: (action) => emit({ type: "action", action }),
    knownPlaces: new Map(),
    createdFeatures: new Map(),
    webUrls: new Set(),
    newId: makeIdGenerator(),
  };
}

export interface ToolOutcome {
  content: string;
  isError: boolean;
}

/**
 * Valida la entrada con el esquema Zod de la herramienta y la ejecuta. Una entrada no válida,
 * una herramienta desconocida o un fallo vuelven al modelo como error para que corrija.
 */
export async function executeTool(
  tools: Map<string, AgentTool>,
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
  emit: (event: AgentEvent) => void,
  sources: Map<string, SourceRef>,
): Promise<ToolOutcome> {
  const tool = tools.get(name);
  if (!tool) return { isError: true, content: `Herramienta desconocida: ${name}` };
  const parsed = tool.schema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      isError: true,
      content: `Entrada no válida: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    };
  }
  emit({ type: "status", text: tool.status });
  try {
    const output = await tool.run(parsed.data, ctx);
    collectWebSources(output, sources);
    return { isError: false, content: JSON.stringify(output) };
  } catch (e) {
    return { isError: true, content: e instanceof Error ? e.message : String(e) };
  }
}

/** Las páginas que devuelve la búsqueda web propia se muestran como fuentes bajo la respuesta. */
function collectWebSources(output: unknown, into: Map<string, SourceRef>) {
  if (!output || typeof output !== "object") return;
  const o = output as { source?: string; url?: string; title?: string; results?: { title?: string; url?: string }[] };
  if (o.source !== "WEB_DATA") return;
  if (o.url) into.set(o.url, { title: o.title ?? o.url, url: o.url });
  for (const r of o.results ?? []) if (r.url) into.set(r.url, { title: r.title ?? r.url, url: r.url });
}
