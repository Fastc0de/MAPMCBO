"use client";

import { useEffect, useRef, useState } from "react";
import type { ModelOption } from "@/lib/chat/models";
import type { SourceRef } from "@/lib/geo/types";
import { RichText } from "@/components/ui/RichText";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "note";
  text: string;
  sources?: SourceRef[];
  error?: string;
}

const SUGGESTIONS = [
  "Quiero aprender Maracaibo desde cero.",
  "Enséñame las avenidas principales de Maracaibo.",
  "Muéstrame los principales centros comerciales de Maracaibo.",
  "¿Dónde venden componentes electrónicos?",
  "¿Cómo puedo ir desde La Curva de Molina hasta el centro en transporte público?",
  "Quiero conocer lugares históricos de Maracaibo.",
];

interface Props {
  messages: ChatMessage[];
  busy: boolean;
  status: string | null;
  disabledReason?: string;
  onSend: (text: string) => void;
  onReset: () => void;
  /** Texto que otro panel pide poner en el cuadro de mensaje. */
  draft: string | null;
  onDraftConsumed: () => void;
  models: ModelOption[];
  modelId?: string;
  onSelectModel: (id: string) => void;
  /** Abre «Ajustes» para poner claves o elegir qué modelos aparecen. */
  onOpenSettings: () => void;
}

export function ChatPanel({
  messages,
  busy,
  status,
  disabledReason,
  onSend,
  onReset,
  draft,
  onDraftConsumed,
  models,
  modelId,
  onSelectModel,
  onOpenSettings,
}: Props) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  useEffect(() => {
    if (draft === null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- el borrador viene de otro panel
    setText(draft);
    onDraftConsumed();
    inputRef.current?.focus();
  }, [draft, onDraftConsumed]);

  const submit = (value: string) => {
    const v = value.trim();
    if (!v || busy || disabledReason) return;
    onSend(v);
    setText("");
  };

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Tutor e investigador</h2>
          <p className="text-xs text-muted">Habla con el mapa: busca, explica, traza y te pregunta.</p>
        </div>
        <button
          onClick={onReset}
          disabled={busy || messages.length === 0}
          className="shrink-0 whitespace-nowrap rounded-md border border-border px-2 py-1 text-xs text-muted hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/5"
        >
          Nueva conversación
        </button>
      </header>

      <div className="flex items-center gap-2 border-b border-border px-4 py-1.5 text-xs">
        <label htmlFor="chat-model" className="text-muted">
          Modelo
        </label>
        {models.length > 0 ? (
          <select
            id="chat-model"
            value={modelId}
            onChange={(e) => onSelectModel(e.target.value)}
            disabled={busy}
            className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-1.5 py-1"
          >
            {[...new Set(models.map((m) => m.providerLabel))].map((provider) => (
              <optgroup key={provider} label={provider}>
                {models
                  .filter((m) => m.providerLabel === provider)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                      {m.webSearch ? "" : " (sin búsqueda web)"}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        ) : (
          <span className="min-w-0 flex-1 text-muted">Ninguno configurado todavía.</span>
        )}
        <button
          type="button"
          onClick={onOpenSettings}
          title="Poner claves y elegir qué modelos aparecen aquí"
          className={`shrink-0 rounded-md border px-2 py-1 ${models.length > 0 ? "border-border text-muted hover:bg-black/5 dark:hover:bg-white/5" : "border-accent font-semibold text-accent"}`}
        >
          {models.length > 0 ? "Más modelos" : "Configurar"}
        </button>
      </div>

      <div ref={listRef} className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-muted">Prueba con algo como:</p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => submit(s)}
                disabled={busy || Boolean(disabledReason)}
                className="block w-full rounded-lg border border-border px-3 py-2 text-left hover:border-accent disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
            {m.role === "user" ? (
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-3 py-2 whitespace-pre-wrap text-white">{m.text}</div>
            ) : m.role === "note" ? (
              <div className="rounded-lg bg-black/5 px-3 py-2 text-xs text-muted dark:bg-white/5">{m.text}</div>
            ) : (
              <div className="max-w-full leading-relaxed">
                <RichText text={m.text} />
                {m.error && <p className="mt-1 rounded bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">{m.error}</p>}
                {m.sources && m.sources.length > 0 && (
                  <details className="mt-1 text-xs text-muted">
                    <summary className="cursor-pointer">Fuentes web ({m.sources.length})</summary>
                    <ul className="mt-1 space-y-0.5 pl-4">
                      {m.sources.map((s) => (
                        <li key={s.url}>
                          <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline">
                            {s.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <p className="flex items-center gap-2 text-xs text-muted">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
            {status ?? "Pensando…"}
          </p>
        )}
      </div>

      <form
        className="border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit(text);
        }}
      >
        {disabledReason && <p className="mb-2 text-xs text-amber-700 dark:text-amber-300">{disabledReason}</p>}
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(text);
              }
            }}
            rows={2}
            placeholder="Pregunta o pide algo sobre el mapa…"
            className="min-h-0 flex-1 resize-none rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={busy || !text.trim() || Boolean(disabledReason)}
            className="self-end rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Enviar
          </button>
        </div>
      </form>
    </section>
  );
}
