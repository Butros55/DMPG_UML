import { useCallback, useState } from "react";
import { useAppStore } from "../store";
import { scanProject } from "../api";

const NODE_KINDS = [
  { kind: "module", label: "Module", color: "#6c8cff" },
  { kind: "class", label: "Class", color: "#ffd866" },
  { kind: "function", label: "Function", color: "#80e0a0" },
  { kind: "method", label: "Method", color: "#ffab70" },
  { kind: "package", label: "Package", color: "#6c8cff" },
  { kind: "constant", label: "Constant", color: "#ff6b6b" },
  { kind: "script", label: "Script", color: "#ffab70" },
  { kind: "group", label: "Group", color: "#6c8cff" },
];

export function Sidebar() {
  const graph = useAppStore((s) => s.graph);
  const setGraph = useAppStore((s) => s.setGraph);
  const currentViewId = useAppStore((s) => s.currentViewId);
  const navigateToView = useAppStore((s) => s.navigateToView);

  const [scanPath, setScanPath] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");

  const handleScan = useCallback(async () => {
    if (!scanPath.trim()) return;
    setScanning(true);
    setScanError("");
    try {
      const g = await scanProject(scanPath.trim());
      setGraph(g);
    } catch (err: any) {
      setScanError(err.message);
    } finally {
      setScanning(false);
    }
  }, [scanPath, setGraph]);

  const onDragStart = (e: React.DragEvent, kind: string) => {
    e.dataTransfer.setData("application/uml-kind", kind);
    e.dataTransfer.effectAllowed = "move";
  };

  // View navigation
  const views = graph?.views ?? [];

  return (
    <div className="sidebar">
      <div className="sidebar-section">
        <h2>UML Nodes</h2>
        {NODE_KINDS.map((nk) => (
          <div
            key={nk.kind}
            className="node-palette-item"
            draggable
            onDragStart={(e) => onDragStart(e, nk.kind)}
          >
            <div className="icon" style={{ background: `${nk.color}22`, color: nk.color }}>
              {nk.label[0]}
            </div>
            <span>{nk.label}</span>
          </div>
        ))}
      </div>

      <div className="sidebar-section">
        <h2>Views</h2>
        {views.map((v) => (
          <div
            key={v.id}
            className="node-palette-item"
            style={{
              fontWeight: v.id === currentViewId ? 600 : 400,
              color: v.id === currentViewId ? "var(--accent)" : "var(--text)",
              cursor: "pointer",
            }}
            onClick={() => navigateToView(v.id)}
          >
            <span>{v.parentViewId ? "  └ " : ""}{v.title}</span>
          </div>
        ))}
      </div>

      <div className="sidebar-section scan-section">
        <h2>Scan Project</h2>
        <input
          type="text"
          placeholder="Project path…"
          value={scanPath}
          onChange={(e) => setScanPath(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleScan()}
        />
        <button className="btn" onClick={handleScan} disabled={scanning}>
          {scanning ? "Scanning…" : "Scan"}
        </button>
        {scanError && <div style={{ color: "var(--red)", fontSize: 11, marginTop: 4 }}>{scanError}</div>}
      </div>
    </div>
  );
}
