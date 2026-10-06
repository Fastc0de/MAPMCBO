# Mapa de Maracaibo

Un Google Maps con tutor personal de geografía y agente de investigación local, para aprender a orientarse en Venezuela empezando por Maracaibo.

- **Mapa grande** de Google Maps centrado en Maracaibo, con toda Venezuela disponible (selector de ciudad y botón «Venezuela»).
- **Chatbot al lado** (Claude) que controla el mapa: busca lugares, los marca, traza rutas, resalta avenidas y sectores, explica dónde está cada cosa y te hace preguntas sobre el propio mapa.
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
cp .env.example .env.local   # y rellena las claves (ver abajo)
npm run dev                  # http://localhost:3000
```

Sin claves la app arranca igual: verás el programa de aprendizaje y el glosario, y un aviso arriba con lo que falta configurar.

## Claves de API

Las claves van **solo** en `.env.local` (o en las variables de entorno de tu hosting). Ese archivo está en `.gitignore`: no se sube nunca al repositorio.

| Variable | Obligatoria | Para qué |
|---|---|---|
| `GOOGLE_MAPS_BROWSER_API_KEY` | Sí | Dibujar el mapa en el navegador (Maps JavaScript API) |
| `GOOGLE_MAPS_SERVER_API_KEY` | Sí | Búsquedas y rutas desde el servidor: Places API (New), Geocoding API, Routes API |
| `ANTHROPIC_API_KEY` | Sí, para el chat | El chatbot (Claude) |
| `GOOGLE_MAPS_MAP_ID` | No | Tu Map ID propio; si no hay, se usa `DEMO_MAP_ID` |
| `ANTHROPIC_MODEL` | No | Modelo de Claude (por defecto `claude-opus-5-5`) |
| `ANTHROPIC_EFFORT` | No | `low`, `medium` (por defecto), `high`, `xhigh` o `max` |
| `WEB_SEARCH_ENABLED` | No | `false` para desactivar la búsqueda web del chatbot |
| `WEB_SEARCH_MAX_USES` | No | Búsquedas web máximas por mensaje (por defecto 5) |

### Google Maps Platform

1. Entra en [Google Cloud Console](https://console.cloud.google.com/), crea un proyecto y activa la facturación (Google da un crédito mensual gratuito).
2. En **APIs y servicios → Biblioteca**, habilita: **Maps JavaScript API**, **Places API (New)**, **Geocoding API** y **Routes API**.
3. En **APIs y servicios → Credenciales**, crea **dos** claves:
   - **Clave del navegador** → `GOOGLE_MAPS_BROWSER_API_KEY`. Restricción de aplicación: *Sitios web*, con `http://localhost:3000/*` y el dominio donde la publiques. Restricción de API: solo *Maps JavaScript API*. Esta clave es visible en el navegador por diseño; la restricción por dominio es lo que la protege.
   - **Clave del servidor** → `GOOGLE_MAPS_SERVER_API_KEY`. Restricción de API: *Places API (New)*, *Geocoding API* y *Routes API*. Nunca sale del servidor.
4. (Opcional) En **Google Maps Platform → Gestión de mapas**, crea un Map ID de tipo JavaScript y ponlo en `GOOGLE_MAPS_MAP_ID`.

### Anthropic (chatbot)

1. Entra en [console.anthropic.com](https://console.anthropic.com/), ve a **API Keys** y crea una clave → `ANTHROPIC_API_KEY`.
2. La búsqueda web del chatbot (rutas de transporte, páginas de negocios, noticias) puede tener que activarse para tu organización en la consola. Si el chat da un error de permisos al buscar en la web, actívala allí o pon `WEB_SEARCH_ENABLED=false`.

## Cómo probarlo

```bash
npm test           # tests con Google y Claude simulados (no gastan cuota ni necesitan claves)
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
Navegador (React)  ──►  /api/chat  ──►  Agente (Claude)  ──►  Herramientas  ──►  Google Maps Platform / búsqueda web
      ▲                                                            │
      └──────────── MapActions (JSON, en streaming) ◄──────────────┘
```

El modelo nunca toca la interfaz. Llama a herramientas con entradas validadas (Zod); cada herramienta consulta a Google o a la web y emite **MapActions** tipadas (`ADD_MARKERS`, `DRAW_ROUTE`, `HIGHLIGHT_ROAD`, `HIGHLIGHT_AREA`, `SET_FEATURE_LABELS`, `FIT_BOUNDS`…), que el navegador aplica a su estado del mapa. Las herramientas no aceptan coordenadas del modelo: piden nombres, direcciones o `placeId`, y las coordenadas salen siempre de Google.

| Carpeta | Contenido |
|---|---|
| `src/app` | Página y rutas de API (`/api/chat`, `/api/places/*`, `/api/geocode/reverse`) |
| `src/components` | Mapa, chat, buscador, capas, panel de selección, aprendizaje y quizzes |
| `src/lib/map` | Tipos de `MapAction`, estado del mapa y `MapContext` que recibe el agente |
| `src/lib/learning` | Programa (niveles I–IX y glosario), lecciones, quizzes y progreso |
| `src/server/providers` | Clientes de Google (Places API (New), Geocoding, Routes) detrás de interfaces propias |
| `src/server/tools` | Las herramientas del agente (`search_places`, `calculate_route`, `search_transit_information`, `highlight_road`, `create_quiz`…) |
| `src/server/agent` | Bucle del agente y prompt del tutor |

Los proveedores están detrás de interfaces (`src/server/providers/types.ts`), así que cambiar de proveedor de mapas o de búsqueda no toca la interfaz ni las herramientas.

**Otras ciudades**: Caracas, Valencia, Barquisimeto, Mérida y Puerto La Cruz ya están en el selector; añadir más es añadir una entrada en `src/lib/cities.ts`. El contenido de los niveles V–IX está pensado para Maracaibo y el tutor lo adapta a la ciudad visible.

**El progreso y el chat** se guardan en el `localStorage` de tu navegador (por tema: intentos, aciertos, precisión, dificultad, última vez y nivel de dominio).

## Limitaciones y pendientes

- **Datos de transporte público**: Google tiene poca cobertura de autobuses y carritos por puesto en Venezuela. Cuando no hay datos, el agente reconstruye la ruta desde fuentes web, la marca como `WEB_DATA` y solo dibuja las paradas que Google pudo ubicar; las demás se listan como no verificadas.
- **Resaltar una avenida** traza la vía con Routes API entre dos extremos que propone el tutor; es una aproximación al trazado real y se indica como tal. Los **sectores** se muestran con el rectángulo que devuelve Geocoding, no con su contorno exacto.
- El progreso vive en el navegador: si cambias de dispositivo, empieza de cero. Una base de datos con cuenta de usuario sería el siguiente paso.
- No se ha probado todavía contra las APIs reales (este repositorio no tiene claves); los tests usan Google y Claude simulados.

## Sobre ROSE

Se revisó [Fastc0de/ROSE](https://github.com/Fastc0de/ROSE) para reutilizar su arquitectura de búsqueda y agente. Es un CLI en Python, así que no se reutilizó código, pero sí sus ideas: etiquetar el origen de cada dato, tratar el contenido web como no confiable, que el modelo proponga y el código valide, y tests con proveedores simulados.
