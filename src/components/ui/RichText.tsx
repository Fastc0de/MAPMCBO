"use client";

import { Fragment, type ReactNode } from "react";

/**
 * Markdown mínimo y seguro (sin HTML): párrafos, listas, **negritas**, enlaces y
 * las marcas de procedencia [Google Maps], [Web: …] e [Inferencia] como etiquetas de color.
 */
export function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={`l${blocks.length}`} className={`my-1 space-y-0.5 pl-5 ${list.ordered ? "list-decimal" : "list-disc"}`}>
        {list.items.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    blocks.push(
      heading ? (
        <p key={`h${blocks.length}`} className="mt-2 font-semibold">
          {inline(heading[1])}
        </p>
      ) : (
        <p key={`p${blocks.length}`} className="my-1">
          {inline(line)}
        </p>
      ),
    );
  }
  flush();
  return <>{blocks}</>;
}

const TOKEN = /(\*\*[^*]+\*\*|\[(?:Google Maps|Inferencia|Web(?::[^\]]*)?)\]|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;

function inline(text: string): ReactNode {
  const parts = text.split(TOKEN);
  return parts.map((part, i) => {
    if (!part) return null;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(part);
    if (link) {
      return (
        <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer" className="text-accent underline">
          {link[1]}
        </a>
      );
    }
    if (part === "[Google Maps]") return <SourceTag key={i} kind="google" label="Google Maps" />;
    if (part === "[Inferencia]") return <SourceTag key={i} kind="inference" label="Inferencia" />;
    if (part.startsWith("[Web")) return <SourceTag key={i} kind="web" label={part.slice(1, -1)} />;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function SourceTag({ kind, label }: { kind: "google" | "web" | "inference"; label: string }) {
  const styles = {
    google: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
    web: "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200",
    inference: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200",
  }[kind];
  return <span className={`mx-0.5 inline-block rounded px-1.5 py-px align-middle text-[10px] font-semibold ${styles}`}>{label}</span>;
}

export function sourceKind(source: string): "google" | "web" | "inference" {
  return source === "GOOGLE_MAPS_DATA" ? "google" : source === "WEB_DATA" ? "web" : "inference";
}

export const SOURCE_LABEL: Record<string, string> = {
  GOOGLE_MAPS_DATA: "Google Maps",
  WEB_DATA: "Web",
  MODEL_INFERENCE: "Inferencia",
};
