import test from "node:test";
import assert from "node:assert/strict";
import type { ProjectGraph } from "@dmpg/shared";

import { buildNavigableRelationItems } from "./relationNavigation.js";
import { normalizeGraphForFrontend, resolveNavigableSymbolId } from "./viewNavigation.js";

function buildLegacyNavigationGraph(): ProjectGraph {
  return {
    symbols: [
      { id: "sym:writer", label: "save_to_file", kind: "function" },
      { id: "ext:hidden", label: "beschichtungssimulation/data/files/distribution.json", kind: "external", umlType: "artifact" },
      { id: "proc:artifact:distribution", label: "distribution.json", kind: "external", umlType: "artifact" },
      { id: "grp:art-cat:io", label: "I/O Operations (15)", kind: "group", umlType: "package", childViewId: "view:art-cat:io" },
    ],
    relations: [
      { id: "rel:hidden", type: "writes", source: "sym:writer", target: "ext:hidden", label: "writes" },
      { id: "rel:visible", type: "writes", source: "sym:writer", target: "proc:artifact:distribution", label: "writes" },
      { id: "rel:legacy-group", type: "writes", source: "sym:writer", target: "grp:art-cat:io", label: "writes" },
    ],
    views: [
      {
        id: "view:process-overview",
        title: "Architecture & Dataflow Overview",
        scope: "root",
        nodeRefs: ["sym:writer", "proc:artifact:distribution"],
        edgeRefs: [],
        manualLayout: true,
      },
      {
        id: "view:process-stage:distribution",
        title: "Distribution",
        parentViewId: "view:process-overview",
        scope: "group",
        nodeRefs: ["sym:writer", "proc:artifact:distribution"],
        edgeRefs: [],
        manualLayout: true,
      },
      {
        id: "view:grp:visible",
        title: "Visible Group",
        parentViewId: "view:process-overview",
        scope: "group",
        nodeRefs: ["sym:writer"],
        edgeRefs: [],
        manualLayout: true,
      },
      {
        id: "view:art-cat:io",
        title: "I/O Operations",
        parentViewId: "view:process-overview",
        scope: "group",
        nodeRefs: ["ext:hidden"],
        edgeRefs: [],
        hiddenInSidebar: true,
      },
    ],
    rootViewId: "view:process-overview",
  };
}

test("normalizeGraphForFrontend strips legacy hidden views and invalid child view pointers", () => {
  const graph = buildLegacyNavigationGraph();

  const normalized = normalizeGraphForFrontend(graph);

  assert.deepEqual(
    normalized.views.map((view) => view.id),
    ["view:process-overview", "view:process-stage:distribution", "view:grp:visible"],
  );
  assert.equal(
    normalized.symbols.find((symbol) => symbol.id === "grp:art-cat:io")?.childViewId,
    undefined,
  );
  assert.equal(
    normalized.views.find((view) => view.id === "view:process-overview")?.manualLayout,
    undefined,
  );
  assert.equal(
    normalized.views.find((view) => view.id === "view:process-stage:distribution")?.manualLayout,
    undefined,
  );
  assert.equal(
    normalized.views.find((view) => view.id === "view:grp:visible")?.manualLayout,
    true,
  );
});

test("resolveNavigableSymbolId maps hidden legacy artifacts to the visible process artifact", () => {
  const graph = buildLegacyNavigationGraph();

  assert.equal(
    resolveNavigableSymbolId(graph, "ext:hidden"),
    "proc:artifact:distribution",
  );
});

test("buildNavigableRelationItems removes legacy duplicates and keeps the visible target once", () => {
  const graph = buildLegacyNavigationGraph();

  const items = buildNavigableRelationItems(graph, graph.relations, "out");

  assert.equal(items.length, 1);
  assert.equal(items[0]?.symbolId, "proc:artifact:distribution");
  assert.deepEqual(
    items[0]?.relations.map((relation) => relation.id).sort(),
    ["rel:hidden", "rel:visible"],
  );
});
