import type { Symbol, Relation, DiagramView, RelationType } from "./schemas.js";

/**
 * A projected edge maps a relation onto the nearest visible ancestors
 * in a given view. This ensures edges are visible at every zoom level.
 */
export interface ProjectedEdge {
  /** Unique key for dedup */
  key: string;
  /** The representative source node (visible in the view) */
  source: string;
  /** The representative target node (visible in the view) */
  target: string;
  /** Primary relation type (most frequent) */
  type: RelationType;
  /** How many raw relations this projected edge aggregates */
  count: number;
  /** Display label */
  label: string;
  /** Original relation IDs that were aggregated */
  relationIds: string[];
  /** Min confidence across aggregated relations */
  confidence: number;
  /** Whether the edge is animated (calls) */
  animated: boolean;
  /** CSS class */
  className: string;
  /** Breakdown of relation types and their counts */
  typeCounts?: Record<string, number>;
}

/**
 * Build the parent-id chain index for fast ancestor lookups.
 */
function buildAncestorIndex(symbols: Symbol[]): Map<string, string[]> {
  const parentMap = new Map<string, string | undefined>();
  for (const s of symbols) {
    parentMap.set(s.id, s.parentId);
  }

  const cache = new Map<string, string[]>();

  function getAncestors(id: string): string[] {
    if (cache.has(id)) return cache.get(id)!;
    const chain: string[] = [id];
    let current = parentMap.get(id);
    let depth = 0;
    while (current && depth < 20) {
      chain.push(current);
      current = parentMap.get(current);
      depth++;
    }
    cache.set(id, chain);
    return chain;
  }

  // Pre-compute for all symbols
  for (const s of symbols) {
    getAncestors(s.id);
  }

  return cache;
}

/**
 * Find the nearest ancestor of `symbolId` that exists in `visibleIds`.
 * Returns the id if found, or null.
 */
function findNearestVisible(
  symbolId: string,
  visibleIds: Set<string>,
  ancestorIndex: Map<string, string[]>,
): string | null {
  const chain = ancestorIndex.get(symbolId);
  if (!chain) return null;
  for (const anc of chain) {
    if (visibleIds.has(anc)) return anc;
  }
  return null;
}

/**
 * Edge styling configuration per relation type.
 */
const EDGE_STYLE: Record<string, { animated: boolean; cssClass: string }> = {
  calls: { animated: true, cssClass: "edge-calls" },
  imports: { animated: false, cssClass: "edge-imports" },
  inherits: { animated: false, cssClass: "edge-inherits" },
  reads: { animated: true, cssClass: "edge-reads" },
  writes: { animated: true, cssClass: "edge-writes" },
  instantiates: { animated: true, cssClass: "edge-instantiates" },
  uses_config: { animated: true, cssClass: "edge-uses-config" },
  contains: { animated: false, cssClass: "edge-contains" },
};

/**
 * Project all relations in the graph onto a specific view.
 *
 * For each relation, find the nearest visible ancestor of source and target
 * in the view's nodeRefs. If both are found and different, produce a
 * projected edge. Aggregate duplicates by (source, target, type).
 *
 * This replaces the old strict "endpoints must be in view" filtering
 * and the shallow crossEdges mechanism.
 */
export function projectEdgesForView(
  view: DiagramView,
  allSymbols: Symbol[],
  allRelations: Relation[],
): ProjectedEdge[] {
  const visibleIds = new Set(view.nodeRefs);
  const ancestorIndex = buildAncestorIndex(allSymbols);
  const symbolMap = new Map(allSymbols.map((s) => [s.id, s]));

  // Relation-type → human-readable verb
  const TYPE_VERBS: Record<string, string> = {
    calls: "calls",
    imports: "imports",
    reads: "reads",
    writes: "writes to",
    inherits: "inherits",
    instantiates: "creates",
    uses_config: "config",
  };

  // Aggregation map: "source|target" → aggregated edge data
  // Cross-type bundling: all relation types between same endpoints become one edge
  const edgeMap = new Map<string, {
    source: string;
    target: string;
    count: number;
    relationIds: string[];
    confidence: number;
    typeCounts: Record<string, number>;
  }>();

  for (const rel of allRelations) {
    // Skip contains edges — they define hierarchy, not shown as regular edges
    if (rel.type === "contains") continue;

    const srcRep = findNearestVisible(rel.source, visibleIds, ancestorIndex);
    const tgtRep = findNearestVisible(rel.target, visibleIds, ancestorIndex);

    // Both endpoints must resolve to visible nodes, and not be the same node
    if (!srcRep || !tgtRep || srcRep === tgtRep) continue;

    const key = `${srcRep}|${tgtRep}`;
    const confidence = rel.confidence ?? 1;

    if (edgeMap.has(key)) {
      const existing = edgeMap.get(key)!;
      existing.count += 1;
      existing.relationIds.push(rel.id);
      existing.confidence = Math.min(existing.confidence, confidence);
      existing.typeCounts[rel.type] = (existing.typeCounts[rel.type] ?? 0) + 1;
    } else {
      edgeMap.set(key, {
        source: srcRep,
        target: tgtRep,
        count: 1,
        relationIds: [rel.id],
        confidence,
        typeCounts: { [rel.type]: 1 },
      });
    }
  }

  // Build final projected edges with aggregated labels
  const result: ProjectedEdge[] = [];
  for (const [key, agg] of edgeMap) {
    // Find dominant type (most frequent)
    let dominantType = "calls" as RelationType;
    let maxCount = 0;
    for (const [t, c] of Object.entries(agg.typeCounts)) {
      if (c > maxCount) { maxCount = c; dominantType = t as RelationType; }
    }

    // Build label: for single relation show descriptive label, for multiple show type counts
    let label: string;
    const typeEntries = Object.entries(agg.typeCounts);
    if (agg.count === 1) {
      // Single relation — show descriptive label
      const rel = allRelations.find((r) => r.id === agg.relationIds[0]);
      const srcSym = symbolMap.get(rel?.source ?? "");
      const tgtSym = symbolMap.get(rel?.target ?? "");
      const verb = TYPE_VERBS[dominantType] ?? dominantType;
      const srcIsProxy = rel?.source !== agg.source;
      const tgtIsProxy = rel?.target !== agg.target;

      if (srcIsProxy && tgtIsProxy) {
        label = `${verb}: ${shortName(srcSym?.label ?? "")}→${shortName(tgtSym?.label ?? "")}`;
      } else if (tgtSym?.kind === "external") {
        label = `${verb} ${shortName(tgtSym.label)}`;
      } else if (srcSym?.kind === "external") {
        label = `${shortName(srcSym.label)} → ${verb}`;
      } else {
        label = rel?.label ?? verb;
      }
    } else if (typeEntries.length === 1) {
      // Multiple relations but same type
      const verb = TYPE_VERBS[dominantType] ?? dominantType;
      label = `${agg.count}× ${verb}`;
    } else {
      // Multiple types — show compact summary: "3× calls, 2× reads"
      label = typeEntries
        .sort(([, a], [, b]) => b - a)
        .map(([t, c]) => `${c}× ${TYPE_VERBS[t] ?? t}`)
        .join(", ");
    }

    // Animated if any type is animated
    const animated = Object.keys(agg.typeCounts).some((t) => EDGE_STYLE[t]?.animated);

    // CSS class: use dominant type, add edge-multi if >1 types
    const dominantStyle = EDGE_STYLE[dominantType] ?? { cssClass: "edge-default" };
    const multiClass = typeEntries.length > 1 ? " edge-multi" : "";
    const lowConf = agg.confidence < 0.9 ? " edge-low-confidence" : "";
    const className = `${dominantStyle.cssClass}${multiClass}${lowConf}`;

    result.push({
      key,
      source: agg.source,
      target: agg.target,
      type: dominantType,
      count: agg.count,
      label,
      relationIds: agg.relationIds,
      confidence: agg.confidence,
      animated,
      className,
      typeCounts: agg.typeCounts,
    });
  }

  return result;
}

/** Shorten a label to its last meaningful segment */
function shortName(label: string): string {
  const parts = label.split(".");
  return parts[parts.length - 1] ?? label;
}
