import { z } from "zod";
import { settingsAccess } from "@/server/settings/access";
import { listProviderModels, ModelListError } from "@/server/settings/models";

const bodySchema = z.object({
  provider: z.enum(["gemini", "opencode-go", "anthropic", "custom"]),
  /** Clave escrita en el formulario y aún sin guardar; si no hay, se usa la guardada. */
  apiKey: z.string().max(400).optional(),
  baseUrl: z.string().max(300).optional(),
});

/** Modelos disponibles en la cuenta del proveedor, para elegirlos en «Ajustes». */
export async function POST(request: Request) {
  const access = settingsAccess(request, { mutating: true });
  if (!access.ok) return Response.json({ error: access.reason }, { status: 403 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Petición no válida" }, { status: 400 });

  const { provider, apiKey, baseUrl } = parsed.data;
  try {
    const models = await listProviderModels(provider, { apiKey: apiKey?.trim() || undefined, baseUrl: baseUrl?.trim() || undefined });
    return Response.json({ models });
  } catch (e) {
    if (e instanceof ModelListError) return Response.json({ error: e.message }, { status: 502 });
    console.error(e);
    return Response.json({ error: "No se pudo obtener la lista de modelos." }, { status: 500 });
  }
}
