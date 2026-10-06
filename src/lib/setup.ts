/** Algo que falta configurar en el servidor y qué parte de la app deja de funcionar sin ello. */
export interface MissingConfig {
  part: "map" | "google" | "chat";
  text: string;
}
