/** Se ejecuta una vez al arrancar el servidor de Next. */
export async function register() {
  // Solo en el servidor Node y no durante `next build`.
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { autostartSearxng } = await import("./server/searxng/manager");
  autostartSearxng();
}
