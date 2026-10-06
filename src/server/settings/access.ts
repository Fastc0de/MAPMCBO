import "server-only";

/**
 * Quién puede ver y cambiar los ajustes. Las claves se guardan en este PC, así que solo se
 * aceptan peticiones hechas a `localhost` desde el propio PC y desde la propia app:
 * ni otro aparato de la red ni una web cualquiera abierta en el navegador
 * (CSRF o DNS rebinding) pueden leerlas ni cambiarlas.
 */

export type SettingsAccess = { ok: true } | { ok: false; reason: string };

type Env = Record<string, string | undefined>;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isLoopbackIp(ip: string): boolean {
  const v = ip.trim().toLowerCase();
  return v === "::1" || v.startsWith("127.") || v.startsWith("::ffff:127.");
}

function hostnameOf(host: string): string | null {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return null;
  }
}

export function settingsAccess(request: Request, opts: { mutating?: boolean } = {}, env: Env = process.env): SettingsAccess {
  if (env.SETTINGS_UI === "off") {
    return { ok: false, reason: "Los ajustes desde la app están desactivados en este servidor (SETTINGS_UI=off). Usa .env.local." };
  }
  const host = request.headers.get("host") ?? "";
  const hostname = hostnameOf(host);
  if (!hostname || !LOOPBACK_HOSTS.has(hostname)) {
    return {
      ok: false,
      reason: "Por seguridad, los ajustes solo se pueden ver y cambiar abriendo la app en el mismo PC donde corre, en http://localhost.",
    };
  }
  // Next pone aquí la IP de quien conecta.
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0];
  if (forwarded && !isLoopbackIp(forwarded)) {
    return { ok: false, reason: "Los ajustes solo se pueden cambiar desde el mismo PC donde corre la app." };
  }
  const origin = request.headers.get("origin");
  if (origin !== null) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      // "null" u otro valor raro: se rechaza abajo.
    }
    if (originHost !== host) return { ok: false, reason: "Petición rechazada: no viene de esta app." };
  } else if (opts.mutating) {
    // Los navegadores siempre mandan Origin en un PUT/POST con fetch.
    return { ok: false, reason: "Petición rechazada: falta la cabecera Origin." };
  }
  if (opts.mutating && !(request.headers.get("content-type") ?? "").startsWith("application/json")) {
    return { ok: false, reason: "Petición rechazada: se esperaba JSON." };
  }
  return { ok: true };
}
