import { getProviders, jsonHandler, latLngSchema } from "@/server/http";
import { areaName } from "@/server/tools/context";

/** Qué hay en un punto: dirección y sector (Geocoding API, geocodificación inversa). */
export async function GET(request: Request) {
  return jsonHandler(async () => {
    const params = new URL(request.url).searchParams;
    const position = latLngSchema.parse({ lat: Number(params.get("lat")), lng: Number(params.get("lng")) });
    const results = await getProviders().geocoding.reverseGeocode(position);
    return { area: areaName(results), address: results[0]?.formattedAddress };
  });
}
