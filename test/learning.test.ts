import { describe, expect, it } from "vitest";
import { ALL_TOPIC_IDS, CURRICULUM, findTopic } from "@/lib/learning/curriculum";
import { applyProgressUpdate, computeMastery, recommend } from "@/lib/learning/progress";
import { gradeAnswer, type LocateQuestion } from "@/lib/learning/quiz";

describe("programa", () => {
  it("tiene ids únicos y empieza por el lenguaje urbano", () => {
    expect(new Set(ALL_TOPIC_IDS).size).toBe(ALL_TOPIC_IDS.length);
    expect(CURRICULUM[0].id).toBe("lenguaje-urbano");
    expect(findTopic("intersecciones")?.topic.glossary?.some((g) => g.term === "Redoma")).toBe(true);
  });

  it("los temas de Maracaibo no traen nombres de vías escritos a mano", () => {
    const mcbo = CURRICULUM.flatMap((l) => l.topics).filter((t) => t.scope === "maracaibo");
    expect(mcbo.length).toBeGreaterThan(5);
    for (const t of mcbo) expect(t.glossary).toBeUndefined();
  });
});

describe("progreso", () => {
  const now = new Date("2026-10-06T12:00:00Z");

  it("acumula intentos, aciertos y precisión", () => {
    let p = applyProgressUpdate({}, { topicId: "tipos-de-vias", answers: [{ correct: true }, { correct: false }] }, now);
    p = applyProgressUpdate(p, { topicId: "tipos-de-vias", answers: [{ correct: true }, { correct: true }], difficulty: 2 }, now);
    expect(p["tipos-de-vias"]).toMatchObject({ attempts: 4, correctAnswers: 3, accuracy: 0.75, difficulty: 2, lastStudied: now.toISOString() });
    expect(p["tipos-de-vias"].mastery).toBeGreaterThan(0);
    expect(p["tipos-de-vias"].mastery).toBeLessThan(75);
  });

  it("marcar como estudiado crea el registro con dominio 0", () => {
    const p = applyProgressUpdate({}, { topicId: "intersecciones", studied: true }, now);
    expect(p.intersecciones).toMatchObject({ attempts: 0, mastery: 0 });
  });

  it("el dominio crece con los intentos y baja con el tiempo", () => {
    const base = { topicId: "x", difficulty: 3 as const, accuracy: 1, correctAnswers: 0, lastStudied: now.toISOString() };
    expect(computeMastery({ ...base, attempts: 2 }, now)).toBeLessThan(computeMastery({ ...base, attempts: 12 }, now));
    const later = new Date(now.getTime() + 30 * 86_400_000);
    expect(computeMastery({ ...base, attempts: 12 }, later)).toBeLessThan(computeMastery({ ...base, attempts: 12 }, now));
  });

  it("recomienda repasar lo débil antes que avanzar", () => {
    const p = applyProgressUpdate({}, { topicId: "semaforos", answers: [{ correct: false }, { correct: false }, { correct: true }] }, now);
    const recs = recommend(p, now);
    expect(recs[0].topicId).toBe("semaforos");
    expect(recs).toHaveLength(3);
    expect(recs[1].topicId).toBe("tipos-de-vias");
  });
});

describe("corrección de quizzes", () => {
  it("opción múltiple e identificación", () => {
    expect(gradeAnswer({ id: "1", kind: "multiple_choice", prompt: "", options: ["a", "b"], correctIndex: 1 }, { kind: "multiple_choice", optionIndex: 1 }).correct).toBe(true);
    expect(
      gradeAnswer({ id: "2", kind: "identify_feature", prompt: "", featureIds: ["x", "y"], correctFeatureId: "y" }, { kind: "identify_feature", featureId: "x" }).correct,
    ).toBe(false);
  });

  it("ubicar: mide contra la geometría completa de la vía", () => {
    const q: LocateQuestion = {
      id: "3",
      kind: "locate",
      prompt: "Encuentra la avenida",
      target: { name: "Av", featureId: "road-1", source: "GOOGLE_MAPS_DATA" },
      toleranceMeters: 150,
    };
    const geometry = () => ({
      path: [
        { lat: 10.6, lng: -71.7 },
        { lat: 10.6, lng: -71.6 },
      ],
    });
    const near = gradeAnswer(q, { kind: "locate", position: { lat: 10.6005, lng: -71.65 } }, geometry);
    expect(near.correct).toBe(true);
    const far = gradeAnswer(q, { kind: "locate", position: { lat: 10.61, lng: -71.65 } }, geometry);
    expect(far.correct).toBe(false);
    expect(far.distanceMeters).toBeGreaterThan(1000);
    // Sin geometría disponible no se da por buena.
    expect(gradeAnswer(q, { kind: "locate", position: { lat: 10.6, lng: -71.65 } }, () => undefined).correct).toBe(false);
  });
});
