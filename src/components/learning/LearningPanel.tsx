"use client";

import { useMemo, useState } from "react";
import { CURRICULUM } from "@/lib/learning/curriculum";
import type { Lesson } from "@/lib/learning/lesson";
import { recommend, type ProgressState } from "@/lib/learning/progress";
import { RichText } from "@/components/ui/RichText";

type Tab = "programa" | "glosario" | "progreso" | "leccion";

interface Props {
  progress: ProgressState;
  lesson: Lesson | null;
  onAsk: (text: string) => void;
  /** Contenido del quiz activo (si hay); ocupa el panel mientras dura. */
  quiz?: React.ReactNode;
  tab: Tab;
  onTab: (tab: Tab) => void;
}

export type { Tab as LearningTab };

export function LearningPanel({ progress, lesson, onAsk, quiz, tab, onTab }: Props) {
  if (quiz) return <div className="p-4">{quiz}</div>;
  const tabs: [Tab, string][] = [
    ["programa", "Programa"],
    ["glosario", "Glosario"],
    ["progreso", "Progreso"],
  ];
  if (lesson) tabs.push(["leccion", "Lección"]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav className="flex gap-1 border-b border-border px-3 pt-2">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            onClick={() => onTab(id)}
            className={`rounded-t-md px-3 py-1.5 text-xs font-medium ${tab === id ? "bg-accent text-white" : "text-muted hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4 text-sm">
        {tab === "programa" && <Curriculum progress={progress} onAsk={onAsk} />}
        {tab === "glosario" && <Glossary />}
        {tab === "progreso" && <Progress progress={progress} onAsk={onAsk} />}
        {tab === "leccion" && lesson && <LessonView lesson={lesson} onAsk={onAsk} />}
      </div>
    </div>
  );
}

function MasteryBar({ value }: { value: number }) {
  return (
    <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-black/10 align-middle dark:bg-white/10">
      <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${value}%` }} />
    </span>
  );
}

function Curriculum({ progress, onAsk }: { progress: ProgressState; onAsk: (t: string) => void }) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">De «¿qué es una calle?» a moverte por Maracaibo sin depender del mapa. Toca un tema para que el tutor te lo enseñe.</p>
      {CURRICULUM.map((level) => (
        <div key={level.id}>
          <h3 className="font-semibold">{level.title}</h3>
          <p className="mb-1 text-xs text-muted">{level.summary}</p>
          <ul className="space-y-1">
            {level.topics.map((t) => {
              const p = progress[t.id];
              return (
                <li key={t.id}>
                  <button
                    onClick={() => onAsk(`Enséñame el tema «${t.title}» (${t.id}) sobre el mapa.`)}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <span>{t.title}</span>
                    {p ? <MasteryBar value={p.mastery} /> : <span className="text-xs text-muted">nuevo</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Glossary() {
  const [filter, setFilter] = useState("");
  const terms = useMemo(
    () =>
      CURRICULUM.flatMap((l) => l.topics.flatMap((t) => (t.glossary ?? []).map((g) => ({ ...g, topic: t.title })))).sort((a, b) =>
        a.term.localeCompare(b.term, "es"),
      ),
    [],
  );
  const f = filter.toLowerCase();
  const shown = terms.filter((t) => !f || t.term.toLowerCase().includes(f) || t.definition.toLowerCase().includes(f));
  return (
    <div className="space-y-2">
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Buscar en el glosario…"
        className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm outline-none focus:border-accent"
      />
      <dl className="space-y-2">
        {shown.map((t) => (
          <div key={`${t.topic}-${t.term}`}>
            <dt className="font-semibold">{t.term}</dt>
            <dd className="text-muted">{t.definition}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Progress({ progress, onAsk }: { progress: ProgressState; onAsk: (t: string) => void }) {
  const entries = Object.values(progress).sort((a, b) => b.lastStudied.localeCompare(a.lastStudied));
  const recs = recommend(progress);
  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-1 font-semibold">Recomendado ahora</h3>
        <ul className="space-y-1">
          {recs.map((r) => (
            <li key={r.topicId}>
              <button onClick={() => onAsk(`Enséñame el tema «${r.title}» (${r.topicId}).`)} className="w-full rounded-md border border-border px-2 py-1.5 text-left hover:border-accent">
                <span className="block font-medium">{r.title}</span>
                <span className="block text-xs text-muted">{r.reason}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="mb-1 font-semibold">Temas estudiados</h3>
        {entries.length === 0 && <p className="text-muted">Todavía nada. Empieza por el programa o pide «Quiero aprender Maracaibo desde cero».</p>}
        <table className="w-full text-xs">
          {entries.length > 0 && (
            <thead className="text-left text-muted">
              <tr>
                <th className="py-1 font-normal">Tema</th>
                <th className="font-normal">Aciertos</th>
                <th className="font-normal">Dominio</th>
              </tr>
            </thead>
          )}
          <tbody>
            {entries.map((p) => (
              <tr key={p.topicId} className="border-t border-border">
                <td className="py-1">{CURRICULUM.flatMap((l) => l.topics).find((t) => t.id === p.topicId)?.title ?? p.topicId}</td>
                <td>
                  {p.correctAnswers}/{p.attempts}
                </td>
                <td>
                  <MasteryBar value={p.mastery} /> {p.mastery}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LessonView({ lesson, onAsk }: { lesson: Lesson; onAsk: (t: string) => void }) {
  return (
    <article className="space-y-3">
      <h3 className="text-base font-semibold">{lesson.title}</h3>
      {lesson.objectives.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Objetivos</p>
          <ul className="list-disc pl-5">
            {lesson.objectives.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </div>
      )}
      {lesson.sections.map((s) => (
        <section key={s.heading}>
          <h4 className="font-semibold">{s.heading}</h4>
          <RichText text={s.body} />
        </section>
      ))}
      {lesson.glossary.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Glosario</p>
          <dl className="space-y-1">
            {lesson.glossary.map((g) => (
              <div key={g.term}>
                <dt className="inline font-semibold">{g.term}: </dt>
                <dd className="inline text-muted">{g.definition}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {lesson.practice && (
        <div className="rounded-lg bg-black/5 p-3 dark:bg-white/5">
          <p className="text-xs font-semibold">Práctica</p>
          <p>{lesson.practice}</p>
        </div>
      )}
      <button onClick={() => onAsk("Ahora quiero practicar lo de esta lección.")} className="rounded-md bg-accent px-3 py-1.5 text-white">
        Practicar con un quiz
      </button>
    </article>
  );
}
