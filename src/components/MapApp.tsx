"use client";

import { APIProvider } from "@vis.gl/react-google-maps";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ChatPanel, type ChatMessage } from "@/components/chat/ChatPanel";
import { LearningPanel, type LearningTab } from "@/components/learning/LearningPanel";
import { QuizRunner, type QuizSession } from "@/components/learning/QuizRunner";
import { MapView, type FeatureClick } from "@/components/map/MapView";
import { useIsDesktop } from "@/components/useIsDesktop";
import { LayerPanel } from "@/components/panels/LayerPanel";
import { SearchBar } from "@/components/panels/SearchBar";
import { SelectionPanel } from "@/components/panels/SelectionPanel";
import { transcriptHistory, type HistoryFormat, type ModelOption } from "@/lib/chat/models";
import { readEventStream } from "@/lib/chat/stream";
import { CITIES, DEFAULT_CITY, VENEZUELA } from "@/lib/cities";
import { distanceMeters } from "@/lib/geo/math";
import type { LatLng, PlaceSummary } from "@/lib/geo/types";
import type { Lesson } from "@/lib/learning/lesson";
import { applyProgressUpdate, type ProgressState } from "@/lib/learning/progress";
import { gradeAnswer, type Quiz, type QuizAnswer, type TargetGeometry } from "@/lib/learning/quiz";
import { isAppAction, type MapAction, type MapMarker, type UIAction } from "@/lib/map/actions";
import { defaultLayerVisibility, type LayerDefinition } from "@/lib/map/layers";
import { applyMapAction, buildMapContext, initialMapState, type CameraState, type MapState } from "@/lib/map/state";
import type { MissingConfig } from "@/lib/setup";
import { loadJSON, removeKey, saveJSON } from "@/lib/storage";

type InternalAction = MapAction | { type: "CAMERA"; camera: CameraState } | { type: "AREA"; area?: string };

function reducer(state: MapState, action: InternalAction): MapState {
  if (action.type === "CAMERA") return { ...state, camera: action.camera };
  if (action.type === "AREA") return { ...state, currentArea: action.area };
  return applyMapAction(state, action);
}

const PROGRESS_KEY = "mapmcbo.progress.v1";
const CHAT_KEY = "mapmcbo.chat.v1";
const MODEL_KEY = "mapmcbo.model.v1";

interface SavedChat {
  messages: ChatMessage[];
  history: unknown[];
  historyFormat?: HistoryFormat;
  conversationId?: string;
}

const newConversationId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

type MobilePanel = "chat" | "aprender" | "capas" | null;

let msgSeq = 0;
const msgId = () => `m${Date.now().toString(36)}${++msgSeq}`;

interface Props {
  browserKey: string;
  mapId: string;
  missing: MissingConfig[];
  models: ModelOption[];
}

export function MapApp({ browserKey, mapId, missing, models }: Props) {
  const [state, dispatch] = useReducer(reducer, undefined, () =>
    initialMapState({ center: DEFAULT_CITY.center, zoom: DEFAULT_CITY.zoom }),
  );
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const [layerVisibility, setLayerVisibility] = useState(defaultLayerVisibility);
  const [layerMarkers, setLayerMarkers] = useState<Record<string, MapMarker[]>>({});
  const [layerLoading, setLayerLoading] = useState<Record<string, boolean>>({});
  const [layerErrors, setLayerErrors] = useState<Record<string, string | undefined>>({});

  const [progress, setProgress] = useState<ProgressState>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<unknown[]>([]);
  const [historyFormat, setHistoryFormat] = useState<HistoryFormat | undefined>(undefined);
  const [conversationId, setConversationId] = useState<string>("");
  const [modelId, setModelId] = useState<string>(models[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);

  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [learningTab, setLearningTab] = useState<LearningTab>("programa");
  const [quiz, setQuiz] = useState<QuizSession | null>(null);
  const quizBaseMap = useRef<MapState["baseMap"] | null>(null);
  const [revealMarker, setRevealMarker] = useState<{ position: LatLng; title: string } | null>(null);
  const [sideTab, setSideTab] = useState<"aprender" | "capas">("aprender");
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const isDesktop = useIsDesktop();

  const serverMapsReady = !missing.some((m) => m.part === "google");
  const chatMissing = missing.filter((m) => m.part !== "map");
  const chatDisabledReason = chatMissing.length ? `Falta configurar: ${chatMissing.map((m) => m.text).join(", ")}.` : undefined;
  const selectedModel = models.find((m) => m.id === modelId) ?? models[0];

  /* ---------- Persistencia local (progreso y conversación) ---------- */
  useEffect(() => {
    // Se lee localStorage tras montar para no romper la hidratación.
    setProgress(loadJSON<ProgressState>(PROGRESS_KEY, {}));
    const saved = loadJSON<SavedChat | null>(CHAT_KEY, null);
    if (saved) {
      setMessages(saved.messages ?? []);
      setHistory(saved.history ?? []);
      // Las conversaciones de la primera versión solo podían venir de Claude.
      setHistoryFormat(saved.historyFormat ?? (saved.history?.length ? "anthropic" : undefined));
    }
    setConversationId(saved?.conversationId ?? newConversationId());
    const savedModel = loadJSON<string | null>(MODEL_KEY, null);
    if (savedModel && models.some((m) => m.id === savedModel)) setModelId(savedModel);
  }, [models]);
  useEffect(() => {
    saveJSON(PROGRESS_KEY, progress);
  }, [progress]);
  useEffect(() => {
    if (busy) return;
    const chat: SavedChat = { messages, history, historyFormat, conversationId };
    // Si el historial completo no cabe en localStorage, se guarda solo lo visible (el modelo lo recibe como texto).
    if (!saveJSON(CHAT_KEY, chat)) saveJSON(CHAT_KEY, { ...chat, history: [], historyFormat: undefined });
  }, [messages, history, historyFormat, conversationId, busy]);

  const selectModel = (id: string) => {
    setModelId(id);
    saveJSON(MODEL_KEY, id);
  };

  /* ---------- Acciones que llegan del agente ---------- */
  const startQuiz = useCallback((q: Quiz) => {
    if (q.hideMapLabels) {
      quizBaseMap.current = stateRef.current.baseMap;
      dispatch({ type: "SET_BASE_MAP", mode: "labels-hidden" });
    } else {
      quizBaseMap.current = null;
    }
    setRevealMarker(null);
    setQuiz({ quiz: q, index: 0, results: [], feedback: null, finished: false });
    setMobilePanel((p) => (p ? "aprender" : p));
    setSideTab("aprender");
  }, []);

  const applyUIAction = useCallback(
    (action: UIAction) => {
      if (!isAppAction(action)) {
        dispatch(action);
        return;
      }
      if (action.type === "SHOW_LESSON") {
        setLesson(action.lesson);
        setLearningTab("leccion");
        setSideTab("aprender");
      } else if (action.type === "START_QUIZ") {
        startQuiz(action.quiz);
      } else if (action.type === "UPDATE_PROGRESS") {
        setProgress((p) => applyProgressUpdate(p, action.update));
      }
    },
    [startQuiz],
  );

  /* ---------- Chat ---------- */
  const send = useCallback(
    async (text: string) => {
      const assistantId = msgId();
      setMessages((m) => [...m, { id: msgId(), role: "user", text }, { id: assistantId, role: "assistant", text: "" }]);
      setBusy(true);
      setStatus(null);
      setMobilePanel((p) => p ?? "chat");
      const patch = (fn: (m: ChatMessage) => ChatMessage) =>
        setMessages((list) => list.map((m) => (m.id === assistantId ? fn(m) : m)));
      // Al cambiar a un proveedor con otro formato de historial, el modelo nuevo recibe la conversación en texto.
      const format = selectedModel?.format;
      const sameFormat = history.length > 0 && historyFormat === format;
      const sentHistory = sameFormat
        ? history
        : transcriptHistory(messages.filter((m): m is ChatMessage & { role: "user" | "assistant" } => m.role !== "note"));
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            model: selectedModel?.id,
            history: sentHistory,
            historyFormat: format,
            conversationId,
            mapContext: buildMapContext(stateRef.current),
            progress,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          patch((m) => ({ ...m, error: data.error ?? `Error ${res.status}` }));
          return;
        }
        await readEventStream(res, (event) => {
          switch (event.type) {
            case "text":
              setStatus(null);
              patch((m) => ({ ...m, text: m.text + event.delta }));
              break;
            case "status":
              setStatus(event.text);
              break;
            case "action":
              applyUIAction(event.action);
              break;
            case "sources":
              patch((m) => ({ ...m, sources: event.sources }));
              break;
            case "error":
              patch((m) => ({ ...m, error: event.message }));
              break;
            case "done":
              setHistory(event.history);
              setHistoryFormat(event.format);
              break;
          }
        });
      } catch (e) {
        patch((m) => ({ ...m, error: e instanceof Error ? e.message : "Error de conexión" }));
      } finally {
        setBusy(false);
        setStatus(null);
      }
    },
    [history, historyFormat, messages, selectedModel, conversationId, progress, applyUIAction],
  );

  const resetChat = () => {
    setMessages([]);
    setHistory([]);
    setHistoryFormat(undefined);
    setConversationId(newConversationId());
    removeKey(CHAT_KEY);
  };

  const ask = useCallback((text: string) => {
    setDraft(text);
    setMobilePanel("chat");
  }, []);

  /* ---------- Cámara y zona actual ---------- */
  const lastAreaLookup = useRef<{ center: LatLng; at: number } | null>(null);
  const areaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCameraIdle = useCallback(
    (camera: CameraState) => {
      dispatch({ type: "CAMERA", camera });
      if (!serverMapsReady) return;
      if (camera.zoom < 12) {
        dispatch({ type: "AREA", area: undefined });
        return;
      }
      const last = lastAreaLookup.current;
      if (last && distanceMeters(last.center, camera.center) < 400) return;
      if (areaTimer.current) clearTimeout(areaTimer.current);
      areaTimer.current = setTimeout(async () => {
        lastAreaLookup.current = { center: camera.center, at: Date.now() };
        try {
          const res = await fetch(`/api/geocode/reverse?lat=${camera.center.lat}&lng=${camera.center.lng}`);
          if (res.ok) dispatch({ type: "AREA", area: (await res.json()).area });
        } catch {
          // La zona actual es un extra: si falla, el mapa sigue funcionando.
        }
      }, 900);
    },
    [serverMapsReady],
  );

  /* ---------- Capas de lugares ---------- */
  const toggleLayer = async (layer: LayerDefinition, visible: boolean) => {
    setLayerVisibility((v) => ({ ...v, [layer.id]: visible }));
    if (layer.kind !== "places") return;
    if (!visible) {
      setLayerMarkers((m) => ({ ...m, [layer.id]: [] }));
      setLayerErrors((e) => ({ ...e, [layer.id]: undefined }));
      return;
    }
    const cam = stateRef.current.camera;
    if (cam.zoom < 11) {
      setLayerErrors((e) => ({ ...e, [layer.id]: "Acércate a una ciudad para cargar esta capa." }));
      return;
    }
    const b = cam.bounds;
    const radius = b ? Math.min(50_000, distanceMeters({ lat: b.south, lng: b.west }, { lat: b.north, lng: b.east }) / 2) : 3000;
    setLayerLoading((l) => ({ ...l, [layer.id]: true }));
    setLayerErrors((e) => ({ ...e, [layer.id]: undefined }));
    try {
      const res = await fetch("/api/places/nearby", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ center: cam.center, radiusMeters: radius, includedTypes: layer.includedTypes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al cargar la capa");
      setLayerMarkers((m) => ({
        ...m,
        [layer.id]: (data.places as PlaceSummary[]).map((p) => ({
          id: `${layer.id}-${p.placeId}`,
          position: p.position,
          title: p.name,
          subtitle: p.address,
          placeId: p.placeId,
          layerId: layer.id,
          source: "GOOGLE_MAPS_DATA" as const,
        })),
      }));
    } catch (e) {
      setLayerErrors((er) => ({ ...er, [layer.id]: e instanceof Error ? e.message : "Error" }));
    } finally {
      setLayerLoading((l) => ({ ...l, [layer.id]: false }));
    }
  };

  /* ---------- Quiz ---------- */
  const featureGeometry = useCallback((id: string): TargetGeometry | undefined => {
    const s = stateRef.current;
    const h = s.highlights.find((x) => x.id === id);
    if (h) return { path: h.path, bounds: h.bounds };
    const m = s.markers.find((x) => x.id === id);
    return m ? { position: m.position } : undefined;
  }, []);

  const realName = (id: string) => {
    const s = stateRef.current;
    return s.highlights.find((h) => h.id === id)?.name ?? s.markers.find((m) => m.id === id)?.title ?? id;
  };

  const answerQuiz = (answer: QuizAnswer) => {
    if (!quiz || quiz.feedback || quiz.finished) return;
    const q = quiz.quiz.questions[quiz.index];
    const grade = gradeAnswer(q, answer, featureGeometry);
    let answerText = "";
    if (q.kind === "multiple_choice") answerText = `Respuesta correcta: ${q.options[q.correctIndex]}.`;
    if (q.kind === "identify_feature") answerText = `Era: ${realName(q.correctFeatureId)}.`;
    if (q.kind === "locate") {
      answerText = `Objetivo: ${q.target.name}.`;
      const geo = q.target.featureId ? featureGeometry(q.target.featureId) : q.target;
      const pos = geo?.position ?? geo?.path?.[Math.floor((geo.path.length - 1) / 2)] ?? (geo?.bounds ? { lat: (geo.bounds.south + geo.bounds.north) / 2, lng: (geo.bounds.west + geo.bounds.east) / 2 } : undefined);
      if (pos) setRevealMarker({ position: pos, title: q.target.name });
    }
    setQuiz({
      ...quiz,
      results: [...quiz.results, { questionId: q.id, correct: grade.correct, distanceMeters: grade.distanceMeters }],
      feedback: { correct: grade.correct, distanceMeters: grade.distanceMeters, explanation: q.explanation, answerText },
    });
  };

  const finishQuiz = (session: QuizSession) => {
    if (session.results.length > 0) {
      setProgress((p) =>
        applyProgressUpdate(p, {
          topicId: session.quiz.topicId,
          difficulty: session.quiz.difficulty,
          answers: session.results.map((r) => ({ correct: r.correct })),
        }),
      );
      const correct = session.results.filter((r) => r.correct).length;
      setMessages((m) => [
        ...m,
        { id: msgId(), role: "note", text: `Quiz «${session.quiz.title}»: ${correct} de ${session.results.length} correctas. Guardado en tu progreso.` },
      ]);
    }
    const ids = [...new Set(session.quiz.questions.flatMap((q) => (q.kind === "identify_feature" ? q.featureIds : [])))];
    if (ids.length) dispatch({ type: "SET_FEATURE_LABELS", labels: Object.fromEntries(ids.map((id) => [id, null])) });
    if (quizBaseMap.current) dispatch({ type: "SET_BASE_MAP", mode: quizBaseMap.current });
    quizBaseMap.current = null;
    setRevealMarker(null);
  };

  const nextQuestion = () => {
    if (!quiz) return;
    setRevealMarker(null);
    if (quiz.index + 1 < quiz.quiz.questions.length) {
      setQuiz({ ...quiz, index: quiz.index + 1, feedback: null });
    } else {
      setQuiz({ ...quiz, finished: true, feedback: null });
      finishQuiz(quiz);
    }
  };

  const closeQuiz = () => {
    if (quiz && !quiz.finished) finishQuiz(quiz);
    setQuiz(null);
  };

  const currentQuestion = quiz && !quiz.finished && !quiz.feedback ? quiz.quiz.questions[quiz.index] : null;

  /* ---------- Clics en el mapa ---------- */
  const onMapClick = (position: LatLng, placeId: string | null) => {
    if (currentQuestion?.kind === "locate") {
      answerQuiz({ kind: "locate", position });
      return;
    }
    if (quiz && !quiz.finished) return;
    if (placeId) dispatch({ type: "SELECT", selection: { kind: "place", placeId, name: "Lugar de Google Maps", position } });
    else dispatch({ type: "SELECT", selection: { kind: "point", position } });
  };

  const onFeatureClick = (f: FeatureClick) => {
    if (currentQuestion?.kind === "identify_feature") {
      const id = f.kind === "marker" ? f.marker.id : f.kind === "highlight" ? f.highlight.id : null;
      if (id && currentQuestion.featureIds.includes(id)) answerQuiz({ kind: "identify_feature", featureId: id });
      return;
    }
    if (currentQuestion?.kind === "locate") return;
    if (f.kind === "marker") {
      dispatch({ type: "SELECT", selection: { kind: "marker", id: f.marker.id, name: f.marker.title, position: f.marker.position, placeId: f.marker.placeId } });
    } else if (f.kind === "highlight") {
      dispatch({ type: "SELECT", selection: { kind: f.highlight.kind, id: f.highlight.id, name: f.highlight.name } });
    } else {
      dispatch({ type: "SELECT", selection: { kind: f.kind, id: f.id, name: f.label } });
    }
  };

  /* ---------- Buscador ---------- */
  const onSearchResults = (places: PlaceSummary[]) => {
    dispatch({ type: "REMOVE_MARKERS", layerId: "search" });
    if (places.length === 0) return;
    dispatch({
      type: "ADD_MARKERS",
      fit: true,
      markers: places.map((p) => ({
        id: `search-${p.placeId}`,
        position: p.position,
        title: p.name,
        subtitle: p.address,
        placeId: p.placeId,
        layerId: "search",
        source: "GOOGLE_MAPS_DATA",
      })),
    });
  };
  const onSearchPick = (p: PlaceSummary) => {
    dispatch({ type: "SELECT", selection: { kind: "marker", id: `search-${p.placeId}`, name: p.name, position: p.position, placeId: p.placeId } });
    dispatch({ type: "SET_CENTER", center: p.position, zoom: 16 });
  };

  /* ---------- Render ---------- */
  const quizNode = quiz ? (
    <QuizRunner session={quiz} state={state} onAnswer={answerQuiz} onNext={nextQuestion} onClose={closeQuiz} />
  ) : undefined;

  const learning = (
    <LearningPanel progress={progress} lesson={lesson} onAsk={ask} quiz={quizNode} tab={learningTab} onTab={setLearningTab} />
  );
  const layers = (
    <div className="scroll-thin h-full overflow-y-auto p-4">
      <LayerPanel
        visibility={layerVisibility}
        loading={layerLoading}
        errors={layerErrors}
        baseMap={state.baseMap}
        onToggle={toggleLayer}
        onBaseMap={(mode) => dispatch({ type: "SET_BASE_MAP", mode })}
      />
    </div>
  );
  const chat = (
    <ChatPanel
      messages={messages}
      busy={busy}
      status={status}
      disabledReason={chatDisabledReason}
      onSend={send}
      onReset={resetChat}
      draft={draft}
      onDraftConsumed={() => setDraft(null)}
      models={models}
      modelId={selectedModel?.id}
      onSelectModel={selectModel}
    />
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-panel px-4 py-2">
        <h1 className="text-sm font-bold sm:text-base">Mapa de Maracaibo</h1>
        <span className="hidden text-xs text-muted sm:inline">Aprende a orientarte y a conocer tu ciudad</span>
        <div className="ml-auto flex items-center gap-1">
          <select
            aria-label="Ciudad"
            className="rounded-md border border-border bg-panel px-2 py-1 text-xs"
            defaultValue=""
            onChange={(e) => {
              const city = CITIES.find((c) => c.id === e.target.value);
              if (city) dispatch({ type: "SET_CENTER", center: city.center, zoom: city.zoom });
              e.target.value = "";
            }}
          >
            <option value="" disabled>
              Ir a ciudad…
            </option>
            {CITIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button onClick={() => dispatch({ type: "FIT_BOUNDS", bounds: VENEZUELA.bounds })} className="rounded-md border border-border px-2 py-1 text-xs">
            Venezuela
          </button>
        </div>
      </header>

      {missing.length > 0 && (
        <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          Falta configuración en el servidor: {missing.map((m) => m.text).join(" · ")}. Mira el README para saber dónde ponerla.
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {isDesktop && (
        <aside className="flex w-80 shrink-0 flex-col border-r border-border bg-panel">
          <nav className="flex border-b border-border">
            {(["aprender", "capas"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setSideTab(t)}
                className={`flex-1 py-2 text-xs font-semibold capitalize ${sideTab === t ? "border-b-2 border-accent text-accent" : "text-muted"}`}
              >
                {t === "aprender" ? "Aprender" : "Capas"}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1">{sideTab === "aprender" ? learning : layers}</div>
        </aside>
        )}

        <main className="relative min-w-0 flex-1">
          {browserKey ? (
            <APIProvider apiKey={browserKey} language="es" region="VE">
              <MapView
                mapId={mapId}
                state={state}
                layerVisibility={layerVisibility}
                layerMarkers={Object.values(layerMarkers).flat()}
                pickingPoint={currentQuestion?.kind === "locate"}
                onCameraIdle={onCameraIdle}
                onMapClick={onMapClick}
                onFeatureClick={onFeatureClick}
                revealMarker={revealMarker}
              />
            </APIProvider>
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted">
              <p>
                El mapa necesita la variable <code>GOOGLE_MAPS_BROWSER_API_KEY</code>.<br />
                Mientras tanto puedes ver el programa de aprendizaje y el glosario.
              </p>
            </div>
          )}

          <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-col gap-2 sm:right-auto sm:w-96">
            <div className="pointer-events-auto">
              <SearchBar bounds={state.camera.bounds} center={state.camera.center} onResults={onSearchResults} onPick={onSearchPick} />
            </div>
            {state.currentArea && (
              <div className="pointer-events-auto self-start rounded-full border border-border bg-panel/95 px-3 py-1 text-xs shadow">
                Estás viendo: <strong>{state.currentArea}</strong>
              </div>
            )}
            {currentQuestion && !isDesktop && mobilePanel !== "aprender" && (
              <div className="pointer-events-auto rounded-xl border border-accent bg-panel p-3 text-sm shadow-lg">
                <p className="font-medium">{currentQuestion.prompt}</p>
                <button onClick={() => setMobilePanel("aprender")} className="mt-1 text-xs text-accent underline">
                  Ver quiz
                </button>
              </div>
            )}
          </div>

          {state.selection && (
            <div className={`absolute left-3 right-3 sm:right-auto sm:w-96 ${isDesktop ? "bottom-6" : mobilePanel ? "hidden" : "bottom-20"}`}>
              <SelectionPanel state={state} quizActive={Boolean(quiz && !quiz.finished)} onAsk={ask} onClose={() => dispatch({ type: "SELECT", selection: null })} />
            </div>
          )}

          {(state.markers.length > 0 || state.routes.length > 0 || state.highlights.length > 0 || state.transitRoutes.length > 0) && (
            <button
              onClick={() => dispatch({ type: "CLEAR_ALL" })}
              className="absolute right-3 top-3 hidden rounded-md border border-border bg-panel px-2 py-1 text-xs shadow sm:block"
            >
              Limpiar mapa
            </button>
          )}

          {/* Paneles en móvil */}
          {!isDesktop && mobilePanel && (
            <div className="absolute inset-x-0 bottom-14 z-10 h-[60%] rounded-t-2xl border-t border-border bg-panel shadow-2xl">
              {mobilePanel === "chat" ? chat : mobilePanel === "aprender" ? learning : layers}
            </div>
          )}
          {!isDesktop && (
          <nav className="absolute inset-x-0 bottom-0 z-20 flex h-14 border-t border-border bg-panel">
            {(
              [
                ["chat", "Tutor"],
                ["aprender", "Aprender"],
                ["capas", "Capas"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setMobilePanel((p) => (p === id ? null : id))}
                className={`flex-1 text-xs font-semibold ${mobilePanel === id ? "text-accent" : "text-muted"}`}
              >
                {label}
              </button>
            ))}
          </nav>
          )}
        </main>

        {isDesktop && <aside className="w-[400px] shrink-0 border-l border-border bg-panel">{chat}</aside>}
      </div>
    </div>
  );
}
