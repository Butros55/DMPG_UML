import ELK, {
  type ElkNode,
  type ElkExtendedEdge,
  type ElkEdgeSection,
  type ElkPoint,
} from "elkjs/lib/elk.bundled.js";
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

export interface EdgeRoutePoint {
  x: number;
  y: number;
}

export interface EdgeRoute {
  points: EdgeRoutePoint[];
  labelX: number;
  labelY: number;
}

export interface LayoutResult {
  nodes: Node[];
  /** Port positions per node, keyed by node ID */
  portsByNode: Map<string, PortInfo[]>;
  /** Edge handle mapping: edgeId → { sourceHandle, targetHandle } */
  edgeHandles: Map<string, { sourceHandle: string; targetHandle: string }>;
  /** Routed edge geometry from ELK, keyed by edge ID */
  routesByEdge: Map<string, EdgeRoute>;
}

type PortDefinition = {
  elkId: string;
  handleId: string;
  side: PortInfo["side"];
  portType: "source" | "target";
};

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

  // If already measured by React Flow, prefer the measured dimensions.
  // No extra padding — ELK's node-node spacing handles overlap prevention,
  // and padding would shift port positions off-center relative to the visual node.
  if (node.measured?.width && node.measured?.height) {
    return {
      width: node.measured.width as number,
      height: node.measured.height as number,
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

function appendUniquePoint(points: EdgeRoutePoint[], point: ElkPoint) {
  const last = points[points.length - 1];
  if (last && Math.abs(last.x - point.x) < 0.5 && Math.abs(last.y - point.y) < 0.5) {
    return;
  }

  points.push({ x: point.x, y: point.y });
}

function orderedSections(sections: ElkEdgeSection[]): ElkEdgeSection[] {
  if (sections.length <= 1) return sections;

  const byId = new Map(sections.map((section) => [section.id, section]));
  const start =
    sections.find((section) => (section.incomingSections?.length ?? 0) === 0) ??
    sections[0];
  const ordered: ElkEdgeSection[] = [];
  const visited = new Set<string>();
  let current: ElkEdgeSection | undefined = start;

  while (current && !visited.has(current.id)) {
    ordered.push(current);
    visited.add(current.id);
    const nextId: string | undefined = current.outgoingSections?.find(
      (sectionId) => !visited.has(sectionId),
    );
    current = nextId ? byId.get(nextId) : undefined;
  }

  for (const section of sections) {
    if (!visited.has(section.id)) {
      ordered.push(section);
    }
  }

  return ordered;
}

function midpointAlongRoute(points: EdgeRoutePoint[]): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];

  let totalLength = 0;
  const segmentLengths: number[] = [];

  for (let index = 1; index < points.length; index += 1) {
    const dx = points[index].x - points[index - 1].x;
    const dy = points[index].y - points[index - 1].y;
    const length = Math.hypot(dx, dy);
    segmentLengths.push(length);
    totalLength += length;
  }

  if (totalLength < 0.5) {
    return points[Math.floor(points.length / 2)] ?? points[0];
  }

  const targetLength = totalLength / 2;
  let traversed = 0;

  for (let index = 1; index < points.length; index += 1) {
    const segmentLength = segmentLengths[index - 1] ?? 0;
    if (traversed + segmentLength >= targetLength && segmentLength > 0) {
      const ratio = (targetLength - traversed) / segmentLength;
      return {
        x: points[index - 1].x + (points[index].x - points[index - 1].x) * ratio,
        y: points[index - 1].y + (points[index].y - points[index - 1].y) * ratio,
      };
    }
    traversed += segmentLength;
  }

  return points[points.length - 1] ?? points[0];
}

function buildEdgeRoute(edge: ElkExtendedEdge): EdgeRoute | null {
  const sections = edge.sections ? orderedSections(edge.sections) : [];
  if (sections.length === 0) return null;

  const points: EdgeRoutePoint[] = [];
  for (const section of sections) {
    appendUniquePoint(points, section.startPoint);
    for (const bendPoint of section.bendPoints ?? []) {
      appendUniquePoint(points, bendPoint);
    }
    appendUniquePoint(points, section.endPoint);
  }

  if (points.length < 2) return null;

  const labelPoint = midpointAlongRoute(points);
  return {
    points,
    labelX: labelPoint.x,
    labelY: labelPoint.y,
  };
}

function relationPortSides(relationType: string): { sourceSide: PortInfo["side"]; targetSide: PortInfo["side"] } {
  if (relationType === "imports") {
    return { sourceSide: "NORTH", targetSide: "WEST" };
  }
  if (relationType === "reads" || relationType === "writes") {
    return { sourceSide: "SOUTH", targetSide: "SOUTH" };
  }
  return { sourceSide: "EAST", targetSide: "WEST" };
}

function buildPortAssignments(
  nodes: Node[],
  edges: Edge[],
): {
  sortedEdges: Edge[];
  nodePortDefs: Map<string, PortDefinition[]>;
  edgeHandleMap: Map<string, { sourceHandle: string; targetHandle: string }>;
} {
  const nodeIdSet = new Set(nodes.map((n) => n.id));
  const srcCounts = new Map<string, Map<PortInfo["side"], number>>();
  const tgtCounts = new Map<string, Map<PortInfo["side"], number>>();
  const nodePortDefs = new Map<string, PortDefinition[]>();

  for (const node of nodes) {
    srcCounts.set(node.id, new Map());
    tgtCounts.set(node.id, new Map());
    nodePortDefs.set(node.id, []);
  }

  const validEdges = edges.filter((edge) => nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target));
  const sortedEdges = [...validEdges].sort((a, b) => {
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    if (a.target !== b.target) return a.target.localeCompare(b.target);
    const aType = (a.data as { relationType?: string } | undefined)?.relationType ?? "calls";
    const bType = (b.data as { relationType?: string } | undefined)?.relationType ?? "calls";
    if (aType !== bType) return aType.localeCompare(bType);
    return a.id.localeCompare(b.id);
  });

  const edgeHandleMap = new Map<string, { sourceHandle: string; targetHandle: string }>();

  for (const edge of sortedEdges) {
    const relationType = (edge.data as { relationType?: string } | undefined)?.relationType ?? "calls";
    const { sourceSide, targetSide } = relationPortSides(relationType);

    const srcSideCounts = srcCounts.get(edge.source)!;
    const srcIndex = srcSideCounts.get(sourceSide) ?? 0;
    srcSideCounts.set(sourceSide, srcIndex + 1);

    const tgtSideCounts = tgtCounts.get(edge.target)!;
    const tgtIndex = tgtSideCounts.get(targetSide) ?? 0;
    tgtSideCounts.set(targetSide, tgtIndex + 1);

    const sourceHandle = `src-${sourceSide.toLowerCase()}-${srcIndex}`;
    const targetHandle = `tgt-${targetSide.toLowerCase()}-${tgtIndex}`;

    nodePortDefs.get(edge.source)!.push({
      elkId: `${edge.source}:${sourceHandle}`,
      handleId: sourceHandle,
      side: sourceSide,
      portType: "source",
    });
    nodePortDefs.get(edge.target)!.push({
      elkId: `${edge.target}:${targetHandle}`,
      handleId: targetHandle,
      side: targetSide,
      portType: "target",
    });

    edgeHandleMap.set(edge.id, { sourceHandle, targetHandle });
  }

  return { sortedEdges, nodePortDefs, edgeHandleMap };
}

function distributeOffset(index: number, total: number, span: number, inset: number): number {
  if (total <= 1) return span / 2;
  const usable = Math.max(0, span - inset * 2);
  const preferredGap = Math.min(20, Math.max(12, usable / Math.max(total + 1, 4)));
  const clusterWidth = Math.min(usable, preferredGap * Math.max(0, total - 1));
  const start = (span - clusterWidth) / 2;
  return start + clusterWidth * (index / Math.max(1, total - 1));
}

function fallbackPortCoordinates(
  side: PortInfo["side"],
  index: number,
  total: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const horizontalInset = Math.min(32, Math.max(16, width * 0.14));
  const verticalInset = Math.min(28, Math.max(14, height * 0.18));

  switch (side) {
    case "NORTH":
      return { x: distributeOffset(index, total, width, horizontalInset), y: 0 };
    case "SOUTH":
      return { x: distributeOffset(index, total, width, horizontalInset), y: height };
    case "EAST":
      return { x: width, y: distributeOffset(index, total, height, verticalInset) };
    case "WEST":
      return { x: 0, y: distributeOffset(index, total, height, verticalInset) };
    default:
      return { x: width / 2, y: height };
  }
}

export function buildFallbackPorts(
  nodes: Node[],
  edges: Edge[],
  compactMode = false,
): Pick<LayoutResult, "portsByNode" | "edgeHandles"> {
  const { nodePortDefs, edgeHandleMap } = buildPortAssignments(nodes, edges);
  const portsByNode = new Map<string, PortInfo[]>();

  for (const node of nodes) {
    const defs = nodePortDefs.get(node.id) ?? [];
    if (defs.length === 0) {
      portsByNode.set(node.id, []);
      continue;
    }

    const { width, height } = estimateNodeSize(node, compactMode);
    const defsBySide = new Map<PortInfo["side"], PortDefinition[]>();
    for (const def of defs) {
      const entries = defsBySide.get(def.side) ?? [];
      entries.push(def);
      defsBySide.set(def.side, entries);
    }

    const ports: PortInfo[] = [];
    for (const defsForSide of defsBySide.values()) {
      defsForSide.forEach((def, index) => {
        const coords = fallbackPortCoordinates(def.side, index, defsForSide.length, width, height);
        ports.push({
          id: def.handleId,
          x: coords.x,
          y: coords.y,
          side: def.side,
          type: def.portType,
        });
      });
    }

    portsByNode.set(node.id, ports);
  }

  return { portsByNode, edgeHandles: edgeHandleMap };
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

  const { sortedEdges, nodePortDefs, edgeHandleMap } = buildPortAssignments(nodes, edges);

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
      "elk.portAlignment.default": "CENTER",
      "elk.edgeRouting": settings.routing,
      "elk.layered.mergeEdges": settings.mergeEdges ? "true" : "false",
      "elk.layered.spacing.edgeNodeBetweenLayers": `${settings.edgeNodeSpacing}`,
      "elk.layered.spacing.edgeEdgeBetweenLayers": `${settings.edgeEdgeSpacing}`,
      "elk.spacing.edgeNode": `${settings.edgeNodeSpacing}`,
      "elk.spacing.edgeEdge": `${settings.edgeEdgeSpacing}`,
      "elk.spacing.portPort": `${Math.max(12, Math.round(settings.edgeEdgeSpacing * 0.6))}`,
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
  const routesByEdge = new Map<string, EdgeRoute>();

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

  for (const layoutEdge of layout.edges ?? []) {
    const route = buildEdgeRoute(layoutEdge);
    if (route) {
      routesByEdge.set(layoutEdge.id, route);
    }
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

  return { nodes: positionedNodes, portsByNode, edgeHandles: edgeHandleMap, routesByEdge };
}
