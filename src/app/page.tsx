import { connection } from "next/server";
import { MapApp } from "@/components/MapApp";
import { getConfig, missingConfig } from "@/server/config";

export default async function Home() {
  // Las claves se leen en tiempo de ejecución (no se congelan en el build).
  await connection();
  const config = getConfig();
  return (
    <MapApp
      browserKey={config.googleBrowserKey ?? ""}
      mapId={config.googleMapId}
      missing={missingConfig(config)}
    />
  );
}
