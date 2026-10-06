import type { SourceRef } from "@/lib/geo/types";
import type { UIAction } from "@/lib/map/actions";
import type { HistoryFormat } from "./models";

/** Eventos que el servidor envía al navegador durante un turno del chat (NDJSON, uno por línea). */
export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "status"; text: string }
  | { type: "action"; action: UIAction }
  | { type: "sources"; sources: SourceRef[] }
  | { type: "error"; message: string }
  /** Historial completo para el siguiente turno (el cliente lo guarda tal cual y lo reenvía). */
  | { type: "done"; history: unknown[]; format: HistoryFormat; model: string };
