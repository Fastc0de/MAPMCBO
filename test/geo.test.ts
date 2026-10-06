import { describe, expect, it } from "vitest";
import {
  boundsOfPoints,
  cardinalDirection,
  decodePolyline,
  distanceMeters,
  distanceToBoundsMeters,
  distanceToPathMeters,
  samplePath,
} from "@/lib/geo/math";

describe("decodePolyline", () => {
  it("decodifica el ejemplo de la documentación de Google", () => {
    // https://developers.google.com/maps/documentation/utilities/polylinealgorithm
    const points = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(points).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);
  });
});

describe("distancias", () => {
  it("haversine: un grado de latitud ≈ 111 km", () => {
    expect(distanceMeters({ lat: 10, lng: -71 }, { lat: 11, lng: -71 })).toBeGreaterThan(110_000);
    expect(distanceMeters({ lat: 10, lng: -71 }, { lat: 11, lng: -71 })).toBeLessThan(112_000);
  });

  it("distancia a una polilínea usa el segmento más cercano", () => {
    const path = [
      { lat: 10.6, lng: -71.7 },
      { lat: 10.6, lng: -71.6 },
    ];
    // ~0.001° de latitud ≈ 111 m al norte del tramo
    const d = distanceToPathMeters({ lat: 10.601, lng: -71.65 }, path);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(120);
  });

  it("distancia a un rectángulo es 0 dentro", () => {
    const b = { south: 10, west: -72, north: 11, east: -71 };
    expect(distanceToBoundsMeters({ lat: 10.5, lng: -71.5 }, b)).toBe(0);
    expect(distanceToBoundsMeters({ lat: 11.01, lng: -71.5 }, b)).toBeGreaterThan(1000);
  });
});

describe("utilidades", () => {
  it("rumbo cardinal", () => {
    const c = { lat: 10.6, lng: -71.6 };
    expect(cardinalDirection(c, { lat: 10.7, lng: -71.6 })).toBe("norte");
    expect(cardinalDirection(c, { lat: 10.6, lng: -71.5 })).toBe("este");
    expect(cardinalDirection(c, { lat: 10.5, lng: -71.7 })).toBe("suroeste");
  });

  it("boundsOfPoints y samplePath", () => {
    expect(boundsOfPoints([])).toBeNull();
    expect(boundsOfPoints([{ lat: 1, lng: 2 }, { lat: -1, lng: 5 }])).toEqual({ south: -1, west: 2, north: 1, east: 5 });
    const path = Array.from({ length: 100 }, (_, i) => ({ lat: i, lng: 0 }));
    const s = samplePath(path, 5);
    expect(s).toHaveLength(5);
    expect(s[0]).toEqual(path[0]);
    expect(s[4]).toEqual(path[99]);
  });
});
