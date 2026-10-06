import { searxngManager } from "@/server/searxng/manager";
import { settingsAccess } from "@/server/settings/access";

const NO_STORE = { "Cache-Control": "no-store" };

/** Estado de SearXNG (la pantalla de Ajustes lo consulta mientras arranca). */
export async function GET() {
  return Response.json(await searxngManager().status(), { headers: NO_STORE });
}

/** Botón «Arrancar»: lanza `docker compose up -d searxng` sin esperar a que termine. */
export async function POST(request: Request) {
  const access = settingsAccess(request, { mutating: true });
  if (!access.ok) return Response.json({ error: access.reason }, { status: 403 });
  const manager = searxngManager();
  const attempt = manager.start();
  // Si Docker falla enseguida (no instalado, cerrado), la respuesta ya trae el motivo.
  await Promise.race([attempt, new Promise((resolve) => setTimeout(resolve, 3000))]);
  return Response.json(await manager.status(), { headers: NO_STORE });
}
