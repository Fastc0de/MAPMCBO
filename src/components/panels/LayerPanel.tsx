"use client";

import { LAYERS, type LayerDefinition } from "@/lib/map/layers";
import type { MapState } from "@/lib/map/state";

interface Props {
  visibility: Record<string, boolean>;
  loading: Record<string, boolean>;
  errors: Record<string, string | undefined>;
  baseMap: MapState["baseMap"];
  onToggle: (layer: LayerDefinition, visible: boolean) => void;
  onBaseMap: (mode: MapState["baseMap"]) => void;
}

const GROUPS: LayerDefinition["group"][] = ["Del asistente", "Lugares", "Google Maps"];

export function LayerPanel({ visibility, loading, errors, baseMap, onToggle, onBaseMap }: Props) {
  return (
    <div className="space-y-3 text-sm">
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Mapa base</h3>
        <div className="grid grid-cols-3 gap-1">
          {(
            [
              ["roadmap", "Calles"],
              ["hybrid", "Satélite"],
              ["labels-hidden", "Sin nombres"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => onBaseMap(mode)}
              className={`rounded-md border px-2 py-1 text-xs ${baseMap === mode ? "border-accent bg-accent text-white" : "border-border"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {GROUPS.map((group) => (
        <div key={group}>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{group}</h3>
          <ul className="space-y-1">
            {LAYERS.filter((l) => l.group === group).map((layer) => (
              <li key={layer.id}>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={visibility[layer.id] ?? false}
                    onChange={(e) => onToggle(layer, e.target.checked)}
                    className="accent-[var(--accent)]"
                  />
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: layer.color }} />
                  <span className="flex-1">{layer.label}</span>
                  {loading[layer.id] && <span className="text-xs text-muted">…</span>}
                </label>
                {errors[layer.id] && <p className="ml-6 text-xs text-red-600">{errors[layer.id]}</p>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="text-xs text-muted">Las capas de lugares buscan en Google Places dentro de la zona visible al activarlas.</p>
    </div>
  );
}
