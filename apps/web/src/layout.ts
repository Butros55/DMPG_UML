import ELK, { type ElkNode, type ElkExtendedEdge } from "elkjs/lib/elk.bundled.js";
import type { Node, Edge } from "@xyflow/react";
import {
  DEFAULT_DIAGRAM_LAYOUT_SETTINGS,
  type DiagramLayoutSettings,
} from "./diagramSettings";

const elk = new ELK();

const DEFAULT_WIDTH = 200;

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
): Promise<Node[]> {
  const settings = {
    ...DEFAULT_DIAGRAM_LAYOUT_SETTINGS,
    ...layoutSettings,
  } satisfies DiagramLayoutSettings;

  const elkNodes: ElkNode[] = nodes.map((n) => {
    const size = estimateNodeSize(n, compactMode);
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
      "elk.portConstraints": "FIXED_ORDER",
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
