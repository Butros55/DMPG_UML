import ELK, { type ElkNode, type ElkExtendedEdge } from "elkjs/lib/elk.bundled.js";
import type { Node, Edge } from "@xyflow/react";

const elk = new ELK();

const DEFAULT_WIDTH = 200;
const DEFAULT_HEIGHT = 80;

/* ── Dynamic node sizing based on content ──────── */
const LINE_HEIGHT = 20;
const HEADER_HEIGHT = 40;
const COMPARTMENT_PADDING = 14;
const MIN_HEIGHT = 48;
const CHAR_WIDTH = 8.5; // average char width at 13px font

function estimateNodeSize(node: Node): { width: number; height: number } {
  const data = node.data as Record<string, unknown>;
  const kind = (data.kind as string) ?? "";
  const children = (data.children as unknown[]) ?? [];
  const label = (data.label as string) ?? "";

  // If already measured by React Flow, prefer that (with padding for safety)
  if (node.measured?.width && node.measured?.height) {
    return {
      width: (node.measured.width as number) + 8,
      height: (node.measured.height as number) + 4,
    };
  }

  // UML class nodes: header + attributes compartment + methods compartment
  if (node.type === "umlClass" || kind === "class") {
    const attrs = children.filter((c: any) => c.kind === "constant" || c.kind === "variable");
    const methods = children.filter((c: any) => c.kind === "method" || c.kind === "function");
    const h =
      HEADER_HEIGHT +
      COMPARTMENT_PADDING + Math.max(1, attrs.length) * LINE_HEIGHT +
      COMPARTMENT_PADDING + Math.max(1, methods.length) * LINE_HEIGHT +
      (data.childViewId ? 28 : 0) + 8;
    const maxLabelLen = Math.max(
      label.length,
      ...children.map((c: any) => (c.label?.length ?? 0) + 6),
    );
    return { width: Math.max(240, maxLabelLen * CHAR_WIDTH + 48), height: Math.max(MIN_HEIGHT, h) };
  }

  // Function/method nodes
  if (node.type === "umlFunction" || kind === "method" || kind === "function") {
    const inputs = (data.inputs as unknown[]) ?? [];
    const h = HEADER_HEIGHT + (inputs.length > 0 ? 22 : 0) + 8;
    const labelPart = label.split(".").pop() ?? label;
    return { width: Math.max(180, labelPart.length * CHAR_WIDTH + 60), height: Math.max(MIN_HEIGHT, h) };
  }

  // Group nodes
  if (node.type === "umlGroup" || kind === "group" || kind === "module") {
    return { width: Math.max(220, label.length * CHAR_WIDTH + 48), height: 66 };
  }

  // Artifact/external — label can be long paths
  if (node.type === "umlArtifact" || kind === "external") {
    const shortLabel = label.split("/").pop() ?? label;
    return { width: Math.max(160, shortLabel.length * CHAR_WIDTH + 56), height: 52 };
  }

  return { width: Math.max(DEFAULT_WIDTH, label.length * CHAR_WIDTH + 40), height: 60 };
}

export async function layoutNodes(
  nodes: Node[],
  edges: Edge[],
  direction: "DOWN" | "RIGHT" = "DOWN",
): Promise<Node[]> {
  const elkNodes: ElkNode[] = nodes.map((n) => {
    const size = estimateNodeSize(n);
    return {
      id: n.id,
      width: size.width,
      height: size.height,
      layoutOptions: {
        "elk.portConstraints": "FIXED_ORDER",
      },
      ports: [
        { id: `${n.id}:in-north`, layoutOptions: { "elk.port.side": "NORTH" } },
        { id: `${n.id}:in-south`, layoutOptions: { "elk.port.side": "SOUTH" } },
        { id: `${n.id}:in-west`, layoutOptions: { "elk.port.side": "WEST" } },
        { id: `${n.id}:out-east`, layoutOptions: { "elk.port.side": "EAST" } },
        { id: `${n.id}:out-south`, layoutOptions: { "elk.port.side": "SOUTH" } },
      ],
    };
  });

  const elkEdges: ElkExtendedEdge[] = edges
    .filter((e) => nodes.some((n) => n.id === e.source) && nodes.some((n) => n.id === e.target))
    .map((e) => {
      const relType = (e.data as { relationType?: string } | undefined)?.relationType ?? "calls";
      const sourcePort = relType === "imports"
        ? `${e.source}:in-north`
        : relType === "reads" || relType === "writes"
          ? `${e.source}:out-south`
          : `${e.source}:out-east`;
      const targetPort = relType === "imports"
        ? `${e.target}:in-west`
        : relType === "reads" || relType === "writes"
          ? `${e.target}:in-south`
          : `${e.target}:in-west`;

      return {
        id: e.id,
        sources: [e.source],
        targets: [e.target],
        sourcePort,
        targetPort,
      };
    });

  // Adaptive spacing: more nodes → more space between layers
  const nodeCount = nodes.length;
  const spacingFactor = Math.max(1, Math.log2(Math.max(2, nodeCount)));
  const baseNodeSpacing = `${Math.round(40 + spacingFactor * 10)}`;
  const baseLayerSpacing = `${Math.round(55 + spacingFactor * 14)}`;
  const edgeNodeSpacing = `${Math.round(35 + spacingFactor * 8)}`;

  const layout = await elk.layout({
    id: "root",
    children: elkNodes,
    edges: elkEdges,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      // ── Node spacing ──
      "elk.spacing.nodeNode": baseNodeSpacing,
      "elk.layered.spacing.nodeNodeBetweenLayers": baseLayerSpacing,
      "elk.padding": "[top=60,left=60,bottom=60,right=60]",
      // ── Crossing minimization — thorough sweep for fewer edge crossings ──
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.crossingMinimization.greedySwitch.type": "TWO_SIDED",
      // ── Node placement — NETWORK_SIMPLEX gives good layered results ──
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.compaction.postCompaction.strategy": "EDGE_LENGTH",
      // ── Port constraints — ports follow fixed ordering per node side ──
      "elk.portConstraints": "FIXED_ORDER",
      // ── Edge routing — orthogonal (right-angle) for clean UML look ──
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.mergeEdges": "true",
      // ── Edge spacing — keep edges clear of nodes ──
      "elk.layered.spacing.edgeNodeBetweenLayers": edgeNodeSpacing,
      "elk.layered.spacing.edgeEdgeBetweenLayers": "35",
      "elk.spacing.edgeNode": edgeNodeSpacing,
      "elk.spacing.edgeEdge": "20",
      // ── Connected components ──
      "elk.separateConnectedComponents": "true",
      "elk.spacing.componentComponent": "140",
      // ── Model order + edge self-loops ──
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.edgeRouting.selfLoopDistribution": "EQUALLY",
      // ── Wrapping for very wide diagrams ──
      "elk.layered.wrapping.strategy": nodeCount > 50 ? "MULTI_EDGE" : "OFF",
      // ── Thoroughness: higher = better results but slower ──
      "elk.layered.thoroughness": nodeCount > 40 ? "20" : "10",
    },
  });

  return nodes.map((n) => {
    const layoutNode = layout.children?.find((c) => c.id === n.id);
    return {
      ...n,
      position: {
        x: layoutNode?.x ?? n.position.x,
        y: layoutNode?.y ?? n.position.y,
      },
    };
  });
}
