import { z } from "zod";
import { getProviders, jsonHandler, latLngSchema } from "@/server/http";

const bodySchema = z.object({
  center: latLngSchema,
  radiusMeters: z.number().min(50).max(50000),
  includedTypes: z.array(z.string().min(1).max(60)).min(1).max(10),
});

/** Capas de lugares (restaurantes, hospitales…): Places API (New) Nearby Search en la zona visible. */
export async function POST(request: Request) {
  return jsonHandler(async () => {
    const body = bodySchema.parse(await request.json());
    const places = await getProviders().places.searchNearby({ ...body, maxResults: 20 });
    return { places };
  });
}
