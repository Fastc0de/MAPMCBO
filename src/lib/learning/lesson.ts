export interface LessonSection {
  heading: string;
  body: string;
}

export interface Lesson {
  id: string;
  title: string;
  topicId?: string;
  levelId?: string;
  objectives: string[];
  sections: LessonSection[];
  glossary: { term: string; definition: string }[];
  /** Ejercicio sugerido para practicar sobre el mapa. */
  practice?: string;
}
