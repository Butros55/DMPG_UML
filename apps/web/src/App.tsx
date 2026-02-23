import { useEffect } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Canvas } from "./components/Canvas";
import { Sidebar } from "./components/Sidebar";
import { Inspector } from "./components/Inspector";
import { Breadcrumb } from "./components/Breadcrumb";
import { useAppStore } from "./store";
import { fetchGraph } from "./api";

export function App() {
  const setGraph = useAppStore((s) => s.setGraph);
  const graph = useAppStore((s) => s.graph);

  useEffect(() => {
    fetchGraph()
      .then((g) => setGraph(g))
      .catch((err) => console.error("Failed to load graph:", err));
  }, [setGraph]);

  return (
    <div className="app-layout">
      <header className="app-header">
        <h1>DMPG UML Editor</h1>
        <Breadcrumb />
        <div style={{ flex: 1 }} />
        {graph && (
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {graph.symbols.length} symbols · {graph.relations.length} relations · {graph.views.length} views
          </span>
        )}
      </header>

      <Sidebar />

      <ReactFlowProvider>
        <Canvas />
      </ReactFlowProvider>

      <Inspector />
    </div>
  );
}
