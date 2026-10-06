import { describe, expect, it } from "vitest";
import type { MapHighlight, MapMarker } from "@/lib/map/actions";
import { applyMapAction, buildMapContext, initialMapState } from "@/lib/map/state";

const base = () => initialMapState({ center: { lat: 10.64, lng: -71.61 }, zoom: 12 });

const marker = (id: string, lat = 10.65): MapMarker => ({
  id,
  position: { lat, lng: -71.6 },
  title: `Lugar ${id}`,
  placeId: `pid-${id}`,
  layerId: "assistant-places",
  source: "GOOGLE_MAPS_DATA",
});

const road: MapHighlight = {
  id: "road-1",
  kind: "road",
  name: "Avenida de prueba",
  label: "Avenida de prueba",
  hiddenName: false,
  path: [
    { lat: 10.6, lng: -71.6 },
    { lat: 10.7, lng: -71.6 },
  ],
  layerId: "roads",
  source: "GOOGLE_MAPS_DATA",
};

describe("applyMapAction", () => {
  it("ADD_MARKERS sustituye por id y encuadra si se pide", () => {
    let s = applyMapAction(base(), { type: "ADD_MARKERS", markers: [marker("a"), marker("b", 10.7)], fit: true });
    expect(s.markers).toHaveLength(2);
    expect(s.cameraCommand?.kind).toBe("fit");
    s = applyMapAction(s, { type: "ADD_MARKERS", markers: [{ ...marker("a"), title: "Nuevo" }] });
    expect(s.markers).toHaveLength(2);
    expect(s.markers.find((m) => m.id === "a")?.title).toBe("Nuevo");
  });

  it("un solo marcador centra con zoom de calle", () => {
    const s = applyMapAction(base(), { type: "ADD_MARKERS", markers: [marker("a")], fit: true });
    expect(s.cameraCommand).toMatchObject({ kind: "center", zoom: 16 });
  });

  it("REMOVE_MARKERS por capa, por id y todos", () => {
    let s = applyMapAction(base(), { type: "ADD_MARKERS", markers: [marker("a"), { ...marker("b"), layerId: "search" }] });
    s = applyMapAction(s, { type: "REMOVE_MARKERS", layerId: "search" });
    expect(s.markers.map((m) => m.id)).toEqual(["a"]);
    s = applyMapAction(s, { type: "REMOVE_MARKERS", ids: ["a"] });
    expect(s.markers).toHaveLength(0);
  });

  it("SET_FEATURE_LABELS oculta y revela nombres de vías y marcadores", () => {
    let s = applyMapAction(base(), { type: "HIGHLIGHT_ROAD", highlight: road });
    s = applyMapAction(s, { type: "ADD_MARKERS", markers: [marker("a")] });
    s = applyMapAction(s, { type: "SET_FEATURE_LABELS", labels: { "road-1": "A", a: "B" } });
    expect(s.highlights[0]).toMatchObject({ label: "Vía A", hiddenName: true, name: "Avenida de prueba" });
    expect(s.markers[0]).toMatchObject({ quizLabel: "Lugar B", glyph: "B" });
    s = applyMapAction(s, { type: "SET_FEATURE_LABELS", labels: { "road-1": null, a: null } });
    expect(s.highlights[0]).toMatchObject({ label: "Avenida de prueba", hiddenName: false });
    expect(s.markers[0].quizLabel).toBeUndefined();
  });

  it("cada comando de cámara tiene un seq nuevo", () => {
    const a = applyMapAction(base(), { type: "SET_ZOOM", zoom: 14 });
    const b = applyMapAction(a, { type: "SET_ZOOM", zoom: 14 });
    expect(b.cameraCommand!.seq).toBeGreaterThan(a.cameraCommand!.seq);
  });

  it("CLEAR_ALL limpia lo dibujado pero no la cámara", () => {
    let s = applyMapAction(base(), { type: "HIGHLIGHT_ROAD", highlight: road });
    s = applyMapAction(s, { type: "CLEAR_ALL" });
    expect(s.highlights).toHaveLength(0);
    expect(s.camera.zoom).toBe(12);
  });
});

describe("buildMapContext", () => {
  it("expone la vía seleccionada para resolver «alrededor»", () => {
    let s = applyMapAction(base(), { type: "HIGHLIGHT_ROAD", highlight: road });
    s = applyMapAction(s, { type: "SELECT", selection: { kind: "road", id: "road-1", name: "Avenida de prueba" } });
    const ctx = buildMapContext(s);
    expect(ctx.selectedRoad).toEqual({ id: "road-1", name: "Avenida de prueba" });
    expect(ctx.highlightedFeatures[0].samplePath?.length).toBe(2);
  });

  it("no revela al agente un nombre oculto sin avisar", () => {
    let s = applyMapAction(base(), { type: "ADD_MARKERS", markers: [marker("a")] });
    s = applyMapAction(s, { type: "SET_FEATURE_LABELS", labels: { a: "A" } });
    expect(buildMapContext(s).visibleMarkers[0].title).toContain("Lugar A");
  });

  it("limita los marcadores del contexto", () => {
    const many = Array.from({ length: 60 }, (_, i) => marker(`m${i}`));
    const s = applyMapAction(base(), { type: "ADD_MARKERS", markers: many });
    expect(buildMapContext(s).visibleMarkers).toHaveLength(40);
  });
});
