import { z } from "zod";
import { getProviders, jsonHandler } from "@/server/http";

/** Detalles de un lugar seleccionado en el mapa (Places API (New) Place Details). */
export async function GET(request: Request) {
  return jsonHandler(async () => {
    const placeId = z.string().min(1).max(300).parse(new URL(request.url).searchParams.get("placeId"));
    return { place: await getProviders().places.getDetails(placeId) };
  });
}
