/**
 * exportHtml.ts — Standalone interactive HTML export.
 *
 * Generates a self-contained HTML file that closely mirrors the live app:
 *  - Pan / zoom canvas (mouse drag + wheel)
 *  - Sidebar with search bar + view tree (with child symbols + kind badges)
 *  - Hover cards with full symbol info
 *  - Inspector panel (click a node)
 *  - Breadcrumb navigation
 *  - Resizable panels (sidebar + inspector)
 *  - ELK-style auto-layout (layered)
 *
 * NO external dependencies — everything inlined.
 * NO editing features, NO AI analysis.
 */

import type { Node, Edge } from "@xyflow/react";
import type { ProjectGraph, Symbol as Sym, Relation, DiagramView } from "@dmpg/shared";

/* ──────────── Single-view export (legacy compat) ──────────── */

export function exportDiagramAsHtml(nodes: Node[], edges: Edge[], title: string) {
  const symbols: Sym[] = nodes.map((n) => ({
    id: n.id,
    label: (n.data as any).label ?? n.id,
    kind: (n.data as any).kind ?? "module",
    doc: { summary: (n.data as any).summary },
    tags: (n.data as any).tags,
    childViewId: (n.data as any).childViewId,
  }));

  const relations: Relation[] = edges.map((e) => ({
    id: e.id,
    type: "calls" as any,
    source: e.source,
    target: e.target,
    label: typeof e.label === "string" ? e.label : undefined,
  }));

  const view: DiagramView = {
    id: "export-view",
    title,
    nodeRefs: nodes.map((n) => n.id),
    edgeRefs: edges.map((e) => e.id),
  };

  const graph: ProjectGraph = {
    symbols,
    relations,
    views: [view],
    rootViewId: "export-view",
  };

  exportProjectAsHtml(graph);
}

/* ──────────── Full project export ──────────── */

export function exportProjectAsHtml(graph: ProjectGraph) {
  const data = JSON.stringify(graph);
  const projectName = graph.projectPath?.split(/[\\/]/).pop() ?? "UML Project";
  const exportDate = new Date().toLocaleString("de-DE");

  const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(projectName)} — DMPG UML</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
<style>${CSS_CONTENT}</style>
</head>
<body>
<div id="app">
  <header class="app-header">
    <h1>DMPG UML</h1>
    <div id="breadcrumb" class="breadcrumb"></div>
    <div style="flex:1"></div>
    <div class="hdr-info">
      <span id="stats"></span>
      <span class="sep">·</span>
      <span>Exportiert ${esc(exportDate)}</span>
    </div>
  </header>
  <aside class="sidebar" id="sidebar"></aside>
  <div class="resize-handle resize-handle--sidebar" id="resizeSidebar"></div>
  <main class="viewport" id="viewport">
    <div class="canvas" id="canvas"></div>
    <div class="zoom-controls">
      <button onclick="zoomIn()" title="Zoom in">+</button>
      <button onclick="zoomReset()" title="Fit view">⊡</button>
      <button onclick="zoomOut()" title="Zoom out">−</button>
    </div>
  </main>
  <div class="resize-handle resize-handle--inspector" id="resizeInspector"></div>
  <aside class="inspector" id="inspector">
    <div class="insp-empty">Node anklicken für Details</div>
  </aside>
</div>
<div class="hover-card" id="hoverCard" style="display:none"></div>

<script>
// ── Embedded graph data ──
const G = ${data};

${RUNTIME_JS}
</script>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${projectName.replace(/[^a-zA-Z0-9_-]/g, "_")}_uml.html`;
  a.click();
  URL.revokeObjectURL(url);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ═══════════════════════════════════════════════════
   CSS — matches the live app's look
   ═══════════════════════════════════════════════════ */

const CSS_CONTENT = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --sidebar-w:260px;
  --inspector-w:340px;
  --header-h:44px;
  --bg:#0f1117;
  --bg-panel:#1a1d27;
  --bg-card:#23263a;
  --border:#2d3148;
  --text:#e2e4f0;
  --text-dim:#8b8fa7;
  --accent:#6c8cff;
  --accent-hover:#8ba5ff;
  --yellow:#ffd866;
  --green:#80e0a0;
  --orange:#ffab70;
  --red:#ff6b6b;
  font-family:"Inter",system-ui,-apple-system,sans-serif;
  color:var(--text);
  background:var(--bg);
}
html,body{height:100%;overflow:hidden}

/* ── Layout ── */
#app{
  display:grid;
  grid-template-columns:var(--sidebar-w) 6px 1fr 6px var(--inspector-w);
  grid-template-rows:var(--header-h) 1fr;
  grid-template-areas:"hdr hdr hdr hdr hdr" "sb rsl vp rsi insp";
  height:100vh;
}

.app-header{
  grid-area:hdr;display:flex;align-items:center;gap:12px;
  padding:0 16px;background:var(--bg-panel);border-bottom:1px solid var(--border);z-index:20;
}
.app-header h1{font-size:15px;font-weight:600;color:var(--accent)}
.hdr-info{font-size:11px;color:var(--text-dim);display:flex;align-items:center;gap:6px}
.hdr-info .sep{color:var(--border)}

/* Breadcrumb */
.breadcrumb{display:flex;align-items:center;gap:4px;font-size:13px;color:var(--text-dim)}
.breadcrumb button{background:none;border:none;color:var(--accent);cursor:pointer;font-size:13px;padding:2px 4px;border-radius:4px}
.breadcrumb button:hover{background:rgba(108,140,255,.15)}
.breadcrumb .sep{color:var(--text-dim);margin:0 2px}

/* ── Sidebar ── */
.sidebar{
  grid-area:sb;background:var(--bg-panel);border-right:1px solid var(--border);
  overflow-y:auto;padding:12px;
}
.sidebar::-webkit-scrollbar{width:5px}
.sidebar::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px}
.sidebar h2{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-dim);margin-bottom:8px}
.sidebar-section{margin-bottom:16px}

/* ── Resize Handles ── */
.resize-handle{
  width:6px;cursor:col-resize;z-index:15;
  background:transparent;transition:background .15s;
}
.resize-handle:hover,.resize-handle.active{background:rgba(108,140,255,.3)}
.resize-handle--sidebar{grid-area:rsl}
.resize-handle--inspector{grid-area:rsi}

/* ── Search ── */
.symbol-search{position:relative;margin-bottom:12px}
.symbol-search__input-wrap{
  display:flex;align-items:center;gap:6px;
  background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:4px 8px;
  transition:border-color .15s;
}
.symbol-search__input-wrap:focus-within{border-color:var(--accent)}
.symbol-search__icon{font-size:13px;flex-shrink:0;opacity:.5}
.symbol-search__input{
  flex:1;background:none;border:none;outline:none;color:var(--text);font-size:12px;min-width:0;
}
.symbol-search__input::placeholder{color:var(--text-dim)}
.symbol-search__clear{
  background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:12px;padding:0 2px;line-height:1;
}
.symbol-search__clear:hover{color:var(--text)}
.symbol-search__dropdown{
  position:absolute;top:100%;left:0;right:0;max-height:320px;overflow-y:auto;
  background:var(--bg-card);border:1px solid var(--border);border-top:none;
  border-radius:0 0 6px 6px;z-index:100;box-shadow:0 8px 24px rgba(0,0,0,.4);
}
.symbol-search__empty{padding:12px;text-align:center;color:var(--text-dim);font-size:12px}
.symbol-search__result{
  display:flex;align-items:center;gap:8px;padding:5px 10px;cursor:pointer;font-size:12px;
  transition:background .1s;
}
.symbol-search__result:hover{background:rgba(108,140,255,.12)}
.symbol-search__result-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)}
.symbol-search__result-kind{font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.3px;flex-shrink:0}

/* ── Kind Badge ── */
.kind-badge{
  display:inline-flex;align-items:center;justify-content:center;
  width:18px;height:18px;border-radius:4px;font-size:10px;font-weight:700;
  flex-shrink:0;line-height:1;
}

/* ── View Tree ── */
.view-tree{margin-bottom:12px}
.vt-item{
  display:flex;align-items:center;gap:4px;padding:3px 6px;border-radius:4px;
  cursor:pointer;font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;
  transition:background .12s;user-select:none;
}
.vt-item:hover{background:rgba(108,140,255,.1)}
.vt-item.active{background:rgba(108,140,255,.18);color:var(--accent);font-weight:600}
.vt-item--dead{border-left:2px solid var(--red)}
.vt-sym{color:var(--text-dim);font-size:11.5px}
.vt-sym:hover{color:var(--text)}
.vt-sym--dead{opacity:.5;text-decoration:line-through}
.vt-chv{
  display:inline-flex;align-items:center;justify-content:center;
  width:20px;height:20px;font-size:13px;flex-shrink:0;
  transition:transform .15s;color:var(--text-dim);border-radius:4px;cursor:pointer;
}
.vt-chv:hover{background:rgba(108,140,255,.15);color:var(--text)}
.vt-chv.open{transform:rotate(90deg)}
.vt-chv--leaf{width:20px;pointer-events:none}
.vt-ico{flex-shrink:0;font-size:13px;width:18px;text-align:center}
.vt-lbl{overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}

/* ── Viewport & Canvas ── */
.viewport{grid-area:vp;overflow:hidden;position:relative;cursor:grab;background:var(--bg)}
.viewport:active{cursor:grabbing}
.canvas{position:absolute;transform-origin:0 0;will-change:transform}

/* Zoom controls */
.zoom-controls{position:absolute;bottom:16px;right:16px;display:flex;flex-direction:column;gap:2px;z-index:10}
.zoom-controls button{
  width:32px;height:32px;border:1px solid var(--border);background:var(--bg-panel);
  color:var(--text);font-size:16px;cursor:pointer;border-radius:4px;
  display:flex;align-items:center;justify-content:center;
}
.zoom-controls button:hover{background:var(--bg-card);color:var(--accent)}

/* ── Nodes ── */
.node{
  position:absolute;background:var(--bg-card);border:2px solid var(--border);border-radius:8px;
  min-width:160px;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,.3);
  cursor:pointer;transition:border-color .15s,box-shadow .15s;user-select:none;
}
.node:hover,.node.selected{border-color:var(--accent);box-shadow:0 0 0 2px rgba(108,140,255,.25),0 4px 16px rgba(0,0,0,.3)}
.node-hdr{padding:8px 12px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:6px}
.kbadge{font-size:9px;padding:1px 5px;border-radius:3px;font-weight:600;text-transform:uppercase;letter-spacing:.05em}
.kb-module{background:rgba(108,140,255,.2);color:var(--accent)}
.kb-class{background:rgba(255,216,102,.2);color:var(--yellow)}
.kb-function,.kb-method{background:rgba(128,224,160,.2);color:var(--green)}
.kb-group{background:rgba(108,140,255,.15);color:var(--accent)}
.kb-constant,.kb-variable{background:rgba(255,107,107,.2);color:var(--red)}
.kb-script{background:rgba(255,171,112,.2);color:var(--orange)}
.kb-package{background:rgba(108,140,255,.2);color:var(--accent)}
.kb-external{background:rgba(139,143,167,.2);color:var(--text-dim)}
.kb-interface{background:rgba(128,224,160,.15);color:var(--green)}
.nlbl{font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* Node kind styles */
.nk-group,.nk-module.is-overview{border-color:var(--accent);background:rgba(108,140,255,.06)}
.nk-group .node-hdr,.nk-module.is-overview .node-hdr{background:rgba(108,140,255,.1)}
.nk-external{background:rgba(139,143,167,.08);border-style:dashed;border-color:var(--text-dim)}
.nk-external:hover,.nk-external.selected{border-color:var(--text-dim);box-shadow:0 0 0 2px rgba(139,143,167,.2),0 4px 12px rgba(0,0,0,.3)}
.nk-function,.nk-method{border-radius:16px;min-width:140px}

/* Class compartments */
.cls-node .class-hdr{flex-direction:column;align-items:center;text-align:center;gap:2px;padding:6px 12px}
.stereo{font-size:10px;color:var(--text-dim);font-style:italic}
.compart{padding:4px 12px;border-top:1px solid var(--border)}
.compart-item{font-size:12px;padding:2px 0;color:var(--text)}
.compart-empty{font-size:11px;color:var(--text-dim);text-align:center;padding:2px 0}
.attr-i{color:var(--red);font-weight:700;margin-right:2px}
.meth-i{color:var(--green);font-weight:700;margin-right:2px}
.type-h{color:var(--text-dim);font-size:11px}

/* Function signature */
.fn-sig{padding:2px 12px 4px;font-size:11px;color:var(--text-dim);font-family:"JetBrains Mono","Fira Code",monospace}
.fn-sig .pn{color:var(--text)}
.fn-ret{padding:2px 12px 6px;font-size:11px;color:var(--green);font-family:"JetBrains Mono","Fira Code",monospace}

/* Relation badges */
.rbadges{display:flex;flex-wrap:wrap;gap:3px;padding:4px 12px 6px}
.rbadge{display:inline-flex;align-items:center;gap:2px;font-size:10px;padding:1px 5px;border-radius:4px;white-space:nowrap;font-weight:500}
.rb-reads{background:rgba(128,224,160,.18);color:var(--green)}
.rb-writes{background:rgba(255,171,112,.18);color:var(--orange)}
.rb-calls{background:rgba(108,140,255,.18);color:var(--accent)}
.rb-inherits,.rb-instantiates{background:rgba(255,216,102,.18);color:var(--yellow)}
.rb-uses_config{background:rgba(139,143,167,.18);color:var(--text-dim)}
.rb-imports{background:rgba(128,224,160,.12);color:var(--green)}

/* Drilldown */
.drilldown{padding:4px 12px 8px;font-size:11px;color:var(--accent);cursor:pointer}
.drilldown:hover{text-decoration:underline}
.node-count{padding:2px 12px 4px;font-size:10px;color:var(--text-dim)}

/* Dead code */
.dead-tag{color:var(--red);margin-left:4px}

/* ── Edges (SVG) ── */
.edges-svg{position:absolute;top:0;left:0;pointer-events:none;overflow:visible}
.edge-path{fill:none;stroke:var(--text-dim);stroke-width:1.5}
.et-calls{stroke:var(--accent);stroke-width:2}
.et-imports{stroke:var(--green);stroke-dasharray:6 3}
.et-inherits{stroke:var(--yellow);stroke-width:2}
.et-reads{stroke:var(--green);stroke-dasharray:8 4;stroke-width:1.5}
.et-writes{stroke:var(--orange);stroke-dasharray:8 4;stroke-width:1.5}
.et-instantiates{stroke:var(--yellow);stroke-dasharray:4 2}
.et-uses_config,.et-uses-config{stroke:var(--text-dim);stroke-dasharray:3 6}
.et-multi{stroke-width:2.5;stroke-dasharray:10 4}
.edge-label{font-size:10px;fill:var(--text-dim);pointer-events:none}

/* ── Inspector ── */
.inspector{
  grid-area:insp;background:var(--bg-panel);border-left:1px solid var(--border);
  overflow-y:auto;padding:16px;font-size:12px;
}
.inspector::-webkit-scrollbar{width:5px}
.inspector::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px}
.inspector h2{font-size:15px;font-weight:600;margin-bottom:12px}
.insp-empty{color:var(--text-dim);font-size:13px;text-align:center;margin-top:40px}
.insp-card{background:var(--bg-card);border-radius:8px;padding:12px;margin-bottom:12px}
.insp-card h3{font-size:13px;font-weight:600;margin-bottom:6px;color:var(--text)}
.insp-row{display:flex;align-items:baseline;gap:6px;margin-bottom:4px;font-size:11px}
.insp-lbl{color:var(--text-dim);min-width:60px;flex-shrink:0}
.insp-val{color:var(--text);word-break:break-word}
.insp-badge{font-size:9px;padding:2px 6px;border-radius:4px;font-weight:600;text-transform:uppercase;color:#0f1117}
.insp-link{color:var(--accent);cursor:pointer;font-size:11px}
.insp-link:hover{text-decoration:underline;color:#fff}
.insp-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.insp-chip{display:inline-block;font-size:10px;padding:2px 8px;border-radius:4px;background:rgba(108,140,255,.12);color:var(--accent);cursor:pointer;transition:background .15s}
.insp-chip:hover{background:rgba(108,140,255,.3);color:#fff}
.insp-section-lbl{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--accent);margin-bottom:4px}
.insp-summary{font-size:11px;line-height:1.5;color:var(--text)}
.insp-sig{background:rgba(0,0,0,.25);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-family:"JetBrains Mono","Fira Code",monospace;font-size:11px;overflow-x:auto;white-space:nowrap;margin-bottom:8px}
.sig-kw{color:#c9a0ff}
.sig-parens{color:var(--text-dim)}
.sig-params{color:#ff9070}
.sig-arrow{color:var(--text-dim)}
.sig-ret{color:var(--green)}
.insp-se{margin:0;padding-left:16px;font-size:11px}
.insp-se li{margin-bottom:2px;color:#ffa64d}
.insp-tags{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}
.insp-tag{font-size:9px;padding:2px 6px;border-radius:3px;background:rgba(108,140,255,.15);color:var(--accent)}
.insp-tag-dead{background:rgba(255,80,80,.15);color:#ff5050}

/* Parameter table */
.hc-tbl{display:flex;flex-direction:column;gap:2px}
.hc-tbl-row{display:flex;align-items:baseline;gap:6px;font-size:11px}
.hc-pn{font-weight:600;color:#ff9070;font-family:"JetBrains Mono","Fira Code",monospace;font-size:10px;min-width:60px;flex-shrink:0}
.hc-pt{color:#7a80a0;font-family:"JetBrains Mono","Fira Code",monospace;font-size:10px;flex-shrink:0}
.hc-pd{font-size:10px;opacity:.8}

/* ── Hover Card ── */
.hover-card{
  position:fixed;z-index:9999;width:380px;max-height:80vh;overflow-y:auto;
  background:#1e2030;border:1px solid #363a52;border-radius:10px;
  box-shadow:0 8px 32px rgba(0,0,0,.5),0 2px 8px rgba(0,0,0,.3);
  padding:12px 14px;font-size:12px;color:#c8d1e0;animation:hcIn .15s ease-out;
}
@keyframes hcIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
.hover-card::-webkit-scrollbar{width:4px}
.hover-card::-webkit-scrollbar-thumb{background:#363a52;border-radius:2px}
.hc-hdr{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.hc-kb{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:2px 6px;border-radius:4px;color:#0f1117;white-space:nowrap}
.hc-name{font-size:14px;font-weight:600;color:#e8ecf5;word-break:break-word}
.hc-loc{font-size:10px;color:#7a80a0;margin-bottom:4px;font-family:"JetBrains Mono","Fira Code",monospace}
.hc-parent{font-size:11px;color:#7a80a0;margin-bottom:6px}
.hc-sig{background:rgba(0,0,0,.25);border:1px solid #363a52;border-radius:6px;padding:6px 10px;font-family:"JetBrains Mono","Fira Code",monospace;font-size:11px;margin-bottom:8px;overflow-x:auto;white-space:nowrap}
.hc-section{margin-top:6px;padding-top:6px;border-top:1px solid rgba(54,58,82,.5)}
.hc-slbl{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--accent);margin-bottom:4px}
.hc-summary{font-size:11px;line-height:1.5}
.hc-chips{display:flex;flex-wrap:wrap;gap:4px}
.hc-chip{display:inline-block;font-size:10px;padding:2px 8px;border-radius:4px;background:rgba(108,140,255,.12);color:var(--accent);cursor:pointer;transition:background .15s;white-space:nowrap}
.hc-chip:hover{background:rgba(108,140,255,.3);color:#fff}
.hc-tags{margin-top:6px;padding-top:6px;border-top:1px solid rgba(54,58,82,.5);display:flex;gap:4px;flex-wrap:wrap}
.hc-tag{font-size:9px;padding:2px 6px;border-radius:3px;background:rgba(108,140,255,.15);color:var(--accent)}
.hc-tag-dead{background:rgba(255,80,80,.15);color:#ff5050}
.hc-footer{margin-top:8px;padding-top:6px;border-top:1px solid rgba(54,58,82,.3);font-size:9px;color:var(--text-dim);text-align:center;opacity:.6}
.hc-se{margin:0;padding-left:16px;font-size:11px}
.hc-se li{margin-bottom:2px;color:#ffa64d}
`;

/* ═══════════════════════════════════════════════════
   Runtime JS — runs inside the exported HTML
   ═══════════════════════════════════════════════════ */

const RUNTIME_JS = `
"use strict";

// ── Globals ──
const symMap = new Map();
const relMap = new Map();
const viewMap = new Map();
G.symbols.forEach(s => symMap.set(s.id, s));
G.relations.forEach(r => relMap.set(r.id, r));
G.views.forEach(v => viewMap.set(v.id, v));

let currentViewId = G.rootViewId;
let selectedNodeId = null;
let hoverTimer = null;
let hideTimer = null;

// Kind badge config
const KIND_BADGE = {
  module:{letter:"M",color:"#6c8cff"},class:{letter:"C",color:"#ffd866"},
  function:{letter:"F",color:"#80e0a0"},method:{letter:"M",color:"#ffab70"},
  package:{letter:"P",color:"#6c8cff"},constant:{letter:"K",color:"#ff6b6b"},
  script:{letter:"S",color:"#ffab70"},group:{letter:"G",color:"#6c8cff"},
  interface:{letter:"I",color:"#66d9ef"},variable:{letter:"V",color:"#c792ea"},
  external:{letter:"E",color:"#888"},
};
const SCOPE_ICONS = {root:'<i class="bi bi-globe2"></i>',group:'<i class="bi bi-box"></i>',module:'<i class="bi bi-file-earmark-code"></i>',class:'<i class="bi bi-building"></i>'};

// ── Pan / Zoom state ──
let zoom = 1;
let panX = 0, panY = 0;
let isPanning = false;
let panStartX = 0, panStartY = 0;
let panStartPanX = 0, panStartPanY = 0;

const vp = document.getElementById("viewport");
const cv = document.getElementById("canvas");
const hoverCard = document.getElementById("hoverCard");

// Sidebar & inspector widths
let sidebarW = 260;
let inspectorW = 340;

function updateGridCols() {
  document.getElementById("app").style.gridTemplateColumns =
    sidebarW + "px 6px 1fr 6px " + inspectorW + "px";
}

// Stats
document.getElementById("stats").textContent =
  G.symbols.length + " Symbole · " + G.relations.length + " Relationen · " + G.views.length + " Views";

// ══════════════ Resizable Panels ══════════════

function initResize(handleId, side) {
  const handle = document.getElementById(handleId);
  let dragging = false, startX = 0, startW = 0;
  handle.addEventListener("mousedown", function(e) {
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startW = side === "left" ? sidebarW : inspectorW;
    handle.classList.add("active");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });
  document.addEventListener("mousemove", function(e) {
    if (!dragging) return;
    const delta = e.clientX - startX;
    if (side === "left") {
      sidebarW = Math.max(160, Math.min(500, startW + delta));
    } else {
      inspectorW = Math.max(200, Math.min(600, startW - delta));
    }
    updateGridCols();
  });
  document.addEventListener("mouseup", function() {
    if (dragging) {
      dragging = false;
      handle.classList.remove("active");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
  });
}
initResize("resizeSidebar", "left");
initResize("resizeInspector", "right");

// ══════════════ Pan & Zoom ══════════════

function applyTransform() {
  cv.style.transform = "translate(" + panX + "px," + panY + "px) scale(" + zoom + ")";
}

vp.addEventListener("mousedown", function(e) {
  if (e.target.closest(".node") || e.target.closest(".drilldown")) return;
  isPanning = true;
  panStartX = e.clientX;
  panStartY = e.clientY;
  panStartPanX = panX;
  panStartPanY = panY;
});
window.addEventListener("mousemove", function(e) {
  if (!isPanning) return;
  panX = panStartPanX + (e.clientX - panStartX);
  panY = panStartPanY + (e.clientY - panStartY);
  applyTransform();
});
window.addEventListener("mouseup", function() { isPanning = false; });

vp.addEventListener("wheel", function(e) {
  e.preventDefault();
  const rect = vp.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const oldZoom = zoom;
  zoom = Math.max(0.02, Math.min(5, zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
  panX = mx - (mx - panX) * (zoom / oldZoom);
  panY = my - (my - panY) * (zoom / oldZoom);
  applyTransform();
}, { passive: false });

function zoomIn() { zoomBy(1.3); }
function zoomOut() { zoomBy(0.7); }
function zoomReset() { fitView(); }
function zoomBy(factor) {
  const rect = vp.getBoundingClientRect();
  const cx = rect.width / 2, cy = rect.height / 2;
  const oldZoom = zoom;
  zoom = Math.max(0.02, Math.min(5, zoom * factor));
  panX = cx - (cx - panX) * (zoom / oldZoom);
  panY = cy - (cy - panY) * (zoom / oldZoom);
  applyTransform();
}

// ══════════════ Layout ══════════════

function layoutView(view) {
  const nodeIds = view.nodeRefs;
  if (nodeIds.length === 0) return { positions: {}, width: 0, height: 0 };

  // Saved positions
  if (view.nodePositions && view.nodePositions.length > 0) {
    const positions = {};
    let maxX = 0, maxY = 0;
    view.nodePositions.forEach(np => {
      positions[np.symbolId] = { x: np.x, y: np.y };
      const w = estimateWidth(symMap.get(np.symbolId));
      const h = estimateHeight(symMap.get(np.symbolId));
      maxX = Math.max(maxX, np.x + w);
      maxY = Math.max(maxY, np.y + h);
    });
    let allHave = true;
    for (const id of nodeIds) { if (!positions[id]) { allHave = false; break; } }
    if (allHave) return { positions, width: maxX + 60, height: maxY + 60 };
  }

  // Auto-layout (topological layered)
  const edges = projectEdgesForViewLocal(view);
  const adj = new Map(), inDeg = new Map();
  nodeIds.forEach(id => { adj.set(id, []); inDeg.set(id, 0); });
  edges.forEach(e => {
    if (adj.has(e.source) && adj.has(e.target)) {
      adj.get(e.source).push(e.target);
      inDeg.set(e.target, (inDeg.get(e.target) || 0) + 1);
    }
  });

  const layers = [];
  let queue = nodeIds.filter(id => (inDeg.get(id) || 0) === 0);
  const visited = new Set();
  while (queue.length > 0) {
    layers.push([...queue]);
    queue.forEach(id => visited.add(id));
    const next = [];
    queue.forEach(id => {
      (adj.get(id) || []).forEach(t => {
        inDeg.set(t, (inDeg.get(t) || 0) - 1);
        if (inDeg.get(t) <= 0 && !visited.has(t)) { next.push(t); visited.add(t); }
      });
    });
    queue = next;
  }
  const remaining = nodeIds.filter(id => !visited.has(id));
  if (remaining.length > 0) layers.push(remaining);

  const GAP_X = 80, GAP_Y = 100;
  const positions = {};
  let y = 60, globalMaxX = 0;
  layers.forEach(layer => {
    let x = 60, maxH = 0;
    layer.forEach(id => {
      const sym = symMap.get(id);
      positions[id] = { x, y };
      x += estimateWidth(sym) + GAP_X;
      maxH = Math.max(maxH, estimateHeight(sym));
    });
    globalMaxX = Math.max(globalMaxX, x);
    y += maxH + GAP_Y;
  });
  return { positions, width: globalMaxX + 60, height: y + 60 };
}

function estimateWidth(sym) {
  if (!sym) return 200;
  const base = Math.max(160, (sym.label || "").length * 8.5 + 48);
  if (sym.kind === "class") {
    const ch = G.symbols.filter(s => s.parentId === sym.id);
    const maxChild = Math.max(0, ...ch.map(c => (c.label || "").length * 8.5 + 48));
    return Math.max(240, base, maxChild);
  }
  return base;
}

function estimateHeight(sym) {
  if (!sym) return 60;
  if (sym.kind === "class") {
    const ch = G.symbols.filter(s => s.parentId === sym.id);
    const attrs = ch.filter(c => c.kind === "constant" || c.kind === "variable");
    const meths = ch.filter(c => c.kind === "method" || c.kind === "function");
    return 40 + 14 + Math.max(1, attrs.length) * 20 + 14 + Math.max(1, meths.length) * 20 + 8;
  }
  if (sym.kind === "function" || sym.kind === "method") {
    return 40 + ((sym.doc?.inputs || []).length > 0 ? 22 : 0) + 8;
  }
  return 66;
}

// ══════════════ Edge Projection ══════════════

function projectEdgesForViewLocal(view) {
  const visible = new Set(view.nodeRefs);
  const parentMap = new Map();
  G.symbols.forEach(s => { if (s.parentId) parentMap.set(s.id, s.parentId); });

  function findVisible(id) {
    let cur = id, depth = 0;
    while (cur && depth < 20) {
      if (visible.has(cur)) return cur;
      cur = parentMap.get(cur);
      depth++;
    }
    return null;
  }

  const TYPE_VERBS = {calls:"calls",imports:"imports",reads:"reads",writes:"writes to",inherits:"inherits",instantiates:"creates",uses_config:"config"};
  const edgeMap = new Map();

  G.relations.forEach(rel => {
    if (rel.type === "contains") return;
    const src = findVisible(rel.source);
    const tgt = findVisible(rel.target);
    if (!src || !tgt || src === tgt) return;
    const key = src + "|" + tgt;
    if (edgeMap.has(key)) {
      const e = edgeMap.get(key);
      e.count++;
      e.relationIds.push(rel.id);
      e.typeCounts[rel.type] = (e.typeCounts[rel.type] || 0) + 1;
    } else {
      edgeMap.set(key, {source:src,target:tgt,count:1,relationIds:[rel.id],typeCounts:{[rel.type]:1}});
    }
  });

  const result = [];
  edgeMap.forEach(agg => {
    let domType = "calls", maxC = 0;
    for (const [t,c] of Object.entries(agg.typeCounts)) { if (c > maxC) { maxC = c; domType = t; } }
    const entries = Object.entries(agg.typeCounts);
    let label;
    if (agg.count === 1) label = TYPE_VERBS[domType] || domType;
    else if (entries.length === 1) label = agg.count + "× " + (TYPE_VERBS[domType] || domType);
    else label = entries.sort((a,b) => b[1]-a[1]).map(([t,c]) => c+"× "+(TYPE_VERBS[t]||t)).join(", ");
    result.push({source:agg.source,target:agg.target,type:domType,count:agg.count,label,className:"et-"+domType+(entries.length>1?" et-multi":"")});
  });
  return result;
}

// ══════════════ Render View ══════════════

function renderView(viewId) {
  currentViewId = viewId;
  const view = viewMap.get(viewId);
  if (!view) return;

  const scope = view.scope || "";
  const { positions, width, height } = layoutView(view);
  const edges = projectEdgesForViewLocal(view);

  cv.innerHTML = "";
  cv.style.width = width + "px";
  cv.style.height = height + "px";

  // ── SVG edges ──
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("class", "edges-svg");
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  svg.style.width = width + "px";
  svg.style.height = height + "px";

  // Arrow markers
  const defs = document.createElementNS(svgNS, "defs");
  const arrowColors = {dim:"#8b8fa7",acc:"#6c8cff",grn:"#80e0a0",org:"#ffab70",yel:"#ffd866"};
  Object.entries(arrowColors).forEach(([name, color]) => {
    const marker = document.createElementNS(svgNS, "marker");
    marker.setAttribute("id", "arrow-" + name);
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "10");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "8");
    marker.setAttribute("markerHeight", "8");
    marker.setAttribute("orient", "auto-start-reverse");
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
    path.setAttribute("fill", color);
    marker.appendChild(path);
    defs.appendChild(marker);
  });
  svg.appendChild(defs);

  const typeToArrow = {calls:"acc",imports:"grn",reads:"grn",writes:"org",inherits:"yel",instantiates:"yel",uses_config:"dim",contains:"dim"};

  edges.forEach(e => {
    const sp = positions[e.source], tp = positions[e.target];
    if (!sp || !tp) return;
    const srcSym = symMap.get(e.source), tgtSym = symMap.get(e.target);
    const sw = estimateWidth(srcSym), sh = estimateHeight(srcSym);
    const tw = estimateWidth(tgtSym);

    const sx = sp.x + sw / 2, sy = sp.y + sh;
    const tx = tp.x + tw / 2, ty = tp.y;
    const dy = Math.abs(ty - sy);
    const cp = Math.max(40, dy * 0.4);
    const d = "M "+sx+" "+sy+" C "+sx+" "+(sy+cp)+" "+tx+" "+(ty-cp)+" "+tx+" "+ty;

    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", d);
    path.setAttribute("class", "edge-path " + (e.className || ""));
    path.setAttribute("marker-end", "url(#arrow-" + (typeToArrow[e.type] || "dim") + ")");
    svg.appendChild(path);

    if (e.label) {
      const text = document.createElementNS(svgNS, "text");
      text.setAttribute("x", (sx + tx) / 2);
      text.setAttribute("y", (sy + ty) / 2 - 6);
      text.setAttribute("class", "edge-label");
      text.setAttribute("text-anchor", "middle");
      text.textContent = e.label;
      svg.appendChild(text);
    }
  });
  cv.appendChild(svg);

  // ── Nodes ──
  view.nodeRefs.forEach(symId => {
    const sym = symMap.get(symId);
    if (!sym) return;
    const pos = positions[symId];
    if (!pos) return;

    const el = document.createElement("div");
    el.className = "node nk-"+sym.kind+(sym.kind==="class"?" cls-node":"")+(sym.kind==="module"&&(scope==="root"||scope==="group")?" is-overview":"");
    el.style.left = pos.x + "px";
    el.style.top = pos.y + "px";
    el.style.width = estimateWidth(sym) + "px";
    el.dataset.id = sym.id;

    if (sym.kind === "class") el.innerHTML = renderClassNode(sym, scope);
    else if (sym.kind === "function" || sym.kind === "method") el.innerHTML = renderFunctionNode(sym);
    else if (sym.kind === "external") el.innerHTML = renderArtifactNode(sym);
    else el.innerHTML = renderDefaultNode(sym, scope);

    el.addEventListener("click", function(ev) {
      if (ev.target.closest(".drilldown")) return;
      selectNode(sym.id);
    });
    el.addEventListener("mouseenter", function() {
      scheduleShowHover(sym.id, el.getBoundingClientRect());
    });
    el.addEventListener("mouseleave", function() {
      scheduleHideHover();
    });
    cv.appendChild(el);
  });

  renderSidebar();
  renderBreadcrumb();
  selectedNodeId = null;
  renderInspector();
  requestAnimationFrame(() => fitView());
}

// ── Node renderers ──

function renderDefaultNode(sym, scope) {
  let html = '<div class="node-hdr"><span class="kbadge kb-'+sym.kind+'">'+sym.kind+'</span><span class="nlbl">'+esc(sym.label)+'</span>';
  if (sym.tags && sym.tags.includes("dead-code")) html += '<span class="dead-tag" title="Dead code"><i class="bi bi-x-circle"></i></span>';
  html += '</div>';
  html += renderRelBadges(sym);
  if (sym.childViewId) html += renderDrilldown(sym);
  if (sym.kind === "group" || sym.kind === "module") {
    const ch = G.symbols.filter(s => s.parentId === sym.id);
    const cls = ch.filter(c => c.kind === "class").length;
    const fn = ch.filter(c => c.kind === "function" || c.kind === "method").length;
    const oth = ch.filter(c => c.kind !== "class" && c.kind !== "function" && c.kind !== "method").length;
    const parts = [];
    if (cls > 0) parts.push(cls + " class" + (cls > 1 ? "es" : ""));
    if (fn > 0) parts.push(fn + " fn");
    if (oth > 0) parts.push(oth + " other");
    if (parts.length > 0) html += '<div class="node-count">'+parts.join(", ")+'</div>';
  }
  return html;
}

function renderClassNode(sym) {
  const children = G.symbols.filter(s => s.parentId === sym.id);
  const attrs = children.filter(c => c.kind === "constant" || c.kind === "variable");
  const meths = children.filter(c => c.kind === "method" || c.kind === "function");

  let html = '<div class="node-hdr class-hdr"><div class="stereo">«class»</div><span class="nlbl">'+esc(sym.label)+'</span></div>';
  html += '<div class="compart">';
  if (attrs.length > 0) {
    attrs.forEach(a => {
      html += '<div class="compart-item"><span class="attr-i">−</span> '+esc(a.label);
      if (a.doc?.inputs?.[0]?.type) html += '<span class="type-h"> : '+esc(a.doc.inputs[0].type)+'</span>';
      html += '</div>';
    });
  } else html += '<div class="compart-empty">—</div>';
  html += '</div><div class="compart">';
  if (meths.length > 0) {
    meths.forEach(m => {
      const short = (m.label||"").split(".").pop()||m.label;
      html += '<div class="compart-item"><span class="meth-i">+</span> '+esc(short)+'()';
      if (m.doc?.inputs?.length > 0) html += '<span class="type-h">('+m.doc.inputs.map(p=>p.name).join(", ")+')</span>';
      html += '</div>';
    });
  } else html += '<div class="compart-empty">—</div>';
  html += '</div>';
  if (sym.childViewId) html += renderDrilldown(sym);
  return html;
}

function renderFunctionNode(sym) {
  let html = '<div class="node-hdr"><span class="kbadge kb-'+sym.kind+'">'+(sym.kind==="method"?"method":"fn")+'</span><span class="nlbl">'+esc((sym.label||"").split(".").pop()||sym.label)+'</span>';
  if (sym.tags && sym.tags.includes("dead-code")) html += '<span class="dead-tag" title="Dead code"><i class="bi bi-x-circle"></i></span>';
  html += '</div>';
  const inputs = sym.doc?.inputs || [];
  if (inputs.length > 0) {
    html += '<div class="fn-sig">('+inputs.map(p=>'<span class="pn">'+esc(p.name)+'</span>'+(p.type?'<span class="type-h">: '+esc(p.type)+'</span>':'')).join(", ")+')</div>';
  }
  const outputs = sym.doc?.outputs || [];
  if (outputs.length > 0) html += '<div class="fn-ret">→ '+outputs.map(o=>o.type||o.name).join(", ")+'</div>';
  html += renderRelBadges(sym);
  if (sym.childViewId) html += renderDrilldown(sym);
  return html;
}

function renderArtifactNode(sym) {
  const label = (sym.label||"").toLowerCase();
  let icon = '<i class="bi bi-file-earmark"></i>';
  if (label.includes(".csv")||label.includes(".xlsx")) icon = '<i class="bi bi-file-earmark-spreadsheet"></i>';
  else if (label.includes(".json")) icon = '<i class="bi bi-filetype-json"></i>';
  else if (label.includes(".pkl")||label.includes(".pickle")) icon = '<i class="bi bi-archive"></i>';
  else if (label.includes("db")||label.includes("sql")) icon = '<i class="bi bi-database"></i>';
  else if (label.includes("http")||label.includes("api")) icon = '<i class="bi bi-globe"></i>';
  let html = '<div class="node-hdr"><span style="font-size:18px">'+icon+'</span><span class="nlbl">'+esc(sym.label)+'</span></div>';
  html += renderRelBadges(sym);
  return html;
}

function renderRelBadges(sym) {
  const rels = G.relations.filter(r => (r.source === sym.id || r.target === sym.id) && r.type !== "contains");
  const types = new Set(rels.map(r => r.type));
  if (types.size === 0) return "";
  const META = {reads:{icon:'<i class="bi bi-book"></i>',label:"reads"},writes:{icon:'<i class="bi bi-pencil-square"></i>',label:"writes"},calls:{icon:'<i class="bi bi-telephone-outbound"></i>',label:"calls"},imports:{icon:'<i class="bi bi-box-arrow-in-down"></i>',label:"imports"},inherits:{icon:'<i class="bi bi-diagram-3"></i>',label:"inherits"},instantiates:{icon:'<i class="bi bi-lightning"></i>',label:"creates"},uses_config:{icon:'<i class="bi bi-gear"></i>',label:"config"}};
  let html = '<div class="rbadges">';
  types.forEach(t => {
    if (t === "imports") return;
    const m = META[t];
    if (m) html += '<span class="rbadge rb-'+t+'">'+m.icon+" "+m.label+'</span>';
  });
  return html + '</div>';
}

function renderDrilldown(sym) {
  return '<div class="drilldown" onclick="event.stopPropagation();navigateToView(\\''+sym.childViewId+'\\')">'+
    (sym.kind==="class"?"▶ Methods detail":"▶ Drill down")+'</div>';
}

function esc(s) {
  if (!s) return "";
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function deadCodeReasonText(sym, doc, inboundCallCount, outboundCallCount) {
  const explicit = (doc && doc.deadCodeReason ? String(doc.deadCodeReason) : "").trim();
  if (explicit) return explicit;
  if (inboundCallCount === 0 && outboundCallCount === 0) {
    return "Keine eingehenden oder ausgehenden Aufrufbeziehungen gefunden. Das Symbol ist im aktuellen Graphen nicht eingebunden und wurde deshalb als Dead Code markiert.";
  }
  if (inboundCallCount === 0) {
    return "Keine eingehenden Aufrufe/Instanziierungen gefunden. Das Symbol wird aktuell von keinem anderen Symbol verwendet und wurde deshalb als Dead Code markiert.";
  }
  return "Das Symbol trägt das Dead-Code-Tag, aber es liegt keine detaillierte LLM-Begründung vor.";
}

function kindBadgeHtml(kind) {
  const b = KIND_BADGE[kind] || {letter:(kind||"?")[0].toUpperCase(),color:"#888"};
  return '<span class="kind-badge" style="background:'+b.color+'22;color:'+b.color+'" title="'+kind+'">'+b.letter+'</span>';
}

// ══════════════ Fit View ══════════════

function fitView() {
  const vpRect = vp.getBoundingClientRect();
  const cw = parseInt(cv.style.width) || 800;
  const ch = parseInt(cv.style.height) || 600;
  if (cw === 0 || ch === 0) return;
  const scaleX = (vpRect.width - 40) / cw;
  const scaleY = (vpRect.height - 40) / ch;
  zoom = Math.max(0.05, Math.min(1.5, Math.min(scaleX, scaleY)));
  panX = (vpRect.width - cw * zoom) / 2;
  panY = (vpRect.height - ch * zoom) / 2;
  applyTransform();
}

// ══════════════ Sidebar ══════════════

function renderSidebar() {
  const sb = document.getElementById("sidebar");

  // ── Search ──
  let html = '<div class="sidebar-section">';
  html += '<div class="symbol-search">';
  html += '<div class="symbol-search__input-wrap">';
  html += '<span class="symbol-search__icon"><i class="bi bi-search"></i></span>';
  html += '<input class="symbol-search__input" id="searchInput" type="text" placeholder="Suche nach Symbolen…">';
  html += '<button class="symbol-search__clear" id="searchClear" style="display:none"><i class="bi bi-x-lg"></i></button>';
  html += '</div>';
  html += '<div class="symbol-search__dropdown" id="searchDropdown" style="display:none"></div>';
  html += '</div></div>';

  // ── Views Tree ──
  html += '<div class="sidebar-section"><h2>Views</h2><div class="view-tree" id="viewTree"></div></div>';
  sb.innerHTML = html;

  // Build tree
  const tree = document.getElementById("viewTree");
  const childMap = new Map();
  const roots = [];
  G.views.forEach(v => {
    if (!v.parentViewId) roots.push(v);
    else {
      if (!childMap.has(v.parentViewId)) childMap.set(v.parentViewId, []);
      childMap.get(v.parentViewId).push(v);
    }
  });

  // Build symbol-per-view map (excluding symbols that own child views)
  const viewOwnerIds = new Set();
  G.views.forEach(v => {
    G.symbols.forEach(s => { if (s.childViewId === v.id) viewOwnerIds.add(s.id); });
  });

  const symbolsByView = new Map();
  G.views.forEach(v => {
    const syms = [];
    v.nodeRefs.forEach(nid => {
      if (viewOwnerIds.has(nid)) return;
      const sym = symMap.get(nid);
      if (sym) syms.push(sym);
    });
    const kindOrder = {class:0,module:1,function:2,method:3,constant:4,script:5};
    syms.sort((a,b) => (kindOrder[a.kind]??9)-(kindOrder[b.kind]??9) || a.label.localeCompare(b.label));
    if (syms.length > 0) symbolsByView.set(v.id, syms);
  });

  // Dead symbol IDs
  const deadIds = new Set();
  G.symbols.forEach(s => { if (s.tags && s.tags.includes("dead-code")) deadIds.add(s.id); });

  function renderTreeItem(v, level, container) {
    const childViews = childMap.get(v.id) || [];
    const viewSyms = symbolsByView.get(v.id) || [];
    const hasKids = childViews.length > 0 || viewSyms.length > 0;
    const isActive = v.id === currentViewId;
    const icon = SCOPE_ICONS[v.scope || ""] || '<i class="bi bi-folder"></i>';
    const hasDead = v.nodeRefs.some(id => deadIds.has(id));

    const item = document.createElement("div");
    item.className = "vt-item" + (isActive ? " active" : "") + (hasDead ? " vt-item--dead" : "");
    item.style.paddingLeft = (8 + level * 16) + "px";

    let chevron = null;
    if (hasKids) {
      chevron = document.createElement("span");
      chevron.className = "vt-chv open";
      chevron.textContent = "▸";
      item.appendChild(chevron);
    } else {
      const sp = document.createElement("span");
      sp.className = "vt-chv vt-chv--leaf";
      item.appendChild(sp);
    }

    const icoEl = document.createElement("span");
    icoEl.className = "vt-ico";
    icoEl.innerHTML = icon;
    item.appendChild(icoEl);

    const lbl = document.createElement("span");
    lbl.className = "vt-lbl";
    lbl.textContent = v.title;
    item.appendChild(lbl);

    item.addEventListener("click", function(e) {
      if (e.target === chevron) return;
      navigateToView(v.id);
    });
    container.appendChild(item);

    if (hasKids) {
      const childContainer = document.createElement("div");
      childContainer.style.display = "";

      // Child views first
      childViews.forEach(c => renderTreeItem(c, level + 1, childContainer));

      // Then leaf symbols
      viewSyms.forEach(sym => {
        const symItem = document.createElement("div");
        symItem.className = "vt-item vt-sym" + (deadIds.has(sym.id) ? " vt-sym--dead" : "");
        symItem.style.paddingLeft = (8 + (level+1) * 16) + "px";

        const leafSp = document.createElement("span");
        leafSp.className = "vt-chv vt-chv--leaf";
        symItem.appendChild(leafSp);

        const badge = document.createElement("span");
        badge.innerHTML = kindBadgeHtml(sym.kind);
        symItem.appendChild(badge.firstChild);

        const symLbl = document.createElement("span");
        symLbl.className = "vt-lbl";
        symLbl.textContent = (sym.label || "").split(".").pop() || sym.label;
        symItem.appendChild(symLbl);

        symItem.addEventListener("click", function(e) {
          e.stopPropagation();
          navigateToSymbol(sym.id);
        });
        childContainer.appendChild(symItem);
      });

      container.appendChild(childContainer);

      if (chevron) {
        let collapsed = level > 1; // collapse deeper levels by default
        if (collapsed) childContainer.style.display = "none";
        // Auto-expand path to current view
        if (isAncestorOf(v.id, currentViewId)) {
          collapsed = false;
          childContainer.style.display = "";
          chevron.classList.add("open");
        }
        if (collapsed) chevron.classList.remove("open");

        chevron.addEventListener("click", function(e) {
          e.stopPropagation();
          collapsed = !collapsed;
          childContainer.style.display = collapsed ? "none" : "";
          chevron.classList.toggle("open");
        });
      }
    }
  }

  roots.forEach(v => renderTreeItem(v, 0, tree));

  // ── Search logic ──
  const searchInput = document.getElementById("searchInput");
  const searchClear = document.getElementById("searchClear");
  const searchDropdown = document.getElementById("searchDropdown");
  let searchFocused = false;

  searchInput.addEventListener("input", updateSearch);
  searchInput.addEventListener("focus", function() { searchFocused = true; updateSearch(); });
  searchInput.addEventListener("blur", function() { setTimeout(function() { searchFocused = false; searchDropdown.style.display = "none"; }, 200); });
  searchInput.addEventListener("keydown", function(e) {
    if (e.key === "Escape") { searchInput.value = ""; searchInput.blur(); updateSearch(); }
  });
  searchClear.addEventListener("click", function() { searchInput.value = ""; updateSearch(); searchInput.focus(); });

  function updateSearch() {
    const q = (searchInput.value || "").trim().toLowerCase();
    searchClear.style.display = q ? "" : "none";
    if (q.length < 2 || !searchFocused) {
      searchDropdown.style.display = "none";
      return;
    }
    const results = G.symbols.filter(s =>
      s.label.toLowerCase().includes(q) || s.kind.includes(q) || (s.doc?.summary || "").toLowerCase().includes(q)
    ).slice(0, 50);

    if (results.length === 0) {
      searchDropdown.innerHTML = '<div class="symbol-search__empty">Keine Ergebnisse</div>';
    } else {
      searchDropdown.innerHTML = results.map(s =>
        '<div class="symbol-search__result" data-sid="'+s.id+'">'+
        kindBadgeHtml(s.kind)+
        '<span class="symbol-search__result-label">'+esc(s.label)+'</span>'+
        '<span class="symbol-search__result-kind">'+s.kind+'</span></div>'
      ).join("");

      searchDropdown.querySelectorAll(".symbol-search__result").forEach(el => {
        el.addEventListener("mousedown", function(e) {
          e.preventDefault();
          navigateToSymbol(el.dataset.sid);
          searchInput.value = "";
          updateSearch();
        });
      });
    }
    searchDropdown.style.display = "";
  }
}

function isAncestorOf(viewId, targetViewId) {
  let cur = viewMap.get(targetViewId);
  while (cur) {
    if (cur.id === viewId) return true;
    cur = cur.parentViewId ? viewMap.get(cur.parentViewId) : null;
  }
  return false;
}

// ══════════════ Breadcrumb ══════════════

function renderBreadcrumb() {
  const bc = document.getElementById("breadcrumb");
  bc.innerHTML = "";
  const path = [];
  let cur = viewMap.get(currentViewId);
  while (cur) {
    path.unshift(cur);
    cur = cur.parentViewId ? viewMap.get(cur.parentViewId) : null;
  }
  path.forEach((v, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "sep";
      sep.textContent = "›";
      bc.appendChild(sep);
    }
    const btn = document.createElement("button");
    btn.textContent = v.title;
    if (v.id === currentViewId) btn.style.fontWeight = "600";
    btn.addEventListener("click", function() { navigateToView(v.id); });
    bc.appendChild(btn);
  });
}

// ══════════════ Navigation ══════════════

function navigateToView(viewId) {
  if (!viewMap.has(viewId)) return;
  hideHoverCard();
  renderView(viewId);
}

function navigateToSymbol(symId) {
  let bestView = null;
  G.views.forEach(v => {
    if (v.nodeRefs.includes(symId)) {
      if (!bestView || (v.parentViewId && v.parentViewId !== G.rootViewId)) bestView = v.id;
    }
  });
  if (bestView && bestView !== currentViewId) renderView(bestView);
  selectNode(symId);
  const nodeEl = document.querySelector('.node[data-id="'+symId+'"]');
  if (nodeEl) {
    const vpRect = vp.getBoundingClientRect();
    const nodeX = parseFloat(nodeEl.style.left), nodeY = parseFloat(nodeEl.style.top);
    const nodeW = nodeEl.offsetWidth, nodeH = nodeEl.offsetHeight;
    panX = vpRect.width / 2 - (nodeX + nodeW / 2) * zoom;
    panY = vpRect.height / 2 - (nodeY + nodeH / 2) * zoom;
    applyTransform();
  }
}

// ══════════════ Select Node → Inspector ══════════════

function selectNode(symId) {
  document.querySelectorAll(".node.selected").forEach(n => n.classList.remove("selected"));
  selectedNodeId = symId;
  const nodeEl = document.querySelector('.node[data-id="'+symId+'"]');
  if (nodeEl) nodeEl.classList.add("selected");
  renderInspector();
}

// ══════════════ Inspector ══════════════

function renderInspector() {
  const insp = document.getElementById("inspector");
  if (!selectedNodeId) {
    insp.innerHTML = '<div class="insp-empty">Node anklicken für Details</div>';
    return;
  }

  const sym = symMap.get(selectedNodeId);
  if (!sym) { insp.innerHTML = '<div class="insp-empty">Symbol nicht gefunden</div>'; return; }

  const doc = sym.doc || {};
  const loc = sym.location;
  const parent = sym.parentId ? symMap.get(sym.parentId) : null;
  const children = G.symbols.filter(s => s.parentId === sym.id);
  const rels = G.relations.filter(r => r.source === sym.id || r.target === sym.id);
  const outCalls = rels.filter(r => r.source===sym.id && r.type==="calls").map(r => ({rel:r,sym:symMap.get(r.target)}));
  const inCalls = rels.filter(r => r.target===sym.id && r.type==="calls").map(r => ({rel:r,sym:symMap.get(r.source)}));
  const reads = rels.filter(r => r.source===sym.id && r.type==="reads").map(r => ({rel:r,sym:symMap.get(r.target)}));
  const writes = rels.filter(r => r.source===sym.id && r.type==="writes").map(r => ({rel:r,sym:symMap.get(r.target)}));
  const imports = rels.filter(r => r.source===sym.id && r.type==="imports").map(r => ({rel:r,sym:symMap.get(r.target)}));
  const importedBy = rels.filter(r => r.target===sym.id && r.type==="imports").map(r => ({rel:r,sym:symMap.get(r.source)}));
  const inherits = rels.filter(r => r.source===sym.id && r.type==="inherits").map(r => ({rel:r,sym:symMap.get(r.target)}));
  const instantiates = rels.filter(r => r.source===sym.id && r.type==="instantiates").map(r => ({rel:r,sym:symMap.get(r.target)}));
  const instantiatedBy = rels.filter(r => r.target===sym.id && r.type==="instantiates").map(r => ({rel:r,sym:symMap.get(r.source)}));
  const isDeadCode = !!(sym.tags && sym.tags.includes("dead-code"));
  const deadReason = deadCodeReasonText(sym, doc, inCalls.length + instantiatedBy.length, outCalls.length + instantiates.length);

  const KIND_COLORS = {function:"#80e0a0",method:"#80e0a0",class:"#ffd866",module:"#6c8cff",package:"#6c8cff",group:"#6c8cff",interface:"#c9a0ff",variable:"#ff9070",constant:"#ff9070",external:"#8b8fa7",script:"#e0e0e0"};
  const kc = KIND_COLORS[sym.kind] || "#8b8fa7";

  let html = '<h2>Inspector</h2>';
  html += '<div class="insp-card">';
  html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span class="insp-badge" style="background:'+kc+'">'+sym.kind+'</span><h3 style="margin:0">'+esc(sym.label)+'</h3></div>';

  if (loc) {
    const lc = (loc.startLine != null && loc.endLine != null) ? (loc.endLine - loc.startLine + 1) : null;
    html += '<div class="insp-row"><span class="insp-lbl"><i class="bi bi-file-earmark"></i> Datei</span><span class="insp-val" style="font-family:monospace;font-size:10px">'+esc(loc.file)+(loc.startLine!=null?":"+loc.startLine:"")+(loc.endLine!=null?"-"+loc.endLine:"")+(lc?" ("+lc+" Zeilen)":"")+'</span></div>';
  }

  if (parent) {
    html += '<div class="insp-row"><span class="insp-lbl"><i class="bi bi-box"></i> In</span><span class="insp-val"><span class="insp-link" onclick="navigateToSymbol(\\''+parent.id+'\\')">'+esc(parent.label)+'</span> ('+parent.kind+')</span></div>';
  }

  if (sym.kind === "function" || sym.kind === "method") {
    const sigP = (doc.inputs||[]).map(p => p.name+(p.type?": "+p.type:"")).join(", ");
    const retT = (doc.outputs||[]).map(o => o.type||o.name).join(", ");
    html += '<div class="insp-sig"><span class="sig-kw">def</span> '+esc((sym.label||"").split(".").pop())+'<span class="sig-parens">(</span><span class="sig-params">'+esc(sigP||"…")+'</span><span class="sig-parens">)</span>'+(retT?'<span class="sig-arrow"> → </span><span class="sig-ret">'+esc(retT)+'</span>':'')+'</div>';
  }
  html += '</div>';

  if (doc.summary) {
    html += '<div class="insp-card"><div class="insp-section-lbl">Beschreibung</div><div class="insp-summary">'+esc(doc.summary)+'</div></div>';
  }

  if (doc.inputs && doc.inputs.length > 0) {
    html += '<div class="insp-card"><div class="insp-section-lbl"><i class="bi bi-arrow-down"></i> Parameter</div><div class="hc-tbl">';
    doc.inputs.forEach(p => {
      html += '<div class="hc-tbl-row"><span class="hc-pn">'+esc(p.name)+'</span>';
      if (p.type) html += '<span class="hc-pt">'+esc(p.type)+'</span>';
      if (p.description) html += '<span class="hc-pd">'+esc(p.description)+'</span>';
      html += '</div>';
    });
    html += '</div></div>';
  }

  if (doc.outputs && doc.outputs.length > 0) {
    html += '<div class="insp-card"><div class="insp-section-lbl"><i class="bi bi-arrow-up"></i> Rückgabe</div><div class="hc-tbl">';
    doc.outputs.forEach(o => {
      html += '<div class="hc-tbl-row"><span class="hc-pn">'+esc(o.name)+'</span>';
      if (o.type) html += '<span class="hc-pt">'+esc(o.type)+'</span>';
      if (o.description) html += '<span class="hc-pd">'+esc(o.description)+'</span>';
      html += '</div>';
    });
    html += '</div></div>';
  }

  function relCard(title, icon, items) {
    if (items.length === 0) return "";
    let h = '<div class="insp-card"><div class="insp-section-lbl">'+icon+" "+title+'</div><div class="insp-chips">';
    items.forEach(i => {
      const s = i.sym;
      if (s) h += '<span class="insp-chip" onclick="navigateToSymbol(\\''+s.id+'\\')">'+esc(s.label)+'</span>';
    });
    return h + '</div></div>';
  }

  html += relCard("Ruft auf",'<i class="bi bi-arrow-right"></i>',outCalls);
  html += relCard("Aufgerufen von",'<i class="bi bi-arrow-left"></i>',inCalls);
  html += relCard("Liest",'<i class="bi bi-book"></i>',reads);
  html += relCard("Schreibt",'<i class="bi bi-pencil-square"></i>',writes);
  html += relCard("Importiert",'<i class="bi bi-box-arrow-in-down"></i>',imports);
  html += relCard("Importiert von",'<i class="bi bi-box-arrow-up"></i>',importedBy);
  html += relCard("Erbt von",'<i class="bi bi-diagram-3"></i>',inherits);
  html += relCard("Instanziiert",'<i class="bi bi-lightning"></i>',instantiates);

  if (doc.sideEffects && doc.sideEffects.length > 0) {
    html += '<div class="insp-card"><div class="insp-section-lbl"><i class="bi bi-exclamation-triangle"></i> Seiteneffekte</div><ul class="insp-se">';
    doc.sideEffects.forEach(se => { html += '<li>'+esc(se)+'</li>'; });
    html += '</ul></div>';
  }

  if (children.length > 0) {
    html += '<div class="insp-card"><div class="insp-section-lbl"><i class="bi bi-folder"></i> Enthält ('+children.length+')</div><div class="insp-chips">';
    children.slice(0,20).forEach(c => {
      html += '<span class="insp-chip" onclick="navigateToSymbol(\\''+c.id+'\\')">'+esc(c.label.split(".").pop()||c.label)+'</span>';
    });
    if (children.length>20) html += '<span style="color:var(--text-dim);font-size:10px">+'+(children.length-20)+' weitere</span>';
    html += '</div></div>';
  }

  if (sym.tags && sym.tags.length > 0) {
    html += '<div class="insp-tags">';
    sym.tags.forEach(t => {
      html += '<span class="insp-tag'+(t==="dead-code"?" insp-tag-dead":"")+'">'+(t==="dead-code"?'<i class="bi bi-x-circle"></i> ':"")+esc(t)+'</span>';
    });
    html += '</div>';
  }

  if (isDeadCode) {
    html += '<div class="insp-card"><div class="insp-section-lbl"><i class="bi bi-x-circle"></i> Dead Code — Begründung</div><div class="insp-summary">'+esc(deadReason)+'</div></div>';
  }

  insp.innerHTML = html;
}

// ══════════════ Hover Card ══════════════

function scheduleShowHover(symId, rect) {
  cancelHideHover();
  if (hoverTimer) clearTimeout(hoverTimer);
  hoverTimer = setTimeout(function() { showHoverCard(symId, rect); hoverTimer = null; }, 350);
}
function scheduleHideHover() {
  if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
  hideTimer = setTimeout(function() { hideHoverCard(); hideTimer = null; }, 250);
}
function cancelHideHover() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
}

function showHoverCard(symId, rect) {
  const sym = symMap.get(symId);
  if (!sym) return;

  const card = document.getElementById("hoverCard");
  const x = rect.right + 12 + 380 > window.innerWidth ? rect.left - 392 : rect.right + 12;
  const y = Math.max(8, Math.min(rect.top, window.innerHeight - 500));
  card.style.left = x + "px";
  card.style.top = y + "px";
  card.style.display = "block";

  const doc = sym.doc || {};
  const loc = sym.location;
  const parent = sym.parentId ? symMap.get(sym.parentId) : null;
  const children = G.symbols.filter(s => s.parentId === sym.id);
  const rels = G.relations.filter(r => (r.source === sym.id || r.target === sym.id) && r.type !== "contains");

  const KIND_COLORS = {function:"#80e0a0",method:"#80e0a0",class:"#ffd866",module:"#6c8cff",package:"#6c8cff",group:"#6c8cff",interface:"#c9a0ff",variable:"#ff9070",constant:"#ff9070",external:"#8b8fa7",script:"#e0e0e0"};
  const kc = KIND_COLORS[sym.kind] || "#8b8fa7";

  let html = '<div class="hc-hdr"><span class="hc-kb" style="background:'+kc+'">'+sym.kind+'</span><span class="hc-name">'+esc(sym.label)+'</span></div>';

  if (loc) {
    const lc = (loc.startLine!=null && loc.endLine!=null) ? (loc.endLine-loc.startLine+1) : null;
    html += '<div class="hc-loc"><i class="bi bi-file-earmark"></i> '+esc(loc.file)+(loc.startLine?":"+loc.startLine:"")+(loc.endLine?"-"+loc.endLine:"")+(lc?" ("+lc+" Zeilen)":"")+'</div>';
  }

  if (parent) {
    html += '<div class="hc-parent"><i class="bi bi-box"></i> in: <span class="insp-link" onclick="navigateToSymbol(\\''+parent.id+'\\')">'+esc(parent.label)+'</span> ('+parent.kind+')</div>';
  }

  if (sym.kind === "function" || sym.kind === "method") {
    const sp = (doc.inputs||[]).map(p => p.name+(p.type?": "+p.type:"")).join(", ");
    const rt = (doc.outputs||[]).map(o => o.type||o.name).join(", ");
    html += '<div class="hc-sig"><span class="sig-kw">def</span> '+esc((sym.label||"").split(".").pop())+'<span class="sig-parens">(</span><span class="sig-params">'+esc(sp||"…")+'</span><span class="sig-parens">)</span>'+(rt?'<span class="sig-arrow"> → </span><span class="sig-ret">'+esc(rt)+'</span>':'')+'</div>';
  }

  if (doc.summary) {
    html += '<div class="hc-section"><div class="hc-slbl">Beschreibung</div><div class="hc-summary">'+esc(doc.summary)+'</div></div>';
  }

  if (doc.inputs && doc.inputs.length > 0) {
    html += '<div class="hc-section"><div class="hc-slbl"><i class="bi bi-arrow-down"></i> Parameter</div><div class="hc-tbl">';
    doc.inputs.forEach(p => {
      html += '<div class="hc-tbl-row"><span class="hc-pn">'+esc(p.name)+'</span>';
      if (p.type) html += '<span class="hc-pt">'+esc(p.type)+'</span>';
      if (p.description) html += '<span class="hc-pd">'+esc(p.description)+'</span>';
      html += '</div>';
    });
    html += '</div></div>';
  }

  // Relations
  const TYPE_LABELS = {calls:['<i class="bi bi-arrow-right"></i> Ruft auf','<i class="bi bi-arrow-left"></i> Aufgerufen von'],reads:['<i class="bi bi-book"></i> Liest',null],writes:['<i class="bi bi-pencil-square"></i> Schreibt',null],imports:['<i class="bi bi-box-arrow-in-down"></i> Importiert','<i class="bi bi-box-arrow-up"></i> Importiert von'],inherits:['<i class="bi bi-diagram-3"></i> Erbt von',null],instantiates:['<i class="bi bi-lightning"></i> Instanziiert',null],uses_config:['<i class="bi bi-gear"></i> Konfiguration',null]};
  const outgoing = {}, incoming = {};
  rels.forEach(r => {
    if (r.source === sym.id) { if (!outgoing[r.type]) outgoing[r.type]=[]; outgoing[r.type].push(symMap.get(r.target)); }
    else { if (!incoming[r.type]) incoming[r.type]=[]; incoming[r.type].push(symMap.get(r.source)); }
  });

  for (const [type, [outLabel, inLabel]] of Object.entries(TYPE_LABELS)) {
    if (outgoing[type] && outgoing[type].length > 0) {
      html += '<div class="hc-section"><div class="hc-slbl">'+outLabel+'</div><div class="hc-chips">';
      outgoing[type].forEach(s => { if (s) html += '<span class="hc-chip" onclick="navigateToSymbol(\\''+s.id+'\\')">'+esc(s.label)+'</span>'; });
      html += '</div></div>';
    }
    if (inLabel && incoming[type] && incoming[type].length > 0) {
      html += '<div class="hc-section"><div class="hc-slbl">'+inLabel+'</div><div class="hc-chips">';
      incoming[type].forEach(s => { if (s) html += '<span class="hc-chip" onclick="navigateToSymbol(\\''+s.id+'\\')">'+esc(s.label)+'</span>'; });
      html += '</div></div>';
    }
  }

  const isDeadCode = !!(sym.tags && sym.tags.includes("dead-code"));
  if (isDeadCode) {
    const inCalls = rels.filter(r => r.target === sym.id && r.type === "calls").length;
    const outCalls = rels.filter(r => r.source === sym.id && r.type === "calls").length;
    const instantiatedBy = rels.filter(r => r.target === sym.id && r.type === "instantiates").length;
    const instantiates = rels.filter(r => r.source === sym.id && r.type === "instantiates").length;
    const deadReason = deadCodeReasonText(sym, doc, inCalls + instantiatedBy, outCalls + instantiates);
    html += '<div class="hc-section"><div class="hc-slbl"><i class="bi bi-x-circle"></i> Dead Code — Begründung</div><div class="hc-summary">'+esc(deadReason)+'</div></div>';
  }

  if (doc.sideEffects && doc.sideEffects.length > 0) {
    html += '<div class="hc-section"><div class="hc-slbl"><i class="bi bi-exclamation-triangle"></i> Seiteneffekte</div><ul class="hc-se">';
    doc.sideEffects.forEach(se => { html += '<li>'+esc(se)+'</li>'; });
    html += '</ul></div>';
  }

  if (children.length > 0) {
    html += '<div class="hc-section"><div class="hc-slbl"><i class="bi bi-folder"></i> Enthält ('+children.length+')</div><div class="hc-chips">';
    children.slice(0,12).forEach(c => { html += '<span class="hc-chip" onclick="navigateToSymbol(\\''+c.id+'\\')">'+esc(c.label.split(".").pop()||c.label)+'</span>'; });
    if (children.length>12) html += '<span style="color:var(--text-dim);font-size:10px">+'+(children.length-12)+' weitere</span>';
    html += '</div></div>';
  }

  if (sym.tags && sym.tags.length > 0) {
    html += '<div class="hc-tags">';
    sym.tags.forEach(t => { html += '<span class="hc-tag'+(t==="dead-code"?" hc-tag-dead":"")+'">'+(t==="dead-code"?'<i class="bi bi-x-circle"></i> ':"")+esc(t)+'</span>'; });
    html += '</div>';
  }

  html += '<div class="hc-footer">Klick auf Node = Inspector · Drilldown via <i class="bi bi-caret-right-fill"></i></div>';
  card.innerHTML = html;
}

function hideHoverCard() {
  document.getElementById("hoverCard").style.display = "none";
}

hoverCard.addEventListener("mouseenter", cancelHideHover);
hoverCard.addEventListener("mouseleave", scheduleHideHover);

// ══════════════ Keyboard ══════════════
document.addEventListener("keydown", function(e) {
  if (e.key === "Escape") hideHoverCard();
});

// ══════════════ Init ══════════════
renderView(G.rootViewId);
`;
