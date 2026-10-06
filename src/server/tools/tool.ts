import { z } from "zod";
import type { ToolContext } from "./context";

/**
 * Una herramienta del agente: nombre, descripción para el modelo, esquema de entrada
 * (Zod, validado antes de ejecutar) y la función que la ejecuta en el servidor.
 * El resultado vuelve al modelo como JSON; las acciones para el mapa se emiten con ctx.emit.
 */
export interface AgentTool<S extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  schema: S;
  /** Texto corto para la interfaz mientras la herramienta trabaja. */
  status: string;
  run: (input: z.infer<S>, ctx: ToolContext) => Promise<unknown>;
}

export function defineTool<S extends z.ZodObject>(tool: AgentTool<S>): AgentTool<S> {
  return tool;
}

/** Esquema JSON para la API de Claude a partir del esquema Zod. */
export function toInputSchema(schema: z.ZodObject): { type: "object"; [key: string]: unknown } {
  const json = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  delete json.$schema;
  return { ...json, type: "object" };
}
