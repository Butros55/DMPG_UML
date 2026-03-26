import type { ProjectGraph, Relation, Symbol as Sym } from "@dmpg/shared";

import { collectNavigableSymbolIds, resolveNavigableSymbolId } from "./viewNavigation";

export interface NavigableRelationItem {
  symbolId: string;
  symbol: Sym;
  relations: Relation[];
  aiRelationIds: string[];
}

export function buildNavigableRelationItems(
  graph: ProjectGraph | null,
  relations: Relation[],
  direction: "out" | "in",
): NavigableRelationItem[] {
  if (!graph || relations.length === 0) return [];

  const navigableIds = collectNavigableSymbolIds(graph);
  const symbolMap = new Map(graph.symbols.map((symbol) => [symbol.id, symbol]));
  const grouped = new Map<string, NavigableRelationItem>();

  for (const relation of relations) {
    const rawOtherId = direction === "out" ? relation.target : relation.source;
    const resolvedId = resolveNavigableSymbolId(graph, rawOtherId);
    if (!resolvedId || !navigableIds.has(resolvedId)) continue;

    const symbol = symbolMap.get(resolvedId);
    if (!symbol) continue;

    const existing = grouped.get(resolvedId);
    if (existing) {
      existing.relations.push(relation);
      if (relation.aiGenerated) {
        existing.aiRelationIds.push(relation.id);
      }
      continue;
    }

    grouped.set(resolvedId, {
      symbolId: resolvedId,
      symbol,
      relations: [relation],
      aiRelationIds: relation.aiGenerated ? [relation.id] : [],
    });
  }

  return Array.from(grouped.values()).sort((left, right) =>
    left.symbol.label.localeCompare(right.symbol.label),
  );
}
