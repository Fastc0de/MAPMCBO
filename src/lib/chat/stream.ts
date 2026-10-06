import type { AgentEvent } from "./events";

/** Lee una respuesta NDJSON y entrega cada evento según llega. */
export async function readEventStream(response: Response, onEvent: (event: AgentEvent) => void): Promise<void> {
  if (!response.body) throw new Error("Respuesta sin cuerpo");
  const reader = response.body.getReader();
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
      if (line) onEvent(JSON.parse(line) as AgentEvent);
    }
  }
  const rest = buffer.trim();
  if (rest) onEvent(JSON.parse(rest) as AgentEvent);
}
