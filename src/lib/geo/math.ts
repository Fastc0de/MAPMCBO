import type { Bounds, LatLng } from "./types";

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Distancia en metros entre dos puntos (fórmula de haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distancia en metros de un punto al segmento AB, con proyección local plana (válida a escala urbana). */
export function distanceToSegmentMeters(p: LatLng, a: LatLng, b: LatLng): number {
  const cosLat = Math.cos(toRad(p.lat));
  const project = (q: LatLng) => ({
    x: toRad(q.lng) * cosLat * EARTH_RADIUS_M,
    y: toRad(q.lat) * EARTH_RADIUS_M,
  });
  const P = project(p);
  const A = project(a);
  const B = project(b);
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.y - A.y) * dy) / lenSq));
  const cx = A.x + t * dx;
  const cy = A.y + t * dy;
  return Math.hypot(P.x - cx, P.y - cy);
}

/** Distancia mínima en metros de un punto a una polilínea. */
export function distanceToPathMeters(p: LatLng, path: LatLng[]): number {
  if (path.length === 0) return Infinity;
  if (path.length === 1) return distanceMeters(p, path[0]);
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    best = Math.min(best, distanceToSegmentMeters(p, path[i], path[i + 1]));
  }
  return best;
}

export function boundsContains(bounds: Bounds, p: LatLng): boolean {
  return p.lat >= bounds.south && p.lat <= bounds.north && p.lng >= bounds.west && p.lng <= bounds.east;
}

/** Distancia de un punto a un rectángulo (0 si está dentro). */
export function distanceToBoundsMeters(p: LatLng, b: Bounds): number {
  if (boundsContains(b, p)) return 0;
  const clamped = {
    lat: Math.min(Math.max(p.lat, b.south), b.north),
    lng: Math.min(Math.max(p.lng, b.west), b.east),
  };
  return distanceMeters(p, clamped);
}

export function boundsOfPoints(points: LatLng[]): Bounds | null {
  if (points.length === 0) return null;
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const p of points) {
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
    west = Math.min(west, p.lng);
    east = Math.max(east, p.lng);
  }
  return { south, west, north, east };
}

export function boundsCenter(b: Bounds): LatLng {
  return { lat: (b.south + b.north) / 2, lng: (b.west + b.east) / 2 };
}

/** Rumbo aproximado (N, NE, E…) desde `from` hacia `to`. Útil para lecciones de orientación. */
export function cardinalDirection(from: LatLng, to: LatLng): string {
  const y = Math.sin(toRad(to.lng - from.lng)) * Math.cos(toRad(to.lat));
  const x =
    Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
    Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(toRad(to.lng - from.lng));
  const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  const names = ["norte", "noreste", "este", "sureste", "sur", "suroeste", "oeste", "noroeste"];
  return names[Math.round(bearing / 45) % 8];
}

/**
 * Decodifica una polilínea codificada con el algoritmo de Google
 * (https://developers.google.com/maps/documentation/utilities/polylinealgorithm).
 */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    for (const axis of [0, 1]) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index < encoded.length);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta;
      else lng += delta;
    }
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

/** Reduce una polilínea a como mucho `max` puntos (para no inflar el contexto del agente). */
export function samplePath(path: LatLng[], max: number): LatLng[] {
  if (path.length <= max) return path;
  const step = (path.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => path[Math.round(i * step)]);
}

export const round = (n: number, digits = 5) => Math.round(n * 10 ** digits) / 10 ** digits;
