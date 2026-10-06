import type { Bounds, LatLng } from "@/lib/geo/types";

/**
 * Ciudades disponibles. Maracaibo es la primera experiencia; añadir otra ciudad
 * es añadir una entrada aquí. El centro y los límites solo sirven para mover la
 * cámara y sesgar las búsquedas de Google: nunca se presentan como datos.
 */
export interface City {
  id: string;
  name: string;
  state: string;
  center: LatLng;
  zoom: number;
  /** Rectángulo aproximado para sesgar búsquedas y validar geocodificaciones. */
  bounds: Bounds;
}

export const CITIES: City[] = [
  {
    id: "maracaibo",
    name: "Maracaibo",
    state: "Zulia",
    center: { lat: 10.6427, lng: -71.6125 },
    zoom: 12,
    bounds: { south: 10.53, west: -71.78, north: 10.8, east: -71.55 },
  },
  {
    id: "caracas",
    name: "Caracas",
    state: "Distrito Capital",
    center: { lat: 10.4806, lng: -66.9036 },
    zoom: 12,
    bounds: { south: 10.38, west: -67.1, north: 10.56, east: -66.72 },
  },
  {
    id: "valencia",
    name: "Valencia",
    state: "Carabobo",
    center: { lat: 10.162, lng: -68.0077 },
    zoom: 12,
    bounds: { south: 10.05, west: -68.1, north: 10.3, east: -67.9 },
  },
  {
    id: "barquisimeto",
    name: "Barquisimeto",
    state: "Lara",
    center: { lat: 10.0678, lng: -69.3474 },
    zoom: 12,
    bounds: { south: 9.98, west: -69.45, north: 10.13, east: -69.22 },
  },
  {
    id: "merida",
    name: "Mérida",
    state: "Mérida",
    center: { lat: 8.5897, lng: -71.1561 },
    zoom: 13,
    bounds: { south: 8.53, west: -71.23, north: 8.65, east: -71.1 },
  },
  {
    id: "puerto-la-cruz",
    name: "Puerto La Cruz",
    state: "Anzoátegui",
    center: { lat: 10.2167, lng: -64.6333 },
    zoom: 13,
    bounds: { south: 10.15, west: -64.72, north: 10.26, east: -64.55 },
  },
];

export const DEFAULT_CITY = CITIES[0];

export const VENEZUELA: { center: LatLng; zoom: number; bounds: Bounds } = {
  center: { lat: 7.1, lng: -66.2 },
  zoom: 6,
  bounds: { south: 0.6, west: -73.4, north: 12.3, east: -59.8 },
};

export function findCity(idOrName: string): City | undefined {
  const key = idOrName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
  return CITIES.find(
    (c) =>
      c.id === key ||
      c.name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "") === key,
  );
}
