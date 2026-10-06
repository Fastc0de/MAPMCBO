/**
 * Programa de aprendizaje. Sigue el objetivo que escribiste:
 * primero cómo funciona una ciudad y su sistema vial, después Venezuela y el Zulia,
 * y por último Maracaibo hasta poder moverte sin depender del mapa.
 *
 * Los temas generales traen glosario. Los temas de Maracaibo NO traen nombres de
 * avenidas ni de sectores escritos a mano: el tutor los busca en Google Maps y en la web
 * en el momento, y dice de dónde salió cada dato.
 */

export interface GlossaryTerm {
  term: string;
  definition: string;
}

export type TopicScope = "general" | "venezuela" | "zulia" | "maracaibo";

export interface Topic {
  id: string;
  title: string;
  scope: TopicScope;
  goals: string[];
  glossary?: GlossaryTerm[];
  /** Ideas de práctica sobre el mapa que el tutor puede convertir en lección o quiz. */
  mapActivities?: string[];
}

export interface Level {
  id: string;
  order: number;
  title: string;
  summary: string;
  topics: Topic[];
}

export const CURRICULUM: Level[] = [
  {
    id: "lenguaje-urbano",
    order: 1,
    title: "I. Lenguaje urbano",
    summary: "Qué estás viendo: tipos de vías, intersecciones y partes de una vía.",
    topics: [
      {
        id: "tipos-de-vias",
        title: "Tipos de vías",
        scope: "general",
        goals: [
          "Distinguir calle, avenida, carrera, boulevard, carretera, autopista y vía expresa.",
          "Entender la diferencia entre vía arterial, colectora y local.",
          "Recordar que el nombre de una vía no indica necesariamente su importancia.",
        ],
        glossary: [
          { term: "Calle", definition: "Vía urbana que da acceso a edificaciones. Puede ser pequeña o muy importante: el nombre no dice su jerarquía." },
          { term: "Avenida", definition: "Vía urbana normalmente más ancha y con más tráfico que una calle, a menudo con varios carriles y separador." },
          { term: "Carrera", definition: "En algunas ciudades venezolanas y colombianas, vía numerada que corre en un sentido de la cuadrícula, perpendicular a las calles." },
          { term: "Boulevard", definition: "Vía amplia y arbolada, a veces peatonal, pensada para paseo además de circulación." },
          { term: "Carretera", definition: "Vía que conecta poblaciones fuera del área urbana." },
          { term: "Autopista", definition: "Vía de alta capacidad con calzadas separadas, sin cruces a nivel y con accesos controlados." },
          { term: "Vía expresa", definition: "Vía urbana rápida con pocos o ningún cruce a nivel; parecida a una autopista dentro de la ciudad." },
          { term: "Vía arterial", definition: "Vía principal que conecta grandes zonas de la ciudad y mueve mucho tráfico." },
          { term: "Vía colectora", definition: "Recoge el tráfico de las calles locales y lo lleva a las arteriales." },
          { term: "Vía local", definition: "Sirve sobre todo a los edificios que la rodean; poco tráfico de paso." },
          { term: "Callejón", definition: "Calle estrecha, a menudo sin salida o de un solo carril." },
          { term: "Pasaje", definition: "Paso estrecho entre edificaciones, a veces solo peatonal." },
          { term: "Vía de servicio", definition: "Vía paralela a una principal que da acceso a comercios y casas sin entorpecer el tráfico rápido." },
          { term: "Canal de circulación", definition: "Cada franja por la que circula una fila de vehículos; sinónimo de carril." },
        ],
        mapActivities: [
          "Comparar en el mapa una vía arterial con una calle local cercana.",
          "Encontrar una calle que sea más importante que una avenida cercana.",
        ],
      },
      {
        id: "intersecciones",
        title: "Intersecciones y cruces",
        scope: "general",
        goals: [
          "Reconocer intersecciones en T, de cuatro vías, redomas, retornos y distribuidores.",
          "Entender cómo se mueve el tráfico en cada tipo.",
        ],
        glossary: [
          { term: "Intersección", definition: "Lugar donde dos o más vías se encuentran." },
          { term: "Cruce", definition: "Punto donde una vía atraviesa otra; puede ser a nivel o a desnivel." },
          { term: "Esquina", definition: "Ángulo que forman dos calles al cruzarse; se usa mucho como referencia para dar direcciones." },
          { term: "Intersección en T", definition: "Una vía termina contra otra; solo se puede girar a izquierda o derecha." },
          { term: "Intersección de 4 vías", definition: "Dos vías se cruzan completas; suele necesitar semáforo o prioridad clara." },
          { term: "Glorieta / rotonda", definition: "Intersección circular donde el tráfico gira alrededor de una isla central." },
          { term: "Redoma", definition: "Nombre que se usa en Venezuela para la rotonda o glorieta." },
          { term: "Retorno", definition: "Abertura en el separador que permite dar la vuelta en U." },
          { term: "Distribuidor", definition: "Conjunto de rampas y puentes donde dos corredores importantes intercambian tráfico sin detenerse." },
          { term: "Paso elevado", definition: "Una vía pasa por encima de otra mediante un puente (en Venezuela, «elevado»)." },
          { term: "Paso deprimido", definition: "Una vía pasa por debajo del nivel de otra, en una trinchera." },
          { term: "Puente", definition: "Estructura que salva un obstáculo: río, canal, otra vía o un cuerpo de agua." },
          { term: "Túnel", definition: "Paso subterráneo o a través de un relieve." },
        ],
        mapActivities: ["Encontrar una redoma y un distribuidor cerca de la zona que estás viendo."],
      },
      {
        id: "elementos-de-la-via",
        title: "Partes de una vía",
        scope: "general",
        goals: ["Nombrar las partes de una vía: calzada, carril, acera, hombrillo, separador, isla vial…"],
        glossary: [
          { term: "Calzada", definition: "Parte de la vía por la que circulan los vehículos." },
          { term: "Carril", definition: "Cada franja longitudinal de la calzada por la que circula una fila de vehículos." },
          { term: "Acera", definition: "Franja lateral elevada para peatones." },
          { term: "Hombrillo", definition: "Franja pavimentada al borde de la calzada, para emergencias; es el término venezolano para el arcén." },
          { term: "Separador", definition: "Elemento que divide los dos sentidos de circulación." },
          { term: "Mediana", definition: "Franja central entre calzadas de sentidos opuestos, a veces con vegetación." },
          { term: "Canal", definition: "En lenguaje cotidiano, carril. También puede referirse a un canal de drenaje." },
          { term: "Cuneta", definition: "Zanja o canal al borde de la vía que recoge el agua de lluvia." },
          { term: "Isla vial", definition: "Zona elevada o pintada que ordena los giros en una intersección." },
          { term: "Berma", definition: "Franja lateral de la vía fuera de la calzada; en muchos países, sinónimo de hombrillo." },
          { term: "Estacionamiento", definition: "Espacio destinado a dejar vehículos detenidos." },
          { term: "Parada de transporte", definition: "Lugar donde el transporte público recoge y deja pasajeros." },
        ],
      },
    ],
  },
  {
    id: "sistema-vial",
    order: 2,
    title: "II. Sistema vial",
    summary: "Las reglas del sistema: señales, marcas, semáforos y jerarquía de vías.",
    topics: [
      {
        id: "senalizacion",
        title: "Señales y marcas en el pavimento",
        scope: "general",
        goals: [
          "Reconocer señales reglamentarias, preventivas e informativas.",
          "Leer las marcas en el pavimento: líneas continuas, discontinuas, pasos peatonales y flechas.",
        ],
        glossary: [
          { term: "PARE", definition: "Obliga a detenerse por completo antes de continuar." },
          { term: "Ceda el paso", definition: "Obliga a dejar pasar a quien circula por la vía preferente." },
          { term: "Sentido único", definition: "Toda la vía circula en una sola dirección." },
          { term: "Doble sentido", definition: "La vía tiene circulación en ambas direcciones." },
          { term: "Señal preventiva", definition: "Avisa de un peligro o cambio adelante (curva, cruce, reductor)." },
          { term: "Señal informativa", definition: "Orienta: destinos, servicios, nombres de vías." },
          { term: "Señal de destino", definition: "Indica hacia dónde lleva cada carril o salida." },
          { term: "Línea continua", definition: "No se debe cruzar ni para adelantar." },
          { term: "Línea discontinua", definition: "Se puede cruzar con precaución para cambiar de carril o adelantar." },
          { term: "Paso peatonal", definition: "Franja marcada donde los peatones tienen prioridad para cruzar." },
          { term: "Carril exclusivo", definition: "Carril reservado para un tipo de vehículo, por ejemplo transporte público." },
        ],
      },
      {
        id: "semaforos",
        title: "Semáforos y prioridad",
        scope: "general",
        goals: ["Entender fases, giros protegidos y permitidos, y semáforos peatonales."],
        glossary: [
          { term: "Fase", definition: "Cada parte del ciclo de un semáforo en la que se permite un conjunto de movimientos." },
          { term: "Giro protegido", definition: "Giro con su propia flecha verde: nadie se cruza en ese momento." },
          { term: "Giro permitido", definition: "Giro con luz verde general: hay que ceder a peatones y al tráfico de frente." },
          { term: "Intersección semaforizada", definition: "Cruce controlado por semáforos." },
        ],
      },
      {
        id: "jerarquia-vial",
        title: "Cómo se organiza una ciudad: jerarquía vial",
        scope: "general",
        goals: [
          "Entender la cadena autopista → arteria → colectora → local.",
          "Preguntarte por qué una avenida es importante o por qué existe un distribuidor.",
        ],
        mapActivities: [
          "Seguir el recorrido de una vía local hasta la arteria más cercana.",
          "Identificar qué corredores intercambian tráfico en un distribuidor.",
        ],
      },
    ],
  },
  {
    id: "orientacion",
    order: 3,
    title: "III. Orientación",
    summary: "Puntos cardinales, escala y mapa mental: orientarte sin depender de una app.",
    topics: [
      {
        id: "puntos-cardinales",
        title: "Puntos cardinales y ubicación relativa",
        scope: "general",
        goals: [
          "Usar norte, sur, este, oeste y los puntos intermedios.",
          "Decir hacia dónde corre una vía (norte-sur, este-oeste).",
          "Describir dónde está algo respecto de otra cosa.",
        ],
        glossary: [
          { term: "Norte / Sur / Este / Oeste", definition: "Los cuatro puntos cardinales. En casi todos los mapas el norte está arriba." },
          { term: "Noreste, noroeste, sureste, suroeste", definition: "Puntos intermedios entre los cardinales." },
          { term: "Ubicación relativa", definition: "Describir un lugar por su relación con otro: «al norte de», «entre», «frente a»." },
        ],
        mapActivities: ["Decir qué queda al norte, sur, este y oeste del punto seleccionado."],
      },
      {
        id: "leer-un-mapa",
        title: "Cómo leer un mapa: escala y referencias",
        scope: "general",
        goals: ["Usar la escala para estimar distancias.", "Elegir buenas referencias visuales."],
        glossary: [
          { term: "Escala", definition: "Relación entre una distancia en el mapa y la distancia real." },
          { term: "Punto de referencia", definition: "Lugar fácil de reconocer que ayuda a ubicarse (landmark)." },
          { term: "Mapa mental", definition: "La imagen aproximada de la ciudad que construyes en tu cabeza." },
        ],
      },
    ],
  },
  {
    id: "venezuela-zulia",
    order: 4,
    title: "IV. Venezuela y el Zulia",
    summary: "El contexto: estados, capitales, regiones, municipios del Zulia y vías principales.",
    topics: [
      {
        id: "venezuela-estados",
        title: "Estados, capitales y regiones de Venezuela",
        scope: "venezuela",
        goals: ["Ubicar los estados y sus capitales.", "Reconocer las grandes regiones y ciudades."],
        mapActivities: ["Encontrar en el mapa la capital de un estado."],
      },
      {
        id: "venezuela-carreteras",
        title: "Principales carreteras de Venezuela",
        scope: "venezuela",
        goals: ["Conocer las grandes vías que conectan las regiones."],
      },
      {
        id: "zulia",
        title: "El Zulia: municipios, ciudades y vías",
        scope: "zulia",
        goals: [
          "Ubicar los municipios y ciudades del Zulia.",
          "Entender la relación del Zulia con el Lago de Maracaibo y sus conexiones.",
        ],
      },
    ],
  },
  {
    id: "maracaibo-vial",
    order: 5,
    title: "V. Maracaibo vial",
    summary: "De arriba abajo: corredores, circunvalaciones, distribuidores, puentes y accesos.",
    topics: [
      {
        id: "mcbo-corredores",
        title: "Grandes corredores y avenidas principales",
        scope: "maracaibo",
        goals: [
          "Identificar las avenidas y corredores principales.",
          "Poder dibujar Maracaibo de memoria, aunque sea feo.",
        ],
        mapActivities: [
          "Resaltar las avenidas principales y luego ocultar sus nombres para practicar.",
          "Encontrar una avenida haciendo clic sobre ella.",
        ],
      },
      {
        id: "mcbo-circunvalaciones",
        title: "Circunvalaciones, distribuidores y puentes",
        scope: "maracaibo",
        goals: ["Ubicar las circunvalaciones y los distribuidores principales.", "Saber cómo se entra y se sale de la ciudad."],
      },
    ],
  },
  {
    id: "maracaibo-geografico",
    order: 6,
    title: "VI. Maracaibo geográfico",
    summary: "Zonas, sectores, barrios y urbanizaciones; cómo da direcciones la gente.",
    topics: [
      {
        id: "mcbo-zonas",
        title: "Zonas y sectores",
        scope: "maracaibo",
        goals: [
          "Dividir la ciudad en grandes zonas con sus límites aproximados.",
          "Saber qué avenidas conectan cada zona con las demás.",
        ],
        mapActivities: ["Mostrar una zona sin nombres y preguntar dónde estamos."],
      },
      {
        id: "mcbo-direcciones",
        title: "Nomenclatura y cómo se dan direcciones",
        scope: "maracaibo",
        goals: [
          "Entender la numeración de calles y avenidas.",
          "Traducir una dirección cotidiana («por la avenida X, cerca de Y») a un punto del mapa.",
        ],
      },
    ],
  },
  {
    id: "maracaibo-landmarks",
    order: 7,
    title: "VII. Puntos de referencia",
    summary: "Infraestructura, comercio, ocio y cultura: los lugares que ordenan tu mapa mental.",
    topics: [
      {
        id: "mcbo-infraestructura",
        title: "Infraestructura: hospitales, universidades, terminales",
        scope: "maracaibo",
        goals: ["Ubicar hospitales, clínicas, universidades, terminales y servicios públicos."],
      },
      {
        id: "mcbo-comercio-ocio",
        title: "Comercio y ocio",
        scope: "maracaibo",
        goals: ["Ubicar centros comerciales, mercados, restaurantes, parques y plazas."],
      },
      {
        id: "mcbo-cultura",
        title: "Cultura e historia en el mapa",
        scope: "maracaibo",
        goals: ["Ubicar museos, teatros, iglesias, monumentos y lugares históricos."],
      },
    ],
  },
  {
    id: "leer-maracaibo",
    order: 8,
    title: "VIII. Leer Maracaibo",
    summary: "Orientación práctica: ir de una zona a otra y reconstruir rutas de memoria.",
    topics: [
      {
        id: "mcbo-rutas-mentales",
        title: "Construir rutas mentalmente",
        scope: "maracaibo",
        goals: [
          "Pensar una ruta como zona → avenida principal → intersección → calle → destino.",
          "Saber qué avenidas conectan dos zonas.",
        ],
        mapActivities: ["Trazar una ruta de A a B y explicar por qué avenidas pasa."],
      },
      {
        id: "mcbo-transporte",
        title: "Transporte público",
        scope: "maracaibo",
        goals: ["Conocer cómo funcionan las rutas de autobuses y por puestos y dónde paran."],
      },
      {
        id: "mcbo-me-perdi",
        title: "«Me perdí»: recuperar la orientación",
        scope: "maracaibo",
        goals: ["Usar referencias cercanas, la vía principal más próxima y el norte para ubicarte."],
      },
    ],
  },
  {
    id: "mas-alla",
    order: 9,
    title: "IX. Dominio y más allá",
    summary: "Geografía física, historia, economía, sociedad, cultura y la Maracaibo de hoy.",
    topics: [
      { id: "mcbo-geografia-fisica", title: "Geografía física: el Lago, relieve, cañadas", scope: "maracaibo", goals: ["Entender el lago, las cañadas, zonas inundables y la expansión urbana."] },
      { id: "mcbo-historia", title: "Historia y crecimiento de la ciudad", scope: "maracaibo", goals: ["Fundación, petróleo, expansión y barrios históricos."] },
      { id: "mcbo-economia-sociedad", title: "Economía y sociedad en el mapa", scope: "maracaibo", goals: ["Zonas comerciales, industriales, residenciales y universitarias."] },
      { id: "mcbo-actual", title: "Maracaibo actual", scope: "maracaibo", goals: ["Negocios nuevos, eventos, cambios urbanos y problemas de tráfico (siempre con fuentes web recientes)."] },
    ],
  },
];

export function findTopic(topicId: string): { level: Level; topic: Topic } | undefined {
  for (const level of CURRICULUM) {
    const topic = level.topics.find((t) => t.id === topicId);
    if (topic) return { level, topic };
  }
  return undefined;
}

export const ALL_TOPIC_IDS = CURRICULUM.flatMap((l) => l.topics.map((t) => t.id));

/** Vista compacta del programa para el agente (sin glosarios completos). */
export function curriculumOutline() {
  return CURRICULUM.map((l) => ({
    levelId: l.id,
    title: l.title,
    summary: l.summary,
    topics: l.topics.map((t) => ({ topicId: t.id, title: t.title, scope: t.scope })),
  }));
}
