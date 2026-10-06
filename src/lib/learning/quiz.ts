import { distanceMeters, distanceToBoundsMeters, distanceToPathMeters } from "@/lib/geo/math";
import type { Bounds, DataSource, LatLng } from "@/lib/geo/types";

export type Difficulty = 1 | 2 | 3;

export interface MultipleChoiceQuestion {
  id: string;
  kind: "multiple_choice";
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
}

/** "¿Cuál de estas es la Avenida Bella Vista?": el usuario elige un elemento resaltado en el mapa. */
export interface IdentifyFeatureQuestion {
  id: string;
  kind: "identify_feature";
  prompt: string;
  /** ids de resaltados o marcadores que ya están en el mapa. */
  featureIds: string[];
  correctFeatureId: string;
  explanation?: string;
}

/** "Encuentra la Avenida 5 de Julio": el usuario hace clic en el mapa. */
export interface LocateQuestion {
  id: string;
  kind: "locate";
  prompt: string;
  target: {
    name: string;
    /** Vía, zona o marcador ya dibujado; su geometría se toma del mapa al corregir. */
    featureId?: string;
    position?: LatLng;
    path?: LatLng[];
    bounds?: Bounds;
    source: DataSource;
  };
  toleranceMeters: number;
  explanation?: string;
}

export type QuizQuestion = MultipleChoiceQuestion | IdentifyFeatureQuestion | LocateQuestion;

export interface Quiz {
  id: string;
  title: string;
  topicId: string;
  difficulty: Difficulty;
  questions: QuizQuestion[];
  /** Oculta los nombres del mapa base (vista satélite) mientras dura el quiz. */
  hideMapLabels: boolean;
}

export type QuizAnswer =
  | { kind: "multiple_choice"; optionIndex: number }
  | { kind: "identify_feature"; featureId: string }
  | { kind: "locate"; position: LatLng };

export interface GradeResult {
  correct: boolean;
  /** Para preguntas de ubicación: distancia del clic al objetivo. */
  distanceMeters?: number;
}

export type TargetGeometry = Pick<LocateQuestion["target"], "position" | "path" | "bounds">;

export function distanceToTarget(target: TargetGeometry, p: LatLng): number {
  if (target.path && target.path.length > 0) return distanceToPathMeters(p, target.path);
  if (target.bounds) return distanceToBoundsMeters(p, target.bounds);
  if (target.position) return distanceMeters(p, target.position);
  return Infinity;
}

/**
 * Corrige una respuesta. `featureGeometry` da la geometría completa de un elemento del mapa
 * (las preguntas "locate" sobre una vía resaltada se corrigen contra su trazado real).
 */
export function gradeAnswer(
  question: QuizQuestion,
  answer: QuizAnswer,
  featureGeometry?: (featureId: string) => TargetGeometry | undefined,
): GradeResult {
  if (question.kind === "multiple_choice" && answer.kind === "multiple_choice") {
    return { correct: answer.optionIndex === question.correctIndex };
  }
  if (question.kind === "identify_feature" && answer.kind === "identify_feature") {
    return { correct: answer.featureId === question.correctFeatureId };
  }
  if (question.kind === "locate" && answer.kind === "locate") {
    const geometry = question.target.featureId ? featureGeometry?.(question.target.featureId) : question.target;
    if (!geometry) return { correct: false };
    const d = distanceToTarget(geometry, answer.position);
    return { correct: d <= question.toleranceMeters, distanceMeters: Math.round(d) };
  }
  return { correct: false };
}

/** Letra anónima para el i-ésimo elemento de un quiz ("A", "B", …). */
export const anonLabel = (i: number) => String.fromCharCode(65 + (i % 26));
