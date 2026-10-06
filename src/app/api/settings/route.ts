import { autostartSearxng, searxngManager } from "@/server/searxng/manager";
import { settingsAccess } from "@/server/settings/access";
import { saveSettings, SettingsError, settingsView, updatesSchema, validateUpdates } from "@/server/settings/store";

/** Ajustes de la app (claves, modelos, búsqueda web). Solo desde el mismo PC: ver settingsAccess. */

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const access = settingsAccess(request);
  const searxng = await searxngManager().status();
  return Response.json(settingsView(process.env, access, searxng), { headers: NO_STORE });
}

export async function PUT(request: Request) {
  const access = settingsAccess(request, { mutating: true });
  if (!access.ok) return Response.json({ error: access.reason }, { status: 403 });

  const parsed = updatesSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Petición no válida" }, { status: 400 });
  let updates: Record<string, string | null>;
  try {
    updates = validateUpdates(parsed.data.values);
  } catch (e) {
    if (e instanceof SettingsError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }

  try {
    await saveSettings(updates);
  } catch (e) {
    console.error(e);
    return Response.json({ error: `No se pudo guardar .env.local: ${e instanceof Error ? e.message : "error desconocido"}` }, { status: 500 });
  }
  if (Object.keys(updates).some((k) => k.startsWith("SEARXNG_") || k === "WEB_SEARCH_ENABLED")) autostartSearxng();

  const searxng = await searxngManager().status();
  return Response.json(settingsView(process.env, access, searxng), { headers: NO_STORE });
}
