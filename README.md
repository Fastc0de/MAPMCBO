# Mapa de Maracaibo

Un Google Maps con tutor personal de geografía y agente de investigación local, para aprender a orientarse en Venezuela empezando por Maracaibo.

- **Mapa grande** de Google Maps centrado en Maracaibo, con toda Venezuela disponible (selector de ciudad y botón «Venezuela»).
- **Chatbot al lado** que controla el mapa (eliges el modelo: Gemini, OpenCode Go, Claude u otro compatible con OpenAI): busca lugares, los marca, traza rutas, resalta avenidas y sectores, explica dónde está cada cosa y te hace preguntas sobre el propio mapa.
- **Modo aprendizaje** con el programa completo (de «¿qué es una calle?» al dominio de la ciudad), glosario, lecciones sobre el mapa, quizzes y progreso guardado en tu navegador.
- **Capas**: lugares del asistente, avenidas resaltadas, sectores, rutas, transporte reconstruido desde la web, y capas de Google Places (restaurantes, centros comerciales, hospitales, universidades, farmacias, supermercados, lugares históricos, parques), transporte y tráfico de Google.

La regla central: **la app nunca inventa geografía**. Toda coordenada, calle, ruta o negocio viene de Google Maps o de una fuente web citada. Cada dato lleva su origen, como etiqueta de color en el chat y como campo `source` en los datos del mapa:

| En el chat | En los datos | Significa |
|---|---|---|
| Google Maps | `GOOGLE_MAPS_DATA` | Dato verificado por una API de Google Maps Platform |
| Web | `WEB_DATA` | Información encontrada en la web, con enlace a la fuente |
| Inferencia | `MODEL_INFERENCE` | Explicación o deducción del modelo, nunca un dato del mapa |

## Puesta en marcha

Requisitos: Node.js 20.9 o superior.

```bash
npm install
npm run dev                  # http://localhost:3000
```

Abre http://localhost:3000, pulsa **Ajustes** (arriba a la derecha) y pega tus claves: se guardan en `.env.local` y se usan al momento, sin reiniciar. Si tienes [Docker](https://docs.docker.com/get-started/get-docker/) instalado y abierto, la app arranca sola el buscador web (SearXNG).

Sin claves la app arranca igual: verás el programa de aprendizaje y el glosario, y un aviso arriba con lo que falta configurar.

## Claves de API

Las claves van **solo** en `.env.local` (o en las variables de entorno de tu hosting). Ese archivo está en `.gitignore`: no se sube nunca al repositorio.

**Desde la app**: el botón **Ajustes** tiene un apartado por proveedor (Google Maps, Gemini, OpenCode Go, Claude, otro compatible con OpenAI y búsqueda web). Lo que guardes ahí se escribe en `.env.local` y se aplica sin reiniciar. Las claves nunca vuelven al navegador: solo se ve si están puestas y sus últimos 4 caracteres. Por seguridad, los ajustes solo se pueden ver y cambiar abriendo la app en el mismo PC (`http://localhost:3000`); desde el móvil u otro aparato de la red salen en solo lectura, y una web cualquiera abierta en tu navegador no puede leerlos ni cambiarlos. En un servidor público, desactívalos con `SETTINGS_UI=off` y usa variables de entorno.

**A mano**: copia `.env.example` como `.env.local`; tiene todas las variables comentadas.

Lo mínimo para usarlo todo: **una clave de Google Maps** y **una clave de algún modelo** para el chat.

### Google Maps

| Variable | Para qué |
|---|---|
| `GOOGLE_MAPS_API_KEY` | Una sola clave para todo: el mapa (Maps JavaScript API) y las búsquedas desde el servidor (Places API (New), Geocoding API v4, Routes API) |
| `GOOGLE_MAPS_BROWSER_API_KEY` / `GOOGLE_MAPS_SERVER_API_KEY` | Opcional: claves separadas para el navegador y el servidor; tienen prioridad sobre la anterior |
| `GOOGLE_MAPS_MAP_ID` | Opcional: tu Map ID; si no hay, se usa `DEMO_MAP_ID` |

**Para empezar gratis**, la [Maps Demo Key](https://mapsplatform.google.com/maps-demo-key/) sirve: no pide tarjeta y cubre todo lo que usa la app (mapa, Places API (New), Geocoding API v4 y Routes). Es para prototipos: tiene un límite diario (al llegar se pausa hasta el día siguiente, sin cargos) y no da fotos ni reseñas de usuarios. Ponla en `GOOGLE_MAPS_API_KEY`.

**Para producción**, en [Google Cloud Console](https://console.cloud.google.com/) con facturación activa: habilita Maps JavaScript API, Places API (New), Geocoding API y Routes API, y crea dos claves. La del navegador (`GOOGLE_MAPS_BROWSER_API_KEY`) se restringe por *Sitios web* (`http://localhost:3000/*` y tu dominio) y a *Maps JavaScript API*; es visible en el navegador por diseño y la restricción es lo que la protege. La del servidor (`GOOGLE_MAPS_SERVER_API_KEY`) se restringe a Places, Geocoding y Routes, y nunca sale del servidor.

### Modelos para el chat

Pon una o varias claves; en el chat aparece un selector con los modelos disponibles y puedes cambiar a mitad de conversación (si cambias de proveedor, el modelo nuevo recibe la conversación en texto). En **Ajustes**, «Ver modelos de tu cuenta» pide al proveedor la lista de modelos que te da tu clave o suscripción y marcas cuáles quieres en el selector; también puedes añadir uno escribiendo su nombre exacto.

| Variable | Proveedor | Notas |
|---|---|---|
| `GEMINI_API_KEY` | Gemini, de Google | Se saca en [Google AI Studio](https://aistudio.google.com/apikey); tiene nivel gratuito. Modelos en `GEMINI_MODELS` (por defecto `gemini-3.8-flash`) |
| `OPENCODE_GO_API_KEY` | [OpenCode Go](https://opencode.ai/docs/go/) | Suscripción de OpenCode. Solo modelos de `/chat/completions`, en `OPENCODE_GO_MODELS` (por defecto `kimi-k3,glm-5.3,deepseek-v4-pro`). OpenCode dice que Go está pensado para agentes de programación y vigila el tráfico, así que úsalo sabiendo eso |
| `ANTHROPIC_API_KEY` | Claude, de Anthropic | API de pago en [console.anthropic.com](https://console.anthropic.com/); la suscripción de claude.ai no da acceso a la API. Modelos en `ANTHROPIC_MODELS` (por defecto `claude-opus-5-5,claude-sonnet-5-5`); `ANTHROPIC_EFFORT` de `low` a `max` |
| `OPENAI_COMPATIBLE_BASE_URL` + `OPENAI_COMPATIBLE_MODELS` | Cualquiera compatible con OpenAI | OpenRouter, Ollama en tu PC (`http://localhost:11434/v1`), etc. Opcionales: `OPENAI_COMPATIBLE_API_KEY` y `OPENAI_COMPATIBLE_NAME` |
| `LLM_DEFAULT_MODEL` | | Qué modelo sale elegido por defecto, como `proveedor:modelo` (p. ej. `gemini:gemini-3.8-flash`) |

### Búsqueda web

La usa el chatbot para transporte público, negocios pequeños, noticias y eventos. Claude trae la suya (puede que tengas que activarla para tu organización en la consola de Anthropic). Los demás modelos usan un [SearXNG](https://docs.searxng.org/) propio, un metabuscador que corre en tu PC con Docker y no necesita claves.

**Arranca solo**: al iniciar la app, y también si una búsqueda lo encuentra apagado, la app ejecuta `docker compose up -d searxng` con el `docker-compose.yml` del repo (SearXNG en http://localhost:8888, la URL por defecto). La primera vez Docker descarga la imagen y tarda unos minutos. Solo necesitas Docker instalado y abierto (Docker Desktop en Windows y Mac). En **Ajustes → Búsqueda web** ves si está funcionando, por qué no arranca (Docker no instalado, Docker cerrado, puerto ocupado…) y tienes un botón «Arrancar». Si prefieres arrancarlo tú, `docker compose up -d` hace lo mismo y `SEARXNG_AUTOSTART=false` desactiva el arranque automático.

La configuración del repo (`searxng/settings.yml`) ya activa el formato JSON, que es el que consulta la app. Con SearXNG el tutor tiene dos herramientas: `web_search` (resultados con fragmento) y `read_web_page`, que lee el texto de una página de esos resultados (solo páginas públicas que salieron en la búsqueda del mismo turno). `SEARXNG_URL` apunta a otro SearXNG si ya tienes uno (si no está en este PC, la app no intenta arrancarlo), y `WEB_SEARCH_ENABLED=false` apaga la búsqueda web para todos los modelos.

## Cómo probarlo

```bash
npm test           # tests con Google y los modelos simulados (no gastan cuota ni necesitan claves)
npm run lint
npm run typecheck
npm run build
```

Con las claves puestas, prueba en el chat:

- «Quiero aprender Maracaibo desde cero.»
- «Enséñame las avenidas principales de Maracaibo.» → las resalta en el mapa.
- «Muéstrame los principales centros comerciales de Maracaibo.» → marcadores de Google Places.
- «¿Dónde venden componentes electrónicos?» → búsqueda en Places y, si hace falta, en la web.
- «¿Cómo puedo ir desde La Curva de Molina hasta el centro en transporte público?» → Routes API en modo transporte y, si Google no tiene datos, una ruta reconstruida desde fuentes web, marcada como tal.
- «Hazme un quiz de las avenidas que hemos visto.» → oculta los nombres en el mapa («Vía A», «Vía B») y te pide que las identifiques o las toques.

También puedes hacer clic en el mapa (te dice qué hay ahí), buscar con la barra superior, y activar capas de lugares en la pestaña **Capas**.

## Arquitectura

```
Navegador (React)  ──►  /api/chat  ──►  Agente (modelo elegido)  ──►  Herramientas  ──►  Google Maps Platform / búsqueda web
      ▲                                                            │
      └──────────── MapActions (JSON, en streaming) ◄──────────────┘
```

El modelo nunca toca la interfaz. Llama a herramientas con entradas validadas (Zod); cada herramienta consulta a Google o a la web y emite **MapActions** tipadas (`ADD_MARKERS`, `DRAW_ROUTE`, `HIGHLIGHT_ROAD`, `HIGHLIGHT_AREA`, `SET_FEATURE_LABELS`, `FIT_BOUNDS`…), que el navegador aplica a su estado del mapa. Las herramientas no aceptan coordenadas del modelo: piden nombres, direcciones o `placeId`, y las coordenadas salen siempre de Google.

| Carpeta | Contenido |
|---|---|
| `src/app` | Página y rutas de API (`/api/chat`, `/api/places/*`, `/api/geocode/reverse`, `/api/settings/*`) |
| `src/components` | Mapa, chat, buscador, capas, panel de selección, aprendizaje y quizzes |
| `src/lib/map` | Tipos de `MapAction`, estado del mapa y `MapContext` que recibe el agente |
| `src/lib/learning` | Programa (niveles I–IX y glosario), lecciones, quizzes y progreso |
| `src/server/providers` | Clientes de Google (Places API (New), Geocoding, Routes) detrás de interfaces propias |
| `src/server/tools` | Las herramientas del agente (`search_places`, `calculate_route`, `search_transit_information`, `highlight_road`, `create_quiz`…) |
| `src/server/agent` | Bucle del agente (Claude y compatibles con OpenAI) y prompt del tutor |
| `src/server/llm` | Catálogo de proveedores y modelos según las claves configuradas |
| `src/server/settings` | Pantalla de Ajustes: quién puede usarla, validación, escritura de `.env.local` y lista de modelos de cada proveedor |
| `src/server/searxng` + `src/instrumentation.ts` | Arranque automático de SearXNG con Docker al iniciar el servidor |

Los proveedores están detrás de interfaces (`src/server/providers/types.ts`), así que cambiar de proveedor de mapas o de búsqueda no toca la interfaz ni las herramientas.

**Otras ciudades**: Caracas, Valencia, Barquisimeto, Mérida y Puerto La Cruz ya están en el selector; añadir más es añadir una entrada en `src/lib/cities.ts`. El contenido de los niveles V–IX está pensado para Maracaibo y el tutor lo adapta a la ciudad visible.

**El progreso y el chat** se guardan en el `localStorage` de tu navegador (por tema: intentos, aciertos, precisión, dificultad, última vez y nivel de dominio).

## Limitaciones y pendientes

- **Datos de transporte público**: Google tiene poca cobertura de autobuses y carritos por puesto en Venezuela. Cuando no hay datos, el agente reconstruye la ruta desde fuentes web, la marca como `WEB_DATA` y solo dibuja las paradas que Google pudo ubicar; las demás se listan como no verificadas.
- **Resaltar una avenida** traza la vía con Routes API entre dos extremos que propone el tutor; es una aproximación al trazado real y se indica como tal. Los **sectores** se muestran con el rectángulo que devuelve Geocoding, no con su contorno exacto.
- El progreso vive en el navegador: si cambias de dispositivo, empieza de cero. Una base de datos con cuenta de usuario sería el siguiente paso.
- Google Maps está probado con una Maps Demo Key real (mapa, buscador, clic en el mapa, capas), y SearXNG arrancando solo con el `docker-compose.yml` del repo. Los modelos no se han probado con claves reales (el entorno donde se construyó no llega a opencode.ai): los tests usan modelos simulados y un servidor falso compatible con OpenAI.
- Los modelos de OpenCode Go que usan `/messages` o `/responses` (MiniMax, Qwen, Grok, GPT) no están soportados todavía.
- Los ajustes desde la app están pensados para usarla en tu propio PC. Bloquean a otros aparatos por la cabecera `Host` y la IP que ve Next, pero alguien en tu misma red que falsee esas cabeceras a propósito podría cambiarlos; si abres la app a otros, usa `SETTINGS_UI=off`.

## Sobre ROSE

Se revisó [Fastc0de/ROSE](https://github.com/Fastc0de/ROSE) para reutilizar su arquitectura de búsqueda y agente. Es un CLI en Python, así que no se reutilizó código, pero sí sus ideas: etiquetar el origen de cada dato, tratar el contenido web como no confiable, que el modelo proponga y el código valide, y tests con proveedores simulados.
