"use client";

import { useEffect, useState } from "react";
import type { PlaceDetails } from "@/lib/geo/types";
import type { MapState } from "@/lib/map/state";
import { SOURCE_LABEL, SourceTag, sourceKind } from "@/components/ui/RichText";

interface Props {
  state: MapState;
  /** Durante un quiz no se revelan nombres de lo seleccionado. */
  quizActive: boolean;
  onAsk: (text: string) => void;
  onClose: () => void;
}

const km = (m?: number) => (m === undefined ? "" : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const minutes = (s?: number) => (s === undefined ? "" : `${Math.round(s / 60)} min`);

export function SelectionPanel({ state, quizActive, onAsk, onClose }: Props) {
  const sel = state.selection;
  const placeId = sel?.kind === "place" ? sel.placeId : sel?.kind === "marker" ? sel.placeId : undefined;
  const point = sel?.kind === "point" ? sel.position : undefined;
  const [details, setDetails] = useState<{ id: string; place?: PlaceDetails; error?: string } | null>(null);
  const [pointInfo, setPointInfo] = useState<{ key: string; area?: string; address?: string; error?: string } | null>(null);

  useEffect(() => {
    if (!placeId) return;
    let cancelled = false;
    fetch(`/api/places/details?placeId=${encodeURIComponent(placeId)}`)
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        setDetails(res.ok ? { id: placeId, place: data.place } : { id: placeId, error: data.error });
      })
      .catch(() => !cancelled && setDetails({ id: placeId, error: "No se pudieron cargar los detalles." }));
    return () => {
      cancelled = true;
    };
  }, [placeId]);

  const pointKey = point ? `${point.lat},${point.lng}` : null;
  useEffect(() => {
    if (!point || !pointKey) return;
    let cancelled = false;
    fetch(`/api/geocode/reverse?lat=${point.lat}&lng=${point.lng}`)
      .then(async (res) => {
        const data = await res.json();
        if (!cancelled) setPointInfo(res.ok ? { key: pointKey, ...data } : { key: pointKey, error: data.error });
      })
      .catch(() => !cancelled && setPointInfo({ key: pointKey, error: "No se pudo identificar el punto." }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointKey]);

  if (!sel) return null;

  let title = "";
  let body: React.ReactNode = null;
  let askAbout = "";

  if (sel.kind === "place" || sel.kind === "marker") {
    const marker = sel.kind === "marker" ? state.markers.find((m) => m.id === sel.id) : undefined;
    const hidden = quizActive && marker?.quizLabel;
    title = hidden ? marker!.quizLabel! : sel.name;
    askAbout = `¿Qué hay alrededor de ${sel.name}?`;
    const d = details?.id === placeId ? details : null;
    body = (
      <div className="space-y-1">
        {marker && <SourceTag kind={sourceKind(marker.source)} label={SOURCE_LABEL[marker.source]} />}
        {!placeId && marker?.subtitle && <p className="text-muted">{marker.subtitle}</p>}
        {placeId && !d && <p className="text-muted">Cargando detalles de Google…</p>}
        {d?.error && <p className="text-red-600">{d.error}</p>}
        {d?.place && !hidden && (
          <>
            <p className="text-muted">{d.place.address}</p>
            {d.place.rating !== undefined && (
              <p>
                ★ {d.place.rating} <span className="text-muted">({d.place.userRatingCount ?? 0} opiniones)</span>
              </p>
            )}
            {d.place.summary && <p>{d.place.summary}</p>}
            {d.place.phone && <p>Tel.: {d.place.phone}</p>}
            {d.place.openingHours && (
              <details>
                <summary className="cursor-pointer text-muted">Horario</summary>
                <ul className="text-xs">
                  {d.place.openingHours.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              </details>
            )}
            <p className="flex flex-wrap gap-3 text-xs">
              {d.place.website && (
                <a href={d.place.website} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                  Sitio web
                </a>
              )}
              {d.place.googleMapsUri && (
                <a href={d.place.googleMapsUri} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                  Abrir en Google Maps
                </a>
              )}
            </p>
          </>
        )}
        {marker?.note && <p className="text-xs text-muted">{marker.note}</p>}
      </div>
    );
  } else if (sel.kind === "road" || sel.kind === "area") {
    const h = state.highlights.find((x) => x.id === sel.id);
    title = h ? h.label : sel.name;
    askAbout = h && !h.hiddenName ? `¿Qué hay alrededor de ${h.name}? ¿Con qué se conecta?` : "";
    body = h && (
      <div className="space-y-1">
        <SourceTag kind={sourceKind(h.source)} label={SOURCE_LABEL[h.source]} />
        {h.note && <p className="text-xs text-muted">{h.note}</p>}
      </div>
    );
  } else if (sel.kind === "route") {
    const r = state.routes.find((x) => x.id === sel.id);
    title = r?.label ?? sel.name;
    askAbout = "¿Qué lugares importantes hay cerca de esta ruta?";
    body = r && (
      <div className="space-y-1">
        <SourceTag kind={sourceKind(r.source)} label={SOURCE_LABEL[r.source]} />
        <p>
          {km(r.distanceMeters)} {r.durationSeconds !== undefined && `· ${minutes(r.durationSeconds)}`}
        </p>
        {r.steps && r.steps.length > 0 && (
          <ol className="scroll-thin max-h-48 list-decimal space-y-0.5 overflow-y-auto pl-5 text-xs">
            {r.steps
              .filter((s) => s.instruction || s.transit)
              .map((s, i) => (
                <li key={i}>
                  {s.transit
                    ? `${s.transit.vehicleType ?? "Transporte"} ${s.transit.lineShortName ?? s.transit.lineName ?? ""}: de ${s.transit.departureStop?.name ?? "?"} a ${s.transit.arrivalStop?.name ?? "?"} (${s.transit.stopCount ?? "?"} paradas)`
                    : s.instruction}
                </li>
              ))}
          </ol>
        )}
      </div>
    );
  } else if (sel.kind === "transit") {
    const t = state.transitRoutes.find((x) => x.id === sel.id);
    title = t ? `${t.line.name} (${t.line.vehicle.replace("_", " ")})` : sel.name;
    askAbout = "Explícame esta ruta de transporte paso a paso.";
    body = t && (
      <div className="space-y-1">
        <SourceTag kind={sourceKind(t.source)} label={SOURCE_LABEL[t.source]} />
        <ol className="list-decimal space-y-0.5 pl-5 text-xs">
          {t.stops.map((s) => (
            <li key={s.id}>
              {s.name} {s.verified ? <span className="text-emerald-700">· ubicada por Google</span> : <span className="text-amber-700">· sin verificar</span>}
            </li>
          ))}
        </ol>
        {t.note && <p className="text-xs text-muted">{t.note}</p>}
        {t.sourceRefs && (
          <ul className="text-xs">
            {t.sourceRefs.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  } else if (sel.kind === "point") {
    const info = pointInfo?.key === pointKey ? pointInfo : null;
    title = info?.area ?? "Punto seleccionado";
    askAbout = "¿Qué hay alrededor de este punto?";
    body = (
      <div className="space-y-1">
        {!info && <p className="text-muted">Identificando el punto con Google…</p>}
        {info?.address && <p className="text-muted">{info.address}</p>}
        {info?.error && <p className="text-red-600">{info.error}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-panel p-3 text-sm shadow-lg">
      <div className="mb-1 flex items-start justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        <button onClick={onClose} className="text-xs text-muted" aria-label="Cerrar">
          ✕
        </button>
      </div>
      {body}
      {askAbout && !quizActive && (
        <button onClick={() => onAsk(askAbout)} className="mt-2 rounded-md border border-border px-2 py-1 text-xs hover:border-accent">
          Preguntar al tutor sobre esto
        </button>
      )}
    </div>
  );
}
