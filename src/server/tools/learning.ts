import { ALL_TOPIC_IDS, curriculumOutline, findTopic } from "@/lib/learning/curriculum";
import { recommend, summarizeProgress } from "@/lib/learning/progress";
import { anonLabel, type QuizQuestion } from "@/lib/learning/quiz";
import { z } from "zod";
import { focusBounds, pickGeocode, withCityHint, type ToolContext } from "./context";
import { defineTool } from "./tool";

const topicIdSchema = z.string().describe(`Id de tema del programa (get_curriculum). Ej: ${ALL_TOPIC_IDS.slice(0, 4).join(", ")}…`);

export const getCurriculum = defineTool({
  name: "get_curriculum",
  status: "Revisando el programa de aprendizaje…",
  description:
    "Devuelve el programa de aprendizaje (niveles I a IX, de 'qué es una calle' hasta moverse por Maracaibo sin mapa). " +
    "Con topicId devuelve los objetivos, el glosario y las actividades de ese tema.",
  schema: z.object({ topicId: z.string().optional() }),
  async run(input) {
    if (!input.topicId) return { levels: curriculumOutline() };
    const found = findTopic(input.topicId);
    if (!found) return { error: `Tema desconocido: ${input.topicId}`, levels: curriculumOutline() };
    return { level: found.level.title, ...found.topic };
  },
});

export const getLearningProgress = defineTool({
  name: "get_learning_progress",
  status: "Revisando tu progreso…",
  description: "Progreso del usuario por tema (intentos, aciertos, precisión, última vez, dominio) y recomendaciones de qué estudiar.",
  schema: z.object({}),
  async run(_input, ctx) {
    return { progress: summarizeProgress(ctx.progress), recommendations: recommend(ctx.progress) };
  },
});

export const saveLearningProgress = defineTool({
  name: "save_learning_progress",
  status: "Guardando tu progreso…",
  description:
    "Registra que el usuario estudió un tema (por ejemplo, tras una explicación). Los resultados de los quizzes se guardan solos.",
  schema: z.object({ topicId: topicIdSchema, difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional() }),
  async run(input, ctx) {
    if (!findTopic(input.topicId)) throw new Error(`Tema desconocido: ${input.topicId}`);
    ctx.emit({ type: "UPDATE_PROGRESS", update: { topicId: input.topicId, studied: true, difficulty: input.difficulty } });
    return { ok: true };
  },
});

export const createLesson = defineTool({
  name: "create_lesson",
  status: "Preparando la lección…",
  description:
    "Muestra una lección estructurada en el panel de aprendizaje. Escribe explicaciones claras y prácticas. " +
    "Cualquier lugar, vía o sector que menciones debe venir de Google o de fuentes web citadas; ubícalos en el mapa con otras herramientas.",
  schema: z.object({
    title: z.string().min(1),
    topicId: topicIdSchema.optional(),
    objectives: z.array(z.string()).max(6).default([]),
    sections: z.array(z.object({ heading: z.string(), body: z.string() })).min(1).max(8),
    glossary: z.array(z.object({ term: z.string(), definition: z.string() })).max(20).default([]),
    practice: z.string().optional().describe("Ejercicio sugerido sobre el mapa."),
  }),
  async run(input, ctx) {
    const found = input.topicId ? findTopic(input.topicId) : undefined;
    const id = ctx.newId("lesson");
    ctx.emit({
      type: "SHOW_LESSON",
      lesson: { id, ...input, topicId: found ? input.topicId : undefined, levelId: found?.level.id },
    });
    if (found) ctx.emit({ type: "UPDATE_PROGRESS", update: { topicId: found.topic.id, studied: true } });
    return { lessonId: id, shown: true };
  },
});

const questionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("multiple_choice"),
    prompt: z.string(),
    options: z.array(z.string()).min(2).max(6),
    correctIndex: z.number().int().min(0),
    explanation: z.string().optional(),
  }),
  z.object({
    kind: z.literal("identify_feature"),
    prompt: z.string().describe("Ej: '¿Cuál de estas es la Avenida Bella Vista?'"),
    featureIds: z.array(z.string()).min(2).max(8).describe("ids de vías/zonas resaltadas o marcadores que ya están en el mapa."),
    correctFeatureId: z.string(),
    explanation: z.string().optional(),
  }),
  z.object({
    kind: z.literal("locate"),
    prompt: z.string().describe("Ej: 'Encuentra la Avenida 5 de Julio' (el usuario hace clic en el mapa)."),
    target: z
      .object({
        featureId: z.string().optional().describe("Vía, zona o marcador ya dibujado (lo más preciso)."),
        placeId: z.string().optional(),
        address: z.string().optional().describe("Se geocodifica con Google."),
      })
      .describe("Indica uno."),
    toleranceMeters: z.number().int().min(20).max(5000).optional(),
    explanation: z.string().optional(),
  }),
]);

type QuestionInput = z.infer<typeof questionSchema>;

function knownFeatureName(ctx: ToolContext, id: string): string | undefined {
  const created = ctx.createdFeatures.get(id);
  if (created) return created.name;
  const h = ctx.mapContext.highlightedFeatures.find((f) => f.id === id);
  if (h) return h.name;
  return ctx.mapContext.visibleMarkers.find((m) => m.id === id)?.title;
}

async function resolveQuestion(ctx: ToolContext, q: QuestionInput, index: number): Promise<QuizQuestion> {
  const id = `q${index + 1}`;
  if (q.kind === "multiple_choice") {
    if (q.correctIndex >= q.options.length) throw new Error(`Pregunta ${index + 1}: correctIndex fuera de rango.`);
    return { id, ...q };
  }
  if (q.kind === "identify_feature") {
    const unknown = q.featureIds.filter((f) => !knownFeatureName(ctx, f));
    if (unknown.length) throw new Error(`Pregunta ${index + 1}: estos ids no están en el mapa: ${unknown.join(", ")}`);
    if (!q.featureIds.includes(q.correctFeatureId)) throw new Error(`Pregunta ${index + 1}: correctFeatureId debe estar en featureIds.`);
    return { id, ...q };
  }
  // locate
  const t = q.target;
  if (t.featureId) {
    const name = knownFeatureName(ctx, t.featureId);
    if (!name) throw new Error(`Pregunta ${index + 1}: el elemento ${t.featureId} no está en el mapa.`);
    const created = ctx.createdFeatures.get(t.featureId);
    const kind = created?.kind ?? ctx.mapContext.highlightedFeatures.find((f) => f.id === t.featureId)?.kind ?? "marker";
    return {
      id,
      kind: "locate",
      prompt: q.prompt,
      target: { name, featureId: t.featureId, source: "GOOGLE_MAPS_DATA" },
      toleranceMeters: q.toleranceMeters ?? (kind === "road" ? 150 : kind === "area" ? 250 : 300),
      explanation: q.explanation,
    };
  }
  if (t.placeId) {
    const p = ctx.knownPlaces.get(t.placeId) ?? (await ctx.providers.places.getDetails(t.placeId));
    return {
      id,
      kind: "locate",
      prompt: q.prompt,
      target: { name: p.name, position: p.position, source: "GOOGLE_MAPS_DATA" },
      toleranceMeters: q.toleranceMeters ?? 300,
      explanation: q.explanation,
    };
  }
  if (t.address) {
    const bounds = focusBounds(ctx);
    const { result } = pickGeocode(await ctx.providers.geocoding.geocode(withCityHint(t.address, ctx), { bounds }), bounds);
    if (!result) throw new Error(`Pregunta ${index + 1}: Google no encontró «${t.address}».`);
    const isArea = result.types.some((ty) => ["neighborhood", "sublocality", "sublocality_level_1", "locality"].includes(ty));
    return {
      id,
      kind: "locate",
      prompt: q.prompt,
      target: { name: t.address, position: result.position, bounds: isArea ? result.bounds ?? result.viewport : undefined, source: "GOOGLE_MAPS_DATA" },
      toleranceMeters: q.toleranceMeters ?? (isArea ? 200 : 300),
      explanation: q.explanation,
    };
  }
  throw new Error(`Pregunta ${index + 1}: target necesita featureId, placeId o address.`);
}

export const createQuiz = defineTool({
  name: "create_quiz",
  status: "Creando el ejercicio…",
  description:
    "Crea un quiz interactivo. Tipos: multiple_choice; identify_feature (elegir entre vías/zonas/marcadores ya resaltados, cuyos nombres se ocultan " +
    "automáticamente con letras); locate (el usuario hace clic en el mapa y se mide la distancia al objetivo real). " +
    "Primero dibuja en el mapa lo que vas a preguntar (highlight_road, highlight_area, search_places). Los resultados se guardan en el progreso.",
  schema: z.object({
    title: z.string(),
    topicId: topicIdSchema,
    difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
    hideMapLabels: z.boolean().default(false).describe("Cambia a satélite sin nombres durante el quiz (para reconocer zonas)."),
    questions: z.array(questionSchema).min(1).max(10),
  }),
  async run(input, ctx) {
    if (!findTopic(input.topicId)) throw new Error(`Tema desconocido: ${input.topicId}. Usa get_curriculum.`);
    const questions = [];
    for (const [i, q] of input.questions.entries()) questions.push(await resolveQuestion(ctx, q, i));

    // Oculta los nombres de los elementos por los que se pregunta.
    const featureIds = [...new Set(questions.flatMap((q) => (q.kind === "identify_feature" ? q.featureIds : [])))];
    if (featureIds.length) {
      ctx.emit({ type: "SET_FEATURE_LABELS", labels: Object.fromEntries(featureIds.map((f, i) => [f, anonLabel(i)])) });
    }
    const id = ctx.newId("quiz");
    ctx.emit({
      type: "START_QUIZ",
      quiz: { id, title: input.title, topicId: input.topicId, difficulty: input.difficulty, hideMapLabels: input.hideMapLabels, questions },
    });
    return { quizId: id, questions: questions.length, started: true };
  },
});
