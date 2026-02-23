import ELK, { type ElkNode, type ElkExtendedEdge } from "elkjs/lib/elk.bundled.js";
import type { Node, Edge } from "@xyflow/react";

const elk = new ELK();

const DEFAULT_WIDTH = 200;
const DEFAULT_HEIGHT = 80;

export async function layoutNodes(
  nodes: Node[],
  edges: Edge[],
  direction: "DOWN" | "RIGHT" = "DOWN",
): Promise<Node[]> {
  const elkNodes: ElkNode[] = nodes.map((n) => ({
    id: n.id,
    width: (n.measured?.width ?? n.width ?? DEFAULT_WIDTH) as number,
    height: (n.measured?.height ?? n.height ?? DEFAULT_HEIGHT) as number,
  }));

  const elkEdges: ElkExtendedEdge[] = edges
    .filter((e) => nodes.some((n) => n.id === e.source) && nodes.some((n) => n.id === e.target))
    .map((e) => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    }));

  const layout = await elk.layout({
    id: "root",
    children: elkNodes,
    edges: elkEdges,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.spacing.nodeNode": "60",
      "elk.layered.spacing.nodeNodeBetweenLayers": "80",
      "elk.padding": "[top=40,left=40,bottom=40,right=40]",
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
