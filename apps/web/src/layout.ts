import ELK, { type ElkNode, type ElkExtendedEdge } from "elkjs/lib/elk.bundled.js";
import type { Node, Edge } from "@xyflow/react";
import {
  DEFAULT_DIAGRAM_LAYOUT_SETTINGS,
  type DiagramLayoutSettings,
} from "./diagramSettings";

const elk = new ELK();

const DEFAULT_WIDTH = 200;

/* ── Dynamic port types for per-edge handle assignment ──────── */

export interface PortInfo {
  /** Handle ID (e.g. "src-east-0") — used as React Flow Handle id */
  id: string;
  /** X offset from node top-left (from ELK) */
  x: number;
  /** Y offset from node top-left (from ELK) */
  y: number;
  /** Port side on the node boundary */
  side: "NORTH" | "SOUTH" | "EAST" | "WEST";
  /** Whether this port is a source or target connection */
  type: "source" | "target";
}

export interface LayoutResult {
  nodes: Node[];
  /** Port positions per node, keyed by node ID */
  portsByNode: Map<string, PortInfo[]>;
  /** Edge handle mapping: edgeId → { sourceHandle, targetHandle } */
  edgeHandles: Map<string, { sourceHandle: string; targetHandle: string }>;
}

/* ── Dynamic node sizing based on content ──────── */
const LINE_HEIGHT = 20;
const HEADER_HEIGHT = 40;
const COMPARTMENT_PADDING = 14;
const MIN_HEIGHT = 48;
const CHAR_WIDTH = 8.5; // average char width at 13px font

function estimateNodeSize(node: Node, compactMode: boolean): { width: number; height: number } {
  const data = node.data as Record<string, unknown>;
  const kind = (data.kind as string) ?? "";
  const children = (data.children as unknown[]) ?? [];
  const label = (data.label as string) ?? "";

  // If already measured by React Flow, prefer that (with a small guard padding).
  if (node.measured?.width && node.measured?.height) {
    return {
      width: (node.measured.width as number) + (compactMode ? 4 : 8),
      height: (node.measured.height as number) + (compactMode ? 2 : 4),
    };
  }

  // UML class nodes: header + attributes compartment + methods compartment.
  if (node.type === "umlClass" || kind === "class") {
    const attrs = children.filter((c: any) => c.kind === "constant" || c.kind === "variable");
    const methods = children.filter((c: any) => c.kind === "method" || c.kind === "function");
    const visibleAttrs = compactMode ? attrs.slice(0, 4) : attrs;
    const visibleMethods = compactMode ? methods.slice(0, 5) : methods;

    const h =
      HEADER_HEIGHT +
      (compactMode ? 8 : COMPARTMENT_PADDING) + Math.max(1, visibleAttrs.length) * (compactMode ? 16 : LINE_HEIGHT) +
      (compactMode ? 8 : COMPARTMENT_PADDING) + Math.max(1, visibleMethods.length) * (compactMode ? 16 : LINE_HEIGHT) +
      (data.childViewId ? (compactMode ? 22 : 28) : 0) +
      (compactMode ? 4 : 8);

    const maxLabelLen = Math.max(
      label.length,
      ...[...visibleAttrs, ...visibleMethods].map((c: any) => (c.label?.length ?? 0) + 6),
    );

    return {
      width: Math.max(compactMode ? 210 : 240, maxLabelLen * CHAR_WIDTH + (compactMode ? 34 : 48)),
      height: Math.max(compactMode ? 44 : MIN_HEIGHT, h),
    };
  }

  // Function/method nodes.
  if (node.type === "umlFunction" || kind === "method" || kind === "function") {
    const inputs = (data.inputs as unknown[]) ?? [];
    const h = HEADER_HEIGHT + (inputs.length > 0 ? (compactMode ? 16 : 22) : 0) + (compactMode ? 4 : 8);
    const labelPart = label.split(".").pop() ?? label;
    return {
      width: Math.max(compactMode ? 160 : 180, labelPart.length * CHAR_WIDTH + (compactMode ? 48 : 60)),
      height: Math.max(compactMode ? 44 : MIN_HEIGHT, h),
    };
  }

  // Group nodes.
  if (node.type === "umlGroup" || kind === "group" || kind === "module") {
    return {
      width: Math.max(compactMode ? 190 : 220, label.length * CHAR_WIDTH + (compactMode ? 34 : 48)),
      height: compactMode ? 56 : 66,
    };
  }

  // Artifact/external — label can be long paths.
  if (node.type === "umlArtifact" || kind === "external") {
    const shortLabel = label.split("/").pop() ?? label;
    return {
      width: Math.max(compactMode ? 145 : 160, shortLabel.length * CHAR_WIDTH + (compactMode ? 44 : 56)),
      height: compactMode ? 46 : 52,
    };
  }

  return {
    width: Math.max(compactMode ? 170 : DEFAULT_WIDTH, label.length * CHAR_WIDTH + (compactMode ? 30 : 40)),
    height: compactMode ? 52 : 60,
  };
}

export async function layoutNodes(
  nodes: Node[],
  edges: Edge[],
  layoutSettings: DiagramLayoutSettings = DEFAULT_DIAGRAM_LAYOUT_SETTINGS,
  compactMode = false,
): Promise<LayoutResult> {
  const settings = {
    ...DEFAULT_DIAGRAM_LAYOUT_SETTINGS,
    ...layoutSettings,
  } satisfies DiagramLayoutSettings;

  const nodeIdSet = new Set(nodes.map((n) => n.id));

  /* ── Build per-edge dynamic ports ────────────────────────────── */
  // Count ports per node per side for sequential naming
  const srcCounts = new Map<string, Map<string, number>>(); // nodeId → side → count
  const tgtCounts = new Map<string, Map<string, number>>();
  for (const n of nodes) {
    srcCounts.set(n.id, new Map());
    tgtCounts.set(n.id, new Map());
  }

  // Collect per-node port definitions and per-edge handle mapping
  const nodePortDefs = new Map<string, Array<{ elkId: string; handleId: string; side: string; portType: "source" | "target" }>>();
  for (const n of nodes) {
    nodePortDefs.set(n.id, []);
  }

  const edgeHandleMap = new Map<string, { sourceHandle: string; targetHandle: string }>();

  // Filter to valid edges (both endpoints present)
  const validEdges = edges.filter((e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target));

  // Sort edges deterministically so port ordering is stable across layout passes
  const sortedEdges = [...validEdges].sort((a, b) => {
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    if (a.target !== b.target) return a.target.localeCompare(b.target);
    const aType = (a.data as { relationType?: string } | undefined)?.relationType ?? "calls";
    const bType = (b.data as { relationType?: string } | undefined)?.relationType ?? "calls";
    return aType.localeCompare(bType);
  });

  for (const e of sortedEdges) {
    const relType = (e.data as { relationType?: string } | undefined)?.relationType ?? "calls";

    // Determine port sides based on relation type
    const srcSide = relType === "imports" ? "NORTH"
      : (relType === "reads" || relType === "writes") ? "SOUTH"
        : "EAST";
    const tgtSide = relType === "imports" ? "WEST"
      : (relType === "reads" || relType === "writes") ? "SOUTH"
        : "WEST";

    // Generate sequential handle IDs per side
    const srcSideCounts = srcCounts.get(e.source)!;
    const srcIdx = srcSideCounts.get(srcSide) ?? 0;
    srcSideCounts.set(srcSide, srcIdx + 1);

    const tgtSideCounts = tgtCounts.get(e.target)!;
    const tgtIdx = tgtSideCounts.get(tgtSide) ?? 0;
    tgtSideCounts.set(tgtSide, tgtIdx + 1);

    const srcHandleId = `src-${srcSide.toLowerCase()}-${srcIdx}`;
    const tgtHandleId = `tgt-${tgtSide.toLowerCase()}-${tgtIdx}`;

    // ELK port IDs are globally unique (prefixed with nodeId)
    const srcElkId = `${e.source}:${srcHandleId}`;
    const tgtElkId = `${e.target}:${tgtHandleId}`;

    nodePortDefs.get(e.source)!.push({ elkId: srcElkId, handleId: srcHandleId, side: srcSide, portType: "source" });
    nodePortDefs.get(e.target)!.push({ elkId: tgtElkId, handleId: tgtHandleId, side: tgtSide, portType: "target" });

    edgeHandleMap.set(e.id, { sourceHandle: srcHandleId, targetHandle: tgtHandleId });
  }

  /* ── Build ELK graph with dynamic ports ─────────────────────── */
  const elkNodes: ElkNode[] = nodes.map((n) => {
    const size = estimateNodeSize(n, compactMode);
    const ports = nodePortDefs.get(n.id) ?? [];

    return {
      id: n.id,
      width: size.width,
      height: size.height,
      layoutOptions: {
        "elk.portConstraints": "FIXED_SIDE",
      },
      ports: ports.map((p) => ({
        id: p.elkId,
        layoutOptions: { "elk.port.side": p.side },
      })),
    };
  });

  const elkEdges: ElkExtendedEdge[] = sortedEdges.map((e) => {
    const handles = edgeHandleMap.get(e.id)!;
    return {
      id: e.id,
      sources: [e.source],
      targets: [e.target],
      sourcePort: `${e.source}:${handles.sourceHandle}`,
      targetPort: `${e.target}:${handles.targetHandle}`,
    };
  });

  const layout = await elk.layout({
    id: "root",
    children: elkNodes,
    edges: elkEdges,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": settings.direction,
      "elk.spacing.nodeNode": `${settings.nodeNodeSpacing}`,
      "elk.layered.spacing.nodeNodeBetweenLayers": `${settings.betweenLayersSpacing}`,
      "elk.padding": "[top=60,left=60,bottom=60,right=60]",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.crossingMinimization.greedySwitch.type": "TWO_SIDED",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.compaction.postCompaction.strategy": "EDGE_LENGTH",
      "elk.portConstraints": "FIXED_SIDE",
      "elk.edgeRouting": settings.routing,
      "elk.layered.mergeEdges": settings.mergeEdges ? "true" : "false",
      "elk.layered.spacing.edgeNodeBetweenLayers": `${settings.edgeNodeSpacing}`,
      "elk.layered.spacing.edgeEdgeBetweenLayers": `${settings.edgeEdgeSpacing}`,
      "elk.spacing.edgeNode": `${settings.edgeNodeSpacing}`,
      "elk.spacing.edgeEdge": `${settings.edgeEdgeSpacing}`,
      "elk.separateConnectedComponents": "true",
      "elk.spacing.componentComponent": `${settings.componentComponentSpacing}`,
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.edgeRouting.selfLoopDistribution": "EQUALLY",
      "elk.layered.wrapping.strategy": nodes.length > 80 ? "MULTI_EDGE" : "OFF",
      "elk.layered.thoroughness": `${settings.thoroughness}`,
    },
  });

  /* ── Extract port positions from ELK output ─────────────────── */
  const portsByNode = new Map<string, PortInfo[]>();

  for (const layoutNode of layout.children ?? []) {
    const ports: PortInfo[] = [];
    for (const port of layoutNode.ports ?? []) {
      // Port ID is "nodeId:handleId" — extract the handleId part
      const colonIdx = port.id.indexOf(":");
      const handleId = colonIdx >= 0 ? port.id.substring(colonIdx + 1) : port.id;
      const portType = handleId.startsWith("src-") ? "source" as const : "target" as const;

      // Determine side from the handle ID name
      let side: PortInfo["side"] = "EAST";
      const lower = handleId.toLowerCase();
      if (lower.includes("north")) side = "NORTH";
      else if (lower.includes("south")) side = "SOUTH";
      else if (lower.includes("east")) side = "EAST";
      else if (lower.includes("west")) side = "WEST";

      ports.push({
        id: handleId,
        x: port.x ?? 0,
        y: port.y ?? 0,
        side,
        type: portType,
      });
    }
    portsByNode.set(layoutNode.id, ports);
  }

  /* ── Build positioned nodes ─────────────────────────────────── */
  const positionedNodes = nodes.map((n) => {
    const layoutNode = layout.children?.find((c) => c.id === n.id);
    return {
      ...n,
      position: {
        x: layoutNode?.x ?? n.position.x,
        y: layoutNode?.y ?? n.position.y,
      },
    };
  });

  return { nodes: positionedNodes, portsByNode, edgeHandles: edgeHandleMap };
}
