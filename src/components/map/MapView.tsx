"use client";

import { AdvancedMarker, Map, Pin, Polyline, Rectangle, useMap, type MapMouseEvent } from "@vis.gl/react-google-maps";
import { useEffect, useMemo } from "react";
import { DEFAULT_CITY, VENEZUELA } from "@/lib/cities";
import { boundsCenter } from "@/lib/geo/math";
import type { LatLng } from "@/lib/geo/types";
import type { MapHighlight, MapMarker } from "@/lib/map/actions";
import { LAYER_BY_ID, layerColor } from "@/lib/map/layers";
import type { CameraCommand, CameraState, MapState } from "@/lib/map/state";

export type FeatureClick =
  | { kind: "marker"; marker: MapMarker }
  | { kind: "highlight"; highlight: MapHighlight }
  | { kind: "route"; id: string; label: string }
  | { kind: "transit"; id: string; label: string };

interface Props {
  mapId: string;
  state: MapState;
  layerVisibility: Record<string, boolean>;
  /** Marcadores de las capas de lugares (restaurantes, hospitales…). */
  layerMarkers: MapMarker[];
  /** Mientras hay un quiz "locate", el clic en el mapa es una respuesta. */
  pickingPoint: boolean;
  onCameraIdle: (camera: CameraState) => void;
  onMapClick: (position: LatLng, placeId: string | null) => void;
  onFeatureClick: (feature: FeatureClick) => void;
  /** Marcador temporal (por ejemplo la respuesta correcta de un quiz). */
  revealMarker?: { position: LatLng; title: string } | null;
}

const MAP_TYPE: Record<MapState["baseMap"], string> = {
  roadmap: "roadmap",
  "labels-hidden": "satellite",
  hybrid: "hybrid",
};

export function MapView(props: Props) {
  const { state, layerVisibility } = props;
  const visible = (layerId: string) => layerVisibility[layerId] ?? true;

  const markers = useMemo(
    () => [...state.markers.filter((m) => visible(m.layerId)), ...props.layerMarkers],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.markers, props.layerMarkers, layerVisibility],
  );

  const handleClick = (e: MapMouseEvent) => {
    if (!e.detail.latLng) return;
    // Evita la ventana de información por defecto de Google para los POI: mostramos nuestro panel.
    if (e.detail.placeId) e.stop();
    props.onMapClick(e.detail.latLng, props.pickingPoint ? null : e.detail.placeId);
  };

  return (
    <Map
      mapId={props.mapId}
      defaultCenter={DEFAULT_CITY.center}
      defaultZoom={DEFAULT_CITY.zoom}
      mapTypeId={MAP_TYPE[state.baseMap]}
      gestureHandling="greedy"
      clickableIcons={!props.pickingPoint}
      draggableCursor={props.pickingPoint ? "crosshair" : undefined}
      restriction={{ latLngBounds: { south: VENEZUELA.bounds.south - 6, west: VENEZUELA.bounds.west - 8, north: VENEZUELA.bounds.north + 6, east: VENEZUELA.bounds.east + 8 } }}
      mapTypeControl={false}
      streetViewControl={false}
      fullscreenControl={false}
      onClick={handleClick}
      onIdle={(e) => {
        const center = e.map.getCenter();
        const bounds = e.map.getBounds();
        if (!center) return;
        props.onCameraIdle({
          center: { lat: center.lat(), lng: center.lng() },
          zoom: e.map.getZoom() ?? DEFAULT_CITY.zoom,
          bounds: bounds ? toBounds(bounds.toJSON()) : undefined,
        });
      }}
      className="h-full w-full"
    >
      <CameraController command={state.cameraCommand} />
      <GoogleLayers layerVisibility={layerVisibility} />

      {visible("routes") &&
        state.routes.map((r) => (
          <Polyline
            key={r.id}
            path={r.path}
            strokeColor={r.color ?? layerColor(r.layerId)}
            strokeOpacity={0.9}
            strokeWeight={selectedId(state) === r.id ? 8 : 6}
            onClick={() => props.onFeatureClick({ kind: "route", id: r.id, label: r.label })}
          />
        ))}

      {state.highlights
        .filter((h) => visible(h.layerId))
        .map((h) => (
          <HighlightShape key={h.id} highlight={h} selected={selectedId(state) === h.id} onClick={() => props.onFeatureClick({ kind: "highlight", highlight: h })} />
        ))}

      {visible("transit-web") &&
        state.transitRoutes.map((t) => (
          <TransitShape key={t.id} transit={t} onClick={() => props.onFeatureClick({ kind: "transit", id: t.id, label: t.line.name })} />
        ))}

      {markers.map((m) => (
        <AdvancedMarker
          key={m.id}
          position={m.position}
          title={m.quizLabel ?? m.title}
          onClick={() => props.onFeatureClick({ kind: "marker", marker: m })}
        >
          <Pin
            background={layerColor(m.layerId)}
            borderColor="#ffffff"
            glyphColor="#ffffff"
            glyphText={m.glyph}
            scale={selectedId(state) === m.id ? 1.3 : 1}
          />
        </AdvancedMarker>
      ))}

      {props.revealMarker && (
        <AdvancedMarker position={props.revealMarker.position} title={props.revealMarker.title} zIndex={1000}>
          <div className="rounded-full border-2 border-white bg-emerald-600 px-2 py-1 text-xs font-semibold text-white shadow-lg">
            ✓ {props.revealMarker.title}
          </div>
        </AdvancedMarker>
      )}
    </Map>
  );
}

function selectedId(state: MapState): string | undefined {
  const s = state.selection;
  if (!s || s.kind === "point" || s.kind === "place") return undefined;
  return s.id;
}

const toBounds = (b: google.maps.LatLngBoundsLiteral) => ({ south: b.south, west: b.west, north: b.north, east: b.east });

function CameraController({ command }: { command: CameraCommand | null }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !command) return;
    if (command.kind === "center") {
      map.panTo(command.center);
      if (command.zoom !== undefined) map.setZoom(command.zoom);
    } else if (command.kind === "zoom") {
      map.setZoom(command.zoom);
    } else {
      map.fitBounds(command.bounds, 60);
    }
    // Solo se ejecuta una vez por comando (seq cambia con cada uno).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, command?.seq]);
  return null;
}

function GoogleLayers({ layerVisibility }: { layerVisibility: Record<string, boolean> }) {
  const map = useMap();
  const transitOn = Boolean(layerVisibility["google-transit"]);
  const trafficOn = Boolean(layerVisibility["google-traffic"]);
  useEffect(() => {
    if (!map || !transitOn) return;
    const layer = new google.maps.TransitLayer();
    layer.setMap(map);
    return () => layer.setMap(null);
  }, [map, transitOn]);
  useEffect(() => {
    if (!map || !trafficOn) return;
    const layer = new google.maps.TrafficLayer();
    layer.setMap(map);
    return () => layer.setMap(null);
  }, [map, trafficOn]);
  return null;
}

function HighlightShape({ highlight: h, selected, onClick }: { highlight: MapHighlight; selected: boolean; onClick: () => void }) {
  const color = h.color ?? layerColor(h.layerId);
  const labelAt: LatLng | undefined = h.path?.length
    ? h.path[Math.floor(h.path.length / 2)]
    : h.bounds
      ? boundsCenter(h.bounds)
      : undefined;
  return (
    <>
      {h.path && h.path.length > 1 && (
        <>
          {/* Borde blanco debajo para que la vía resalte sobre el mapa */}
          <Polyline path={h.path} strokeColor="#ffffff" strokeOpacity={0.9} strokeWeight={selected ? 13 : 10} clickable={false} />
          <Polyline path={h.path} strokeColor={color} strokeOpacity={0.95} strokeWeight={selected ? 8 : 6} onClick={onClick} />
        </>
      )}
      {!h.path && h.bounds && (
        <Rectangle
          bounds={h.bounds}
          strokeColor={color}
          strokeWeight={selected ? 4 : 2}
          strokeOpacity={0.9}
          fillColor={color}
          fillOpacity={h.kind === "area" ? 0.15 : 0.06}
          onClick={onClick}
        />
      )}
      {labelAt && (
        <AdvancedMarker position={labelAt} onClick={onClick} zIndex={500}>
          <div
            className="max-w-48 truncate rounded-md border px-2 py-0.5 text-xs font-semibold shadow"
            style={{ background: "#ffffff", color, borderColor: color }}
          >
            {h.label}
          </div>
        </AdvancedMarker>
      )}
    </>
  );
}

function TransitShape({ transit, onClick }: { transit: MapState["transitRoutes"][number]; onClick: () => void }) {
  const color = LAYER_BY_ID.get("transit-web")?.color ?? "#db2777";
  const dashed = [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 3 }, offset: "0", repeat: "14px" }];
  return (
    <>
      {transit.segments.map((s) => (
        <Polyline key={`${s.fromStopId}-${s.toStopId}`} path={s.path} strokeColor={color} strokeOpacity={0} icons={dashed} onClick={onClick} />
      ))}
      {transit.stops
        .filter((s) => s.position)
        .map((s, i) => (
          <AdvancedMarker key={s.id} position={s.position!} title={`${s.name} — ${s.resolution}`} onClick={onClick}>
            <div
              className="flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-white px-1 text-[11px] font-bold text-white shadow"
              style={{ background: color }}
            >
              {i + 1}
            </div>
          </AdvancedMarker>
        ))}
    </>
  );
}
