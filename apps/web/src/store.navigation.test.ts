import test from "node:test";
import assert from "node:assert/strict";
import type { ProjectGraph } from "@dmpg/shared";
import { bestNavigableViewForSymbol, useAppStore } from "./store.js";
import { buildBreadcrumbPath } from "./viewNavigation.js";

function buildGraph(): ProjectGraph {
  return {
    symbols: [
      { id: "sym:class", label: "DruidConnector", kind: "class" },
      { id: "sym:method", label: "DruidConnector.execute_query", kind: "method", parentId: "sym:class" },
      { id: "ext:artifact", label: "df_tmp.tail", kind: "external", umlType: "artifact" },
    ],
    relations: [],
    views: [
      {
        id: "view:process-overview",
        title: "Architecture Overview",
        scope: "root",
        nodeRefs: ["sym:class"],
        edgeRefs: [],
      },
      {
        id: "view:process-stage:inputs",
        title: "Input Sources",
        parentViewId: "view:process-overview",
        scope: "group",
        nodeRefs: ["sym:class"],
        edgeRefs: [],
      },
      {
        id: "view:grp:dir:connector",
        title: "Connector",
        parentViewId: "view:process-stage:inputs",
        scope: "group",
        nodeRefs: ["sym:class"],
        edgeRefs: [],
      },
      {
        id: "view:mod:connector.druid_connector",
        title: "connector.druid_connector",
        parentViewId: "view:grp:dir:connector",
        scope: "module",
        nodeRefs: ["sym:class", "sym:method"],
        edgeRefs: [],
      },
      {
        id: "view:mod:connector.druid_connector:DruidConnector",
        title: "DruidConnector",
        parentViewId: "view:mod:connector.druid_connector",
        scope: "class",
        nodeRefs: ["sym:method"],
        edgeRefs: [],
      },
      {
        id: "view:art-cat:misc:view:grp:dir:__root__",
        title: "Other Artifacts",
        parentViewId: "view:process-overview",
        scope: "group",
        nodeRefs: ["ext:artifact"],
        edgeRefs: [],
      },
    ],
    rootViewId: "view:process-overview",
  };
}

function buildLegacyBreadcrumbGraph(): ProjectGraph {
  return {
    symbols: [],
    relations: [],
    views: [
      {
        id: "view:process-overview",
        title: "Architecture & Dataflow Overview",
        scope: "root",
        nodeRefs: [],
        edgeRefs: [],
      },
      {
        id: "view:root",
        title: "Data Pipeline — Overview",
        parentViewId: "view:process-overview",
        scope: "root",
        nodeRefs: [],
        edgeRefs: [],
        hiddenInSidebar: true,
      },
      {
        id: "view:grp:domain:data-sources",
        title: "Datenquellen",
        parentViewId: "view:root",
        scope: "group",
        nodeRefs: [],
        edgeRefs: [],
        hiddenInSidebar: true,
      },
      {
        id: "view:grp:dir:__root__",
        title: "Data Pipeline",
        parentViewId: "view:grp:domain:data-sources",
        scope: "group",
        nodeRefs: [],
        edgeRefs: [],
        hiddenInSidebar: true,
      },
      {
        id: "view:artifacts:view:grp:dir:__root__",
        title: "Artifacts — Data Pipeline",
        parentViewId: "view:grp:dir:__root__",
        scope: "group",
        nodeRefs: [],
        edgeRefs: [],
      },
      {
        id: "view:art-cat:misc:view:grp:dir:__root__",
        title: "Other Artifacts — Data Pipeline",
        parentViewId: "view:artifacts:view:grp:dir:__root__",
        scope: "group",
        nodeRefs: [],
        edgeRefs: [],
      },
    ],
    rootViewId: "view:process-overview",
  };
}

function buildManualLayoutGraph(): ProjectGraph {
  const graph = buildGraph();
  return {
    ...graph,
    views: graph.views.map((view) =>
      view.id === "view:grp:dir:connector"
        ? {
            ...view,
            manualLayout: true,
            nodePositions: [{ symbolId: "sym:class", x: 320, y: 180 }],
          }
        : view,
    ),
  };
}

function disableGraphSync() {
  useAppStore.setState({ syncGraphToServer: async () => {} });
}

test("bestNavigableViewForSymbol prefers the current visible context when it already contains the symbol", () => {
  const graph = buildGraph();
  const targetViewId = bestNavigableViewForSymbol(graph, "sym:method", {
    currentViewId: "view:mod:connector.druid_connector",
  });

  assert.equal(targetViewId, "view:mod:connector.druid_connector");
});

test("bestNavigableViewForSymbol falls back to the deepest visible non-technical view", () => {
  const graph = buildGraph();
  const targetViewId = bestNavigableViewForSymbol(graph, "sym:method", {
    currentViewId: "view:process-stage:inputs",
  });

  assert.equal(targetViewId, "view:mod:connector.druid_connector:DruidConnector");
});

test("bestNavigableViewForSymbol rejects artifact-only legacy views even when they are visible", () => {
  const graph = buildGraph();
  const targetViewId = bestNavigableViewForSymbol(graph, "ext:artifact", {
    currentViewId: "view:process-stage:inputs",
  });

  assert.equal(targetViewId, null);
});

test("focusSymbolInContext keeps the current architecture view for artifact-only symbols", () => {
  const graph = buildGraph();
  useAppStore.getState().setGraph(graph);
  useAppStore.getState().navigateToView("view:process-stage:inputs");

  useAppStore.getState().focusSymbolInContext("ext:artifact");

  const state = useAppStore.getState();
  assert.equal(state.currentViewId, "view:process-stage:inputs");
  assert.equal(state.selectedSymbolId, "ext:artifact");
  assert.equal(state.focusNodeId, "ext:artifact");
});

test("focusSymbolInContext still navigates normal project symbols into their best visible subview", () => {
  const graph = buildGraph();
  useAppStore.getState().setGraph(graph);
  useAppStore.getState().navigateToView("view:process-stage:inputs");

  useAppStore.getState().focusSymbolInContext("sym:method");

  const state = useAppStore.getState();
  assert.equal(state.currentViewId, "view:mod:connector.druid_connector:DruidConnector");
  assert.deepEqual(state.breadcrumb, [
    "view:process-overview",
    "view:process-stage:inputs",
    "view:grp:dir:connector",
    "view:mod:connector.druid_connector",
    "view:mod:connector.druid_connector:DruidConnector",
  ]);
});

test("buildBreadcrumbPath removes hidden legacy overview views from the breadcrumb trail", () => {
  const graph = buildLegacyBreadcrumbGraph();

  assert.deepEqual(
    buildBreadcrumbPath(graph, "view:art-cat:misc:view:grp:dir:__root__"),
    [
      "view:process-overview",
      "view:artifacts:view:grp:dir:__root__",
      "view:art-cat:misc:view:grp:dir:__root__",
    ],
  );
});

test("navigateToView uses the filtered breadcrumb path for normal visible descendants", () => {
  const graph = {
    ...buildLegacyBreadcrumbGraph(),
    views: [
      ...buildLegacyBreadcrumbGraph().views,
      {
        id: "view:mod:data_analyzer",
        title: "data_analyzer",
        parentViewId: "view:grp:dir:__root__",
        scope: "module" as const,
        nodeRefs: [],
        edgeRefs: [],
      },
    ],
  };
  useAppStore.getState().setGraph(graph);

  useAppStore.getState().navigateToView("view:mod:data_analyzer");

  const state = useAppStore.getState();
  assert.equal(state.currentViewId, "view:mod:data_analyzer");
  assert.deepEqual(state.breadcrumb, [
    "view:process-overview",
    "view:mod:data_analyzer",
  ]);
});

test("navigateToView clears any previous node focus so tree view clicks only fit the target view", () => {
  const graph = buildGraph();
  useAppStore.getState().setGraph(graph);
  useAppStore.getState().focusSymbolInContext("sym:method");

  useAppStore.getState().navigateToView("view:process-stage:inputs");

  const state = useAppStore.getState();
  assert.equal(state.currentViewId, "view:process-stage:inputs");
  assert.equal(state.selectedSymbolId, null);
  assert.equal(state.focusNodeId, null);
  assert.equal(state.viewFitViewId, "view:process-stage:inputs");
});

test("navigateToView restores the previously saved view snapshot when requested", () => {
  const graph = buildGraph();
  useAppStore.getState().setGraph(graph);
  useAppStore.getState().selectSymbol("sym:class");
  useAppStore.getState().saveCurrentViewSnapshot({
    viewport: { x: 120, y: -48, zoom: 0.78 },
  });

  useAppStore.getState().navigateToView("view:process-stage:inputs");
  useAppStore.getState().selectSymbol("sym:class");

  useAppStore.getState().navigateToView("view:process-overview", { restoreViewState: true });

  const state = useAppStore.getState();
  assert.equal(state.currentViewId, "view:process-overview");
  assert.equal(state.selectedSymbolId, "sym:class");
  assert.equal(state.selectedEdgeId, null);
  assert.equal(state.viewRestoreViewId, "view:process-overview");
  assert.equal(state.viewUiSnapshots["view:process-overview"]?.viewport?.zoom, 0.78);
});

test("saveNodePositions does not persist manual layout while auto-layout is active", () => {
  disableGraphSync();
  useAppStore.getState().setGraph(buildGraph());
  useAppStore.getState().navigateToView("view:grp:dir:connector");
  useAppStore.setState({
    diagramSettings: {
      ...useAppStore.getState().diagramSettings,
      autoLayout: true,
    },
  });

  useAppStore.getState().saveNodePositions([{ symbolId: "sym:class", x: 64, y: 96 }]);

  const view = useAppStore.getState().graph?.views.find((entry) => entry.id === "view:grp:dir:connector");
  assert.equal(view?.manualLayout, undefined);
  assert.equal(view?.nodePositions, undefined);
});

test("saveNodePositions still persists manual layout when auto-layout is disabled", () => {
  disableGraphSync();
  useAppStore.getState().setGraph(buildGraph());
  useAppStore.getState().navigateToView("view:grp:dir:connector");
  useAppStore.setState({
    diagramSettings: {
      ...useAppStore.getState().diagramSettings,
      autoLayout: false,
    },
  });

  useAppStore.getState().saveNodePositions([{ symbolId: "sym:class", x: 64, y: 96 }]);

  const view = useAppStore.getState().graph?.views.find((entry) => entry.id === "view:grp:dir:connector");
  assert.equal(view?.manualLayout, true);
  assert.deepEqual(view?.nodePositions, [{ symbolId: "sym:class", x: 64, y: 96 }]);
});

test("clearManualLayoutFlags removes persisted manual layout flags but keeps saved positions", () => {
  disableGraphSync();
  useAppStore.getState().setGraph(buildManualLayoutGraph());

  useAppStore.getState().clearManualLayoutFlags();

  const view = useAppStore.getState().graph?.views.find((entry) => entry.id === "view:grp:dir:connector");
  assert.equal(view?.manualLayout, undefined);
  assert.deepEqual(view?.nodePositions, [{ symbolId: "sym:class", x: 320, y: 180 }]);
});
