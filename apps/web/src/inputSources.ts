import type { ProjectGraph, Symbol as Sym } from "@dmpg/shared";

export const INPUT_SOURCES_VIEW_ID = "view:process-stage:inputs";

const PREVIEW_ITEM_PREFIX = "@item ";
const INPUT_SOURCE_NODE_PREFIX = "proc:input:";
const INPUT_STAGE_PACKAGE_ID = "proc:pkg:inputs";

interface PreviewItem {
  label: string;
  paths: string[];
  artifactIds: string[];
  category?: string;
}

export type InputSourceTreeSymbol = Sym & {
  treeKey: string;
  navigationSymbolId: string | null;
};

export function isInputSourcesViewId(viewId: string): boolean {
  return viewId === INPUT_SOURCES_VIEW_ID;
}

export function collectInputSourceTreeSymbols(graph: ProjectGraph): InputSourceTreeSymbol[] {
  const symbolsById = new Map(graph.symbols.map((symbol) => [symbol.id, symbol]));
  const entries: InputSourceTreeSymbol[] = [];
  const seen = new Set<string>();
  const seenSymbolIds = new Set<string>();

  const addSymbol = (symbol: Sym, label = symbol.label, keySuffix = label) => {
    if (symbol.id === INPUT_STAGE_PACKAGE_ID) return;
    if (seenSymbolIds.has(symbol.id)) return;
    const cleanLabel = label.trim() || symbol.label;
    const seenKey = `${symbol.id}|${cleanLabel}`;
    if (seen.has(seenKey)) return;
    seen.add(seenKey);
    seenSymbolIds.add(symbol.id);
    entries.push({
      ...symbol,
      label: cleanLabel,
      parentId: undefined,
      childViewId: undefined,
      treeKey: `input-source:${sanitizeTreeKey(symbol.id)}:${sanitizeTreeKey(keySuffix)}`,
      navigationSymbolId: symbol.id,
    });
  };

  const addVirtualItem = (item: PreviewItem, groupId: string) => {
    const cleanLabel = item.label.trim();
    if (!cleanLabel) return;
    const seenKey = `virtual|${cleanLabel}`;
    if (seen.has(seenKey)) return;
    seen.add(seenKey);
    entries.push({
      id: `virtual:input-source:${sanitizeTreeKey(groupId)}:${sanitizeTreeKey(cleanLabel)}`,
      label: cleanLabel,
      kind: "external",
      umlType: inputUmlTypeForCategory(item.category),
      treeKey: `input-source:virtual:${sanitizeTreeKey(groupId)}:${sanitizeTreeKey(cleanLabel)}`,
      navigationSymbolId: null,
      preview: item.paths.length > 0 ? { lines: item.paths } : undefined,
    });
  };

  const inputGroups = graph.symbols
    .filter((symbol) => symbol.id.startsWith(INPUT_SOURCE_NODE_PREFIX))
    .sort((left, right) => inputGroupOrder(left.id) - inputGroupOrder(right.id) || left.label.localeCompare(right.label));

  for (const group of inputGroups) {
    const items = parsePreviewItems(group.preview?.lines ?? []);
    if (items.length === 0) {
      addSymbol(group);
      continue;
    }

    for (const item of items) {
      const symbol = resolveInputItemSymbol(symbolsById, item);
      if (symbol) {
        addSymbol(symbol, item.label, `${group.id}:${item.label}`);
      } else {
        addVirtualItem(item, group.id);
      }
    }
  }

  const inputView = graph.views.find((view) => isInputSourcesViewId(view.id));
  for (const nodeRef of inputView?.nodeRefs ?? []) {
    const symbol = symbolsById.get(nodeRef);
    if (!symbol) continue;
    addSymbol(symbol);
  }

  return entries.sort((left, right) =>
    treeKindOrder(left.kind) - treeKindOrder(right.kind) ||
    left.label.localeCompare(right.label),
  );
}

function parsePreviewItems(lines: string[]): PreviewItem[] {
  const items: PreviewItem[] = [];
  for (const line of lines) {
    if (!line.startsWith(PREVIEW_ITEM_PREFIX)) continue;
    try {
      const payload = JSON.parse(line.slice(PREVIEW_ITEM_PREFIX.length)) as Record<string, unknown>;
      const label = typeof payload.label === "string" ? payload.label.trim() : "";
      if (!label) continue;
      items.push({
        label,
        paths: normalizeStringArray(payload.paths),
        artifactIds: normalizeStringArray(payload.artifactIds),
        category: typeof payload.category === "string" ? payload.category : undefined,
      });
    } catch {
      continue;
    }
  }
  return items;
}

function resolveInputItemSymbol(symbolsById: Map<string, Sym>, item: PreviewItem): Sym | null {
  for (const artifactId of item.artifactIds) {
    const symbol = symbolsById.get(artifactId);
    if (symbol) return symbol;
  }
  return null;
}

function inputUmlTypeForCategory(category: string | undefined): Sym["umlType"] {
  if (category === "source") return "component";
  if (category === "libraries-imports") return "component";
  return "artifact";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function inputGroupOrder(id: string): number {
  if (id.includes("database")) return 0;
  if (id.includes("file")) return 1;
  if (id.includes("external")) return 2;
  return 3;
}

function treeKindOrder(kind: Sym["kind"]): number {
  const order: Partial<Record<Sym["kind"], number>> = {
    external: 0,
    module: 1,
    class: 2,
    function: 3,
    method: 4,
    variable: 5,
    constant: 6,
  };
  return order[kind] ?? 9;
}

function sanitizeTreeKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9:_-]+/g, "_");
}
