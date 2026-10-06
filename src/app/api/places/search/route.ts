import { z } from "zod";
import { boundsSchema, getProviders, jsonHandler, latLngSchema } from "@/server/http";

const bodySchema = z.object({
  query: z.string().min(1).max(200),
  bounds: boundsSchema.optional(),
  center: latLngSchema.optional(),
});

/** Buscador de la interfaz: Places API (New) Text Search, sesgado a la zona visible. */
export async function POST(request: Request) {
  return jsonHandler(async () => {
    const body = bodySchema.parse(await request.json());
    const places = await getProviders().places.searchText({
      query: body.query,
      within: body.bounds,
      near: !body.bounds && body.center ? { center: body.center, radiusMeters: 5000 } : undefined,
      maxResults: 12,
    });
    return { places };
  });
}
