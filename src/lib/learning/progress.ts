import type { Difficulty } from "./quiz";
import { CURRICULUM, findTopic } from "./curriculum";

/** Registro por tema, con los campos que pediste: topic, difficulty, attempts, correctAnswers, accuracy, lastStudied, mastery. */
export interface TopicProgress {
  topicId: string;
  difficulty: Difficulty;
  attempts: number;
  correctAnswers: number;
  /** 0..1 */
  accuracy: number;
  /** ISO 8601 */
  lastStudied: string;
  /** 0..100 */
  mastery: number;
}

export type ProgressState = Record<string, TopicProgress>;

export interface ProgressUpdate {
  topicId: string;
  /** Marca el tema como estudiado (por ejemplo tras una lección). */
  studied?: boolean;
  answers?: { correct: boolean }[];
  difficulty?: Difficulty;
}

const DIFFICULTY_WEIGHT: Record<Difficulty, number> = { 1: 0.85, 2: 0.95, 3: 1 };
const DAY_MS = 86_400_000;

/**
 * Dominio 0..100: precisión ponderada por la cantidad de intentos (pocos intentos = poca certeza)
 * y por la dificultad, con un olvido suave según el tiempo sin repasar.
 */
export function computeMastery(p: Omit<TopicProgress, "mastery">, now: Date): number {
  if (p.attempts === 0) return 0;
  const confidence = 1 - Math.exp(-p.attempts / 4);
  const days = Math.max(0, (now.getTime() - new Date(p.lastStudied).getTime()) / DAY_MS);
  const recency = Math.pow(0.98, days);
  return Math.round(100 * p.accuracy * confidence * DIFFICULTY_WEIGHT[p.difficulty] * recency);
}

export function applyProgressUpdate(state: ProgressState, update: ProgressUpdate, now = new Date()): ProgressState {
  const prev = state[update.topicId];
  const answers = update.answers ?? [];
  const attempts = (prev?.attempts ?? 0) + answers.length;
  const correctAnswers = (prev?.correctAnswers ?? 0) + answers.filter((a) => a.correct).length;
  const base = {
    topicId: update.topicId,
    difficulty: update.difficulty ?? prev?.difficulty ?? 1,
    attempts,
    correctAnswers,
    accuracy: attempts === 0 ? 0 : correctAnswers / attempts,
    lastStudied: now.toISOString(),
  };
  if (!prev && !update.studied && answers.length === 0) return state;
  return { ...state, [update.topicId]: { ...base, mastery: computeMastery(base, now) } };
}

export interface Recommendation {
  topicId: string;
  title: string;
  reason: string;
}

/**
 * Recomendaciones de aprendizaje: repasar lo débil o lo olvidado y avanzar
 * en orden por el programa (de lo general a Maracaibo).
 */
export function recommend(state: ProgressState, now = new Date(), limit = 3): Recommendation[] {
  const recs: Recommendation[] = [];
  const seen = new Set<string>();
  const push = (topicId: string, reason: string) => {
    if (seen.has(topicId) || recs.length >= limit) return;
    const topic = findTopic(topicId);
    if (!topic) return;
    seen.add(topicId);
    recs.push({ topicId, title: topic.topic.title, reason });
  };

  const studied = Object.values(state);
  for (const p of studied.filter((p) => p.attempts >= 3 && p.accuracy < 0.6).sort((a, b) => a.accuracy - b.accuracy)) {
    push(p.topicId, `Precisión baja (${Math.round(p.accuracy * 100)}%): conviene repasarlo.`);
  }
  for (const p of studied) {
    const days = (now.getTime() - new Date(p.lastStudied).getTime()) / DAY_MS;
    if (days > 7 && p.mastery < 80) push(p.topicId, `Hace ${Math.floor(days)} días que no lo repasas.`);
  }
  for (const level of CURRICULUM) {
    for (const topic of level.topics) {
      const p = state[topic.id];
      if (!p) push(topic.id, `Siguiente tema del programa (${level.title}).`);
      else if (p.mastery < 60 && p.attempts < 3) push(topic.id, "Empezado, pero falta practicarlo con un quiz.");
    }
  }
  return recs;
}

/** Resumen compacto para el agente. */
export function summarizeProgress(state: ProgressState) {
  return Object.values(state).map((p) => ({
    topicId: p.topicId,
    title: findTopic(p.topicId)?.topic.title ?? p.topicId,
    difficulty: p.difficulty,
    attempts: p.attempts,
    correctAnswers: p.correctAnswers,
    accuracy: Math.round(p.accuracy * 100) / 100,
    lastStudied: p.lastStudied,
    mastery: p.mastery,
  }));
}
