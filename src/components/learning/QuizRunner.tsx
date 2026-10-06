"use client";

import type { MapState } from "@/lib/map/state";
import type { Quiz, QuizAnswer } from "@/lib/learning/quiz";

export interface QuizSession {
  quiz: Quiz;
  index: number;
  results: { questionId: string; correct: boolean; distanceMeters?: number }[];
  feedback: { correct: boolean; distanceMeters?: number; explanation?: string; answerText: string } | null;
  finished: boolean;
}

interface Props {
  session: QuizSession;
  state: MapState;
  onAnswer: (answer: QuizAnswer) => void;
  onNext: () => void;
  onClose: () => void;
}

const DIFFICULTY = { 1: "Fácil", 2: "Media", 3: "Difícil" } as const;

export function QuizRunner({ session, state, onAnswer, onNext, onClose }: Props) {
  const { quiz, index, feedback, finished, results } = session;
  const correct = results.filter((r) => r.correct).length;

  if (finished) {
    return (
      <div className="space-y-3 text-sm">
        <h3 className="font-semibold">{quiz.title}</h3>
        <p className="text-2xl font-bold">
          {correct} / {results.length}
        </p>
        <p className="text-muted">Resultado guardado en tu progreso. Pide al tutor otro ejercicio o repasa lo que fallaste.</p>
        <button onClick={onClose} className="rounded-md bg-accent px-3 py-1.5 text-white">
          Cerrar quiz
        </button>
      </div>
    );
  }

  const q = quiz.questions[index];
  const featureName = (id: string) => {
    const h = state.highlights.find((x) => x.id === id);
    if (h) return h.label;
    const m = state.markers.find((x) => x.id === id);
    return m?.quizLabel ?? m?.title ?? id;
  };

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          {quiz.title} · {DIFFICULTY[quiz.difficulty]}
        </span>
        <span>
          Pregunta {index + 1} de {quiz.questions.length}
        </span>
      </div>
      <p className="font-medium">{q.prompt}</p>

      {q.kind === "multiple_choice" && (
        <div className="space-y-1">
          {q.options.map((opt, i) => (
            <button
              key={i}
              disabled={Boolean(feedback)}
              onClick={() => onAnswer({ kind: "multiple_choice", optionIndex: i })}
              className={`block w-full rounded-lg border px-3 py-2 text-left disabled:cursor-default ${
                feedback && i === q.correctIndex ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950" : "border-border hover:border-accent"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {q.kind === "identify_feature" && (
        <div className="space-y-1">
          <p className="text-xs text-muted">Toca el elemento en el mapa o elige aquí:</p>
          <div className="flex flex-wrap gap-1">
            {q.featureIds.map((id) => (
              <button
                key={id}
                disabled={Boolean(feedback)}
                onClick={() => onAnswer({ kind: "identify_feature", featureId: id })}
                className={`rounded-lg border px-3 py-1.5 ${
                  feedback && id === q.correctFeatureId ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950" : "border-border hover:border-accent"
                }`}
              >
                {featureName(id)}
              </button>
            ))}
          </div>
        </div>
      )}

      {q.kind === "locate" && !feedback && (
        <p className="rounded-lg border border-dashed border-accent px-3 py-2 text-accent">Haz clic en el mapa donde creas que está.</p>
      )}

      {feedback && (
        <div
          className={`rounded-lg px-3 py-2 ${
            feedback.correct ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100" : "bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100"
          }`}
        >
          <p className="font-semibold">{feedback.correct ? "¡Correcto!" : "No es correcto."}</p>
          <p className="text-xs">{feedback.answerText}</p>
          {feedback.distanceMeters !== undefined && (
            <p className="text-xs">Tu clic quedó a {feedback.distanceMeters >= 1000 ? `${(feedback.distanceMeters / 1000).toFixed(1)} km` : `${feedback.distanceMeters} m`} del objetivo.</p>
          )}
          {feedback.explanation && <p className="mt-1 text-xs">{feedback.explanation}</p>}
        </div>
      )}

      <div className="flex justify-between">
        <button onClick={onClose} className="text-xs text-muted">
          Salir
        </button>
        {feedback && (
          <button onClick={onNext} className="rounded-md bg-accent px-3 py-1.5 text-white">
            {index + 1 < quiz.questions.length ? "Siguiente" : "Ver resultado"}
          </button>
        )}
      </div>
    </div>
  );
}
