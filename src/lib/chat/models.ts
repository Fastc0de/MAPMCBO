/** Formato del historial que guarda el navegador: depende de la API del proveedor del modelo. */
export type HistoryFormat = "anthropic" | "openai";

/** Un modelo que se puede elegir en el chat. Solo aparecen los de proveedores con clave configurada. */
export interface ModelOption {
  /** `proveedor:modelo`, p. ej. `anthropic:claude-opus-5-5` o `gemini:gemini-3.8-flash`. */
  id: string;
  label: string;
  providerLabel: string;
  format: HistoryFormat;
  /** Si el modelo puede buscar en la web en este servidor. */
  webSearch: boolean;
}

export interface TranscriptMessage {
  role: "user" | "assistant";
  text: string;
}

/**
 * Historial en texto plano a partir de lo que se ve en el chat. Sirve para cambiar de
 * proveedor a mitad de conversación: `{ role, content: string }` es válido tanto en la API
 * de Claude como en las compatibles con OpenAI. Se pierden las llamadas a herramientas,
 * pero el modelo nuevo conserva lo que se habló.
 */
export function transcriptHistory(messages: TranscriptMessage[]): { role: "user" | "assistant"; content: string }[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of messages) {
    const text = m.text.trim();
    if (!text) continue;
    const last = out.at(-1);
    if (last && last.role === m.role) last.content += `\n\n${text}`;
    else out.push({ role: m.role, content: text });
  }
  // La conversación debe empezar por el usuario y acabar en el asistente (el turno nuevo lo añade el servidor).
  while (out[0]?.role === "assistant") out.shift();
  while (out.at(-1)?.role === "user") out.pop();
  return out;
}
