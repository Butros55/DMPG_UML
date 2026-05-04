import type { Symbol as Sym } from "@dmpg/shared";

type ArtifactPreviewSource = Pick<Sym, "id" | "tags"> & {
  preview?: { lines?: string[] };
  kind?: Sym["kind"];
  label?: string;
  umlType?: string;
};

export type ArtifactPreviewKind = "cluster" | "single" | "plain";

export interface ArtifactPreviewMeta {
  mode?: "single" | "cluster";
  stageId?: string;
  stageLabel?: string;
  flow?: string;
  category?: string;
  groupKind?: string;
  groupCount?: number;
  pathCount?: number;
  reviewHints?: string[];
}

export interface ArtifactPreviewItem {
  label: string;
  paths: string[];
  artifactIds: string[];
  writeCount: number | null;
  readCount: number | null;
  producerIds: string[];
  consumerIds: string[];
  producers: string[];
  consumers: string[];
  producerStages: string[];
  consumerStages: string[];
  category?: string;
  groupKind?: string;
  reviewHints?: string[];
}

export interface ArtifactPreviewDetailRow {
  label: string;
  value: string;
  values: string[];
}

export interface ArtifactPreviewData {
  kind: ArtifactPreviewKind;
  allLines: string[];
  meta: ArtifactPreviewMeta | null;
  itemEntries: ArtifactPreviewItem[];
  detailRows: ArtifactPreviewDetailRow[];
  rawLines: string[];
  itemCount: number | null;
  groupCount: number | null;
  summaryItems: string[];
}

export const PROCESS_STAGE_PACKAGE_IDS: Record<string, string> = {
  inputs: "proc:pkg:inputs",
  extract: "proc:pkg:extract",
  transform: "proc:pkg:transform",
  match: "proc:pkg:match",
  distribution: "proc:pkg:distribution",
  simulation: "proc:pkg:simulation",
};

const PREVIEW_META_PREFIX = "@preview ";
const PREVIEW_ITEM_PREFIX = "@item ";
const PREVIEW_SUMMARY_ITEM_LIMIT = 3;

export function buildArtifactPreview(
  sym: ArtifactPreviewSource,
): ArtifactPreviewData | null {
  const allLines = (sym.preview?.lines ?? []).map((line) => line.trim()).filter(Boolean);
  if (allLines.length === 0) return null;

  let meta: ArtifactPreviewMeta | null = null;
  const itemEntries: ArtifactPreviewItem[] = [];
  let detailRows: ArtifactPreviewDetailRow[] = [];
  const rawLines: string[] = [];

  for (const line of allLines) {
    const structuredMeta = parseStructuredPreviewMeta(line);
    if (structuredMeta) {
      meta = structuredMeta;
      continue;
    }

    const structuredItem = parseStructuredPreviewItem(line);
    if (structuredItem) {
      itemEntries.push(structuredItem);
      continue;
    }

    const detailRow = parsePreviewDetailRow(line);
    if (detailRow) {
      detailRows.push(detailRow);
      continue;
    }

    rawLines.push(line);
  }

  if (itemEntries.length === 0 && detailRows.length > 0) {
    const normalized = normalizeLegacyArtifactPreview(sym, meta, detailRows);
    if (normalized) {
      itemEntries.push(normalized.item);
      meta = mergeArtifactPreviewMeta(meta, normalized.meta);
      detailRows = normalized.remainingRows;
    }
  }

  const resolvedItemCount =
    meta?.pathCount ??
    (itemEntries.length > 0
      ? itemEntries.reduce((sum, entry) => sum + Math.max(1, entry.paths.length), 0)
      : null);
  const clusterUnitCount = resolvedItemCount ?? itemEntries.length;
  const clusterCandidate =
    meta?.mode === "cluster" ||
    isArtifactClusterSymbol(sym) ||
    clusterUnitCount > 1;
  const kind: ArtifactPreviewKind = clusterCandidate
    ? clusterUnitCount > 1
      ? "cluster"
      : "single"
    : meta?.mode === "single" || clusterUnitCount === 1 || itemEntries.length === 1
      ? "single"
      : "plain";
  const summaryItems = itemEntries
    .slice(0, PREVIEW_SUMMARY_ITEM_LIMIT)
    .map((entry) => summarizePreviewItem(entry));

  return {
    kind,
    allLines,
    meta,
    itemEntries,
    detailRows,
    rawLines,
    itemCount: resolvedItemCount,
    groupCount: kind === "cluster" ? meta?.groupCount ?? itemEntries.length : null,
    summaryItems: kind === "cluster" ? summaryItems : [],
  };
}

export function isArtifactClusterSymbol(symbol: ArtifactPreviewSource | undefined): boolean {
  if (!symbol) return false;
  return (
    symbol.id.startsWith("proc:artifact-cluster:") ||
    symbol.id.startsWith("proc:artgrp:") ||
    symbol.id.startsWith("proc:output:") ||
    symbol.tags?.includes("artifact-cluster") === true ||
    symbol.tags?.includes("artifact-group") === true
  );
}

export function buildArtifactPreviewMetaChips(preview: ArtifactPreviewData): string[] {
  return [
    preview.meta?.stageLabel
      ? `Phase: ${preview.meta.stageLabel}`
      : preview.meta?.stageId
        ? `Phase: ${humanizePreviewValue(preview.meta.stageId)}`
        : null,
    preview.meta?.category ? `Kategorie: ${humanizePreviewValue(preview.meta.category)}` : null,
    preview.meta?.flow
      ? `Rolle: ${humanizePreviewValue(preview.meta.flow)}`
      : preview.meta?.groupKind
        ? `Rolle: ${humanizePreviewValue(preview.meta.groupKind)}`
        : null,
    ...(preview.meta?.reviewHints ?? []).slice(0, 2).map((hint) => `Hinweis: ${hint}`),
  ].filter((entry): entry is string => Boolean(entry));
}

export function translateArtifactPreviewLabel(label: string): string {
  const normalized = label.trim().toLowerCase();
  switch (normalized) {
    case "focus":
      return "Wichtige Symbole";
    case "consumes":
      return "Nutzt";
    case "produces":
      return "Erzeugt";
    case "examples":
      return "Beispiele";
    case "example":
      return "Beispiel";
    case "paths":
      return "Pfade";
    case "producer":
      return "Erzeuger";
    case "consumer":
      return "Nutzer";
    case "producer stage":
      return "Erzeugt in";
    case "consumer stage":
      return "Genutzt in";
    default:
      return label;
  }
}

export function humanizePreviewValue(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (part) => part.toUpperCase());
}

function splitPreviewList(value: string): string[] {
  return value
    .split(/\s*,\s*/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry !== "-");
}

function normalizePreviewText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizePreviewNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizePreviewArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizePreviewText(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function parseStructuredPreviewMeta(line: string): ArtifactPreviewMeta | null {
  if (!line.startsWith(PREVIEW_META_PREFIX)) return null;

  try {
    const payload = JSON.parse(line.slice(PREVIEW_META_PREFIX.length)) as Record<string, unknown>;
    return {
      mode: payload.mode === "cluster" || payload.mode === "single" ? payload.mode : undefined,
      stageId: normalizePreviewText(payload.stageId),
      stageLabel: normalizePreviewText(payload.stageLabel),
      flow: normalizePreviewText(payload.flow),
      category: normalizePreviewText(payload.category),
      groupKind: normalizePreviewText(payload.groupKind),
      groupCount: normalizePreviewNumber(payload.groupCount) ?? undefined,
      pathCount: normalizePreviewNumber(payload.pathCount) ?? undefined,
      reviewHints: normalizePreviewArray(payload.reviewHints),
    };
  } catch {
    return null;
  }
}

function parseStructuredPreviewItem(line: string): ArtifactPreviewItem | null {
  if (!line.startsWith(PREVIEW_ITEM_PREFIX)) return null;

  try {
    const payload = JSON.parse(line.slice(PREVIEW_ITEM_PREFIX.length)) as Record<string, unknown>;
    const label = normalizePreviewText(payload.label);
    if (!label) return null;
    return {
      label,
      paths: normalizePreviewArray(payload.paths),
      artifactIds: normalizePreviewArray(payload.artifactIds),
      writeCount: normalizePreviewNumber(payload.writeCount),
      readCount: normalizePreviewNumber(payload.readCount),
      producerIds: normalizePreviewArray(payload.producerIds),
      consumerIds: normalizePreviewArray(payload.consumerIds),
      producers: normalizePreviewArray(payload.producers),
      consumers: normalizePreviewArray(payload.consumers),
      producerStages: normalizePreviewArray(payload.producerStages),
      consumerStages: normalizePreviewArray(payload.consumerStages),
      category: normalizePreviewText(payload.category),
      groupKind: normalizePreviewText(payload.groupKind),
      reviewHints: normalizePreviewArray(payload.reviewHints),
    };
  } catch {
    return null;
  }
}

function parsePreviewDetailRow(line: string): ArtifactPreviewDetailRow | null {
  const match = line.match(/^([^:]+):\s*(.+)$/);
  if (!match) return null;
  const [, label, value] = match;
  return {
    label: label.trim(),
    value: value.trim(),
    values: splitPreviewList(value),
  };
}

function summarizePreviewItem(item: ArtifactPreviewItem): string {
  return item.label.length > 48 ? `${item.label.slice(0, 45)}...` : item.label;
}

function normalizeLegacyArtifactPreview(
  sym: ArtifactPreviewSource,
  meta: ArtifactPreviewMeta | null,
  detailRows: ArtifactPreviewDetailRow[],
): {
  item: ArtifactPreviewItem;
  meta: Partial<ArtifactPreviewMeta>;
  remainingRows: ArtifactPreviewDetailRow[];
} | null {
  if (!isLegacyArtifactCandidate(sym, detailRows)) return null;

  const remainingRows: ArtifactPreviewDetailRow[] = [];
  let paths: string[] = [];
  let category = meta?.category;
  let producerLabels: string[] = [];
  let consumerLabels: string[] = [];
  let producerStages: string[] = [];
  let consumerStages: string[] = [];
  let stageLabel = meta?.stageLabel;
  let flow = meta?.flow;

  for (const row of detailRows) {
    const normalizedLabel = normalizePreviewDetailLabel(row.label);
    const values = row.values.length > 0 ? row.values : [row.value];

    switch (normalizedLabel) {
      case "pfade":
      case "paths":
        paths = values;
        break;
      case "kategorie":
      case "category":
        category = values[0] ?? category;
        break;
      case "erzeugtinstage":
      case "erzeugtin":
      case "producerstage":
      case "stage":
      case "phase":
        producerStages = values.map((value) => resolveProcessStageId(value) ?? value);
        stageLabel = values[0] ?? stageLabel;
        break;
      case "genutztinstage":
      case "genutztin":
      case "consumerstage":
        consumerStages = values.map((value) => resolveProcessStageId(value) ?? value);
        break;
      case "erzeuger":
      case "producer":
        producerLabels = values;
        break;
      case "nutzer":
      case "consumer":
        consumerLabels = values;
        break;
      case "rolle":
      case "role":
      case "flow":
        flow = values[0] ?? flow;
        break;
      default:
        remainingRows.push(row);
        break;
    }
  }

  const inferredGroupKind = meta?.groupKind ?? inferArtifactGroupKind(producerStages, consumerStages);
  const inferredStageLabel = stageLabel ?? producerStages[0];
  const inferredFlow =
    flow ??
    (inferredGroupKind === "output" && inferredStageLabel ? `Erzeugt in: ${inferredStageLabel}` : undefined);

  return {
    item: {
      label: sym.label ?? sym.id,
      paths,
      artifactIds: [sym.id],
      writeCount: null,
      readCount: null,
      producerIds: [],
      consumerIds: [],
      producers: producerLabels,
      consumers: consumerLabels,
      producerStages: uniquePreviewValues(producerStages),
      consumerStages: uniquePreviewValues(consumerStages),
      category,
      groupKind: inferredGroupKind,
      reviewHints: [],
    },
    meta: {
      mode: "single",
      stageLabel: inferredStageLabel,
      flow: inferredFlow,
      category,
      groupKind: inferredGroupKind,
    },
    remainingRows,
  };
}

function isLegacyArtifactCandidate(
  sym: ArtifactPreviewSource,
  detailRows: ArtifactPreviewDetailRow[],
): boolean {
  if (
    sym.id.startsWith("proc:artifact:") ||
    sym.id.startsWith("proc:input:") ||
    sym.id.startsWith("proc:output:") ||
    sym.kind === "external" ||
    sym.umlType === "artifact"
  ) {
    return true;
  }

  return detailRows.some((row) => {
    const normalizedLabel = normalizePreviewDetailLabel(row.label);
    return (
      normalizedLabel === "pfade" ||
      normalizedLabel === "paths" ||
      normalizedLabel === "kategorie" ||
      normalizedLabel === "category" ||
      normalizedLabel === "erzeugtin" ||
      normalizedLabel === "genutztin" ||
      normalizedLabel === "producerstage" ||
      normalizedLabel === "consumerstage"
    );
  });
}

function normalizePreviewDetailLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[\s_/-]+/g, "");
}

function inferArtifactGroupKind(
  producerStages: string[],
  consumerStages: string[],
): "input" | "handoff" | "output" | undefined {
  if (producerStages.length > 0 && consumerStages.length > 0) return "handoff";
  if (producerStages.length > 0) return "output";
  if (consumerStages.length > 0) return "input";
  return undefined;
}

function mergeArtifactPreviewMeta(
  current: ArtifactPreviewMeta | null,
  next: Partial<ArtifactPreviewMeta>,
): ArtifactPreviewMeta {
  return {
    ...current,
    ...next,
  };
}

function resolveProcessStageId(value: string): string | undefined {
  const normalized = normalizePreviewDetailLabel(value);
  if (normalized === "inputsources" || normalized === "input" || normalized === "inputs") return "inputs";
  if (normalized === "extraction&preprocessing" || normalized === "extractionpreprocessing" || normalized === "extract") {
    return "extract";
  }
  if (normalized === "transformation" || normalized === "transform") return "transform";
  if (normalized === "matching&filtering" || normalized === "matchingfiltering" || normalized === "match") {
    return "match";
  }
  if (
    normalized === "distribution/kde/persistence" ||
    normalized === "distributionkdepersistence" ||
    normalized === "distribution"
  ) {
    return "distribution";
  }
  if (normalized === "simulation") return "simulation";
  return undefined;
}

function uniquePreviewValues(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
