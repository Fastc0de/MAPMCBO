"use client";

import { useEffect, useRef, useState } from "react";
import {
  SETTINGS_SECTIONS,
  splitModels,
  type ModelProviderId,
  type SearxngStatus,
  type SettingField,
  type SettingsSection,
  type SettingsView,
  type SettingValue,
} from "@/lib/settings";

/** Cambios sin guardar: valor nuevo, o `null` para borrar. */
type Draft = Record<string, string | null>;

interface Props {
  /** Sección a la que saltar al abrir (p. ej. "gemini" o "web"). */
  initialSection?: string;
  onClose: () => void;
  /** Tras guardar, con las variables que cambiaron. */
  onSaved: (changed: string[]) => void;
}

const inputClass =
  "min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 py-1.5 text-sm outline-none focus:border-accent disabled:opacity-50";
const smallButton = "shrink-0 rounded-md border border-border px-2 py-1 text-xs hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/5";

const GOOGLE = SETTINGS_SECTIONS.filter((s) => s.id === "google");
const MODEL_SECTIONS = SETTINGS_SECTIONS.filter((s) => s.provider);
const WEB = SETTINGS_SECTIONS.filter((s) => s.id === "web");

export function SettingsDialog({ initialSection, onClose, onSaved }: Props) {
  const [view, setView] = useState<SettingsView | null>(null);
  const [searxng, setSearxng] = useState<SearxngStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dirty = Object.keys(draft).length > 0;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((v: SettingsView) => {
        if (cancelled) return;
        setView(v);
        setSearxng(v.searxng);
      })
      .catch(() => !cancelled && setLoadError("No se pudieron cargar los ajustes. ¿Está el servidor en marcha?"));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (view && initialSection) bodyRef.current?.querySelector(`[data-section="${initialSection}"]`)?.scrollIntoView({ block: "start" });
  }, [view, initialSection]);

  const close = () => {
    if (dirty && !window.confirm("Tienes cambios sin guardar. ¿Cerrar igualmente?")) return;
    onClose();
  };
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Mientras SearXNG arranca, se consulta su estado cada 2 s.
  useEffect(() => {
    if (searxng?.state !== "starting") return;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/settings/searxng", { cache: "no-store" });
        if (res.ok) setSearxng(await res.json());
      } catch {
        // se reintenta al pulsar «Comprobar»
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [searxng]);

  const setValue = (env: string, value: string | null) => {
    setDraft((d) => ({ ...d, [env]: value }));
    setMessage(null);
  };
  const undo = (env: string) =>
    setDraft((d) => {
      const next = { ...d };
      delete next[env];
      return next;
    });

  /** Valor que se ve en el formulario: el cambio sin guardar o el guardado. */
  const current = (env: string): string => (Object.hasOwn(draft, env) ? (draft[env] ?? "") : (view?.values[env]?.value ?? ""));

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: draft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ kind: "error", text: data.error ?? `Error ${res.status}` });
        return;
      }
      const changed = Object.keys(draft);
      setView(data as SettingsView);
      setSearxng((data as SettingsView).searxng);
      setDraft({});
      setMessage({ kind: "ok", text: `Guardado en ${(data as SettingsView).file}. Ya está en uso, sin reiniciar.` });
      onSaved(changed);
    } catch {
      setMessage({ kind: "error", text: "No se pudo conectar con el servidor." });
    } finally {
      setSaving(false);
    }
  };

  const startSearxng = async () => {
    try {
      const res = await fetch("/api/settings/searxng", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setMessage({ kind: "error", text: data.error ?? `Error ${res.status}` });
      else setSearxng(data as SearxngStatus);
    } catch {
      setMessage({ kind: "error", text: "No se pudo conectar con el servidor." });
    }
  };

  const checkSearxng = async () => {
    try {
      const res = await fetch("/api/settings/searxng", { cache: "no-store" });
      if (res.ok) setSearxng(await res.json());
    } catch {
      setMessage({ kind: "error", text: "No se pudo conectar con el servidor." });
    }
  };

  const editable = Boolean(view?.editable);

  const renderField = (section: SettingsSection, field: SettingField) => {
    const saved: SettingValue = view?.values[field.env] ?? { set: false };
    const id = `setting-${field.env}`;
    if (field.kind === "toggle") {
      const value = current(field.env) || field.defaultValue || "false";
      return (
        <label key={field.env} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value === "true"}
            disabled={!editable}
            onChange={(e) => setValue(field.env, e.target.checked ? "true" : "false")}
          />
          {field.label}
        </label>
      );
    }
    return (
      <div key={field.env} className="space-y-1">
        <label htmlFor={id} className="block text-xs font-medium">
          {field.label}
        </label>
        {field.kind === "secret" ? (
          <SecretInput
            id={id}
            field={field}
            saved={saved}
            draft={Object.hasOwn(draft, field.env) ? draft[field.env] : undefined}
            disabled={!editable}
            onChange={(v) => (v === "" ? undo(field.env) : setValue(field.env, v))}
            onRemove={() => setValue(field.env, null)}
            onUndo={() => undo(field.env)}
          />
        ) : field.kind === "models" ? (
          <ModelsInput
            id={id}
            provider={section.provider!}
            models={splitModels(current(field.env))}
            defaults={splitModels(field.defaultValue)}
            disabled={!editable}
            onChange={(list) => setValue(field.env, list.join(","))}
            credentials={() => credentialsFor(section, draft)}
          />
        ) : (
          <input
            id={id}
            type={field.kind === "url" ? "url" : "text"}
            value={current(field.env)}
            placeholder={field.defaultValue ?? field.placeholder}
            disabled={!editable}
            spellCheck={false}
            onChange={(e) => setValue(field.env, e.target.value)}
            className={`${inputClass} w-full`}
          />
        )}
      </div>
    );
  };

  const renderSection = (section: SettingsSection) => {
    const active = sectionActive(section, view);
    return (
      <section key={section.id} data-section={section.id} className="scroll-mt-2 rounded-xl border border-border p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{section.title}</h3>
            <p className="text-xs text-muted">{section.description}</p>
            {section.link && (
              <a href={section.link.href} target="_blank" rel="noopener noreferrer" className="text-xs text-accent underline">
                {section.link.text}
              </a>
            )}
          </div>
          {active !== undefined && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                active ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "bg-black/5 text-muted dark:bg-white/10"
              }`}
            >
              {active ? "Activo" : "Sin configurar"}
            </span>
          )}
        </div>
        <div className="mt-3 space-y-3">{section.fields.map((f) => renderField(section, f))}</div>
        {section.id === "google" &&
          view?.warnings.map((w) => (
            <p key={w} className="mt-2 text-xs text-amber-700 dark:text-amber-300">
              {w}
            </p>
          ))}
        {section.id === "web" && searxng && (
          <SearxngBox status={searxng} editable={editable} onStart={startSearxng} onCheck={checkSearxng} />
        )}
      </section>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-border bg-panel shadow-2xl sm:max-w-2xl sm:rounded-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 id="settings-title" className="text-base font-semibold">
              Ajustes
            </h2>
            <p className="text-xs text-muted">
              Claves, modelos del chat y búsqueda web. Se guardan en <code>.env.local</code> en este PC (no se suben al repo) y las claves
              nunca se muestran completas.
            </p>
          </div>
          <button onClick={close} aria-label="Cerrar" className="rounded-md px-2 py-1 text-lg leading-none text-muted hover:bg-black/5 dark:hover:bg-white/5">
            ×
          </button>
        </header>

        <div ref={bodyRef} className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {loadError && <p className="text-sm text-red-700 dark:text-red-300">{loadError}</p>}
          {!view && !loadError && <p className="text-sm text-muted">Cargando…</p>}
          {view && !view.editable && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">{view.reason}</p>
          )}
          {view?.editable && (
            <>
              {GOOGLE.map(renderSection)}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Modelos para el chat</h3>
                <p className="text-xs text-muted">
                  Pon la clave de los proveedores que uses. Sus modelos aparecen en el selector del chat; con «Ver modelos de tu cuenta» eliges
                  cuáles.
                </p>
                {MODEL_SECTIONS.map(renderSection)}
              </div>
              {WEB.map(renderSection)}
            </>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
          {message && (
            <p className={`mr-auto text-xs ${message.kind === "ok" ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>
              {message.text}
            </p>
          )}
          <button onClick={close} className="rounded-lg border border-border px-3 py-1.5 text-sm">
            {dirty ? "Cancelar" : "Cerrar"}
          </button>
          {editable && (
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              {saving ? "Guardando…" : "Guardar"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

/** ¿Está en uso este proveedor? Solo con lo guardado, no con el borrador. */
function sectionActive(section: SettingsSection, view: SettingsView | null): boolean | undefined {
  if (!view?.editable) return undefined;
  const v = view.values;
  switch (section.id) {
    case "google":
      return Boolean(v.GOOGLE_MAPS_API_KEY?.set);
    case "gemini":
      return Boolean(v.GEMINI_API_KEY?.set);
    case "opencode-go":
      return Boolean(v.OPENCODE_GO_API_KEY?.set);
    case "anthropic":
      return Boolean(v.ANTHROPIC_API_KEY?.set);
    case "custom":
      return Boolean(v.OPENAI_COMPATIBLE_BASE_URL?.set && v.OPENAI_COMPATIBLE_MODELS?.set);
    default:
      return undefined;
  }
}

/** Para pedir la lista de modelos con la clave recién escrita, aunque aún no esté guardada. */
function credentialsFor(section: SettingsSection, draft: Draft): { apiKey?: string; baseUrl?: string } {
  const keyField = section.fields.find((f) => f.kind === "secret");
  const urlField = section.fields.find((f) => f.kind === "url");
  return {
    apiKey: keyField ? (draft[keyField.env] ?? undefined) : undefined,
    baseUrl: urlField ? (draft[urlField.env] ?? undefined) : undefined,
  };
}

function SecretInput({
  id,
  field,
  saved,
  draft,
  disabled,
  onChange,
  onRemove,
  onUndo,
}: {
  id: string;
  field: SettingField;
  saved: SettingValue;
  draft: string | null | undefined;
  disabled: boolean;
  onChange: (value: string) => void;
  onRemove: () => void;
  onUndo: () => void;
}) {
  const [show, setShow] = useState(false);
  const removing = draft === null;
  return (
    <div>
      <div className="flex gap-1">
        <input
          id={id}
          type={show ? "text" : "password"}
          autoComplete="off"
          spellCheck={false}
          value={draft ?? ""}
          placeholder={saved.set ? `Guardada (${saved.hint}). Escribe otra para cambiarla.` : (field.placeholder ?? "Pega aquí la clave")}
          disabled={disabled || removing}
          onChange={(e) => onChange(e.target.value.trim())}
          className={inputClass}
        />
        <button type="button" onClick={() => setShow((s) => !s)} disabled={disabled || !draft} className={smallButton}>
          {show ? "Ocultar" : "Ver"}
        </button>
        {saved.set && draft === undefined && (
          <button type="button" onClick={onRemove} disabled={disabled} className={smallButton}>
            Quitar
          </button>
        )}
        {draft !== undefined && (
          <button type="button" onClick={onUndo} className={smallButton}>
            Deshacer
          </button>
        )}
      </div>
      {removing && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Se borrará al guardar.</p>}
    </div>
  );
}

function ModelsInput({
  id,
  provider,
  models: explicit,
  defaults,
  disabled,
  onChange,
  credentials,
}: {
  id: string;
  provider: ModelProviderId;
  models: string[];
  defaults: string[];
  disabled: boolean;
  onChange: (models: string[]) => void;
  credentials: () => { apiKey?: string; baseUrl?: string };
}) {
  const [adding, setAdding] = useState("");
  const [available, setAvailable] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const usingDefaults = explicit.length === 0 && defaults.length > 0;
  const models = usingDefaults ? defaults : explicit;

  const add = () => {
    const names = splitModels(adding).filter((m) => !models.includes(m));
    if (names.length) onChange([...models, ...names]);
    setAdding("");
  };
  const toggle = (m: string) => onChange(models.includes(m) ? models.filter((x) => x !== m) : [...models, m]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, ...credentials() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      setAvailable(data.models as string[]);
      if (!data.models.length) setError("El proveedor no devolvió ningún modelo.");
    } catch (e) {
      setAvailable(null);
      setError(e instanceof Error ? e.message : "No se pudo cargar la lista.");
    } finally {
      setLoading(false);
    }
  };

  const shown = (available ?? []).filter((m) => m.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1">
        {models.map((m) => {
          const unknown = available !== null && available.length > 0 && !available.includes(m);
          return (
            <span
              key={m}
              title={unknown ? "No aparece en la lista de tu cuenta" : undefined}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                unknown ? "border-amber-400 text-amber-800 dark:text-amber-300" : "border-border"
              }`}
            >
              {m}
              {!disabled && (
                <button type="button" aria-label={`Quitar ${m}`} onClick={() => toggle(m)} className="text-muted hover:text-foreground">
                  ×
                </button>
              )}
            </span>
          );
        })}
        {models.length === 0 && <span className="text-xs text-muted">Ninguno todavía.</span>}
      </div>
      {usingDefaults && <p className="text-[11px] text-muted">Son los de por defecto; cámbialos si tu cuenta tiene otros.</p>}
      <div className="flex flex-wrap gap-1">
        <input
          id={id}
          value={adding}
          placeholder="Nombre exacto del modelo"
          disabled={disabled}
          spellCheck={false}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className={`${inputClass} basis-full sm:basis-0`}
        />
        <button type="button" onClick={add} disabled={disabled || !adding.trim()} className={smallButton}>
          Añadir
        </button>
        <button type="button" onClick={load} disabled={disabled || loading} className={smallButton}>
          {loading ? "Cargando…" : "Ver modelos de tu cuenta"}
        </button>
      </div>
      {error && <p className="text-xs text-red-700 dark:text-red-300">{error}</p>}
      {available && available.length > 0 && (
        <div className="rounded-lg border border-border p-2">
          <div className="mb-1 flex items-center gap-2">
            <p className="text-xs text-muted">{available.length} modelos en tu cuenta. Marca los que quieras en el chat:</p>
            {available.length > 10 && (
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar…" className={`${inputClass} py-1 text-xs`} />
            )}
          </div>
          <ul className="scroll-thin grid max-h-48 gap-x-3 overflow-y-auto sm:grid-cols-2">
            {shown.map((m) => (
              <li key={m}>
                <label className="flex items-center gap-1.5 py-0.5 text-xs">
                  <input type="checkbox" checked={models.includes(m)} disabled={disabled} onChange={() => toggle(m)} />
                  <span className="truncate">{m}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const SEARXNG_DOT: Record<SearxngStatus["state"], string> = {
  running: "bg-emerald-500",
  starting: "animate-pulse bg-blue-500",
  stopped: "bg-slate-400",
  disabled: "bg-slate-400",
  down: "bg-amber-500",
  "no-docker": "bg-amber-500",
  "docker-off": "bg-amber-500",
  error: "bg-red-500",
};

function SearxngBox({
  status,
  editable,
  onStart,
  onCheck,
}: {
  status: SearxngStatus;
  editable: boolean;
  onStart: () => void;
  onCheck: () => void;
}) {
  return (
    <div className="mt-3 rounded-lg bg-black/5 px-3 py-2 text-xs dark:bg-white/5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${SEARXNG_DOT[status.state]}`} />
        <span className="min-w-0 flex-1">{status.message}</span>
        {status.canStart && editable && (
          <button type="button" onClick={onStart} className={smallButton}>
            Arrancar
          </button>
        )}
        {status.state !== "disabled" && (
          <button type="button" onClick={onCheck} className={smallButton}>
            Comprobar
          </button>
        )}
      </div>
      {status.state === "no-docker" && (
        <a href="https://docs.docker.com/get-started/get-docker/" target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-accent underline">
          Cómo instalar Docker
        </a>
      )}
    </div>
  );
}
