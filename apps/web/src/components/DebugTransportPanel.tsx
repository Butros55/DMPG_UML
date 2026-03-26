import { useAppStore } from "../store";

/**
 * Floating debug overlay showing transport/navigation state.
 * Toggle via the debug button in the header or store.toggleDebugTransport().
 */
export function DebugTransportPanel() {
  const show = useAppStore((s) => s.showDebugTransport);
  const debug = useAppStore((s) => s.debugTransport);
  const debugDiagram = useAppStore((s) => s.debugDiagram);
  const aiAnalysis = useAppStore((s) => s.aiAnalysis);
  const toggle = useAppStore((s) => s.toggleDebugTransport);

  if (!show) return null;

  const age = debug?.lastEventTime
    ? `${Math.round((Date.now() - debug.lastEventTime) / 1000)}s ago`
    : "—";

  return (
    <div className="debug-transport-panel">
      <div className="debug-transport-header">
        <span><i className="bi bi-bug" /> Debug</span>
        <button className="debug-transport-close" onClick={toggle}><i className="bi bi-x-lg" /></button>
      </div>
      <div className="debug-transport-body">
        <div className="debug-row">
          <span className="debug-label">Route mode</span>
          <span className="debug-value">{debugDiagram?.routeMode ?? "—"}</span>
        </div>
        <div className="debug-row">
          <span className="debug-label">Route reason</span>
          <span className="debug-value">{debugDiagram?.routeReason ?? "—"}</span>
        </div>
        <div className="debug-row">
          <span className="debug-label">Layout pass</span>
          <span className="debug-value">
            {debugDiagram?.layoutPass ?? 0} / run {debugDiagram?.layoutRunId ?? 0}
          </span>
        </div>
        <div className="debug-row">
          <span className="debug-label">Nodes / edges</span>
          <span className="debug-value">
            {debugDiagram?.nodesRendered ?? 0}/{debugDiagram?.viewNodes ?? 0}
            {" · "}
            {debugDiagram?.edgesRendered ?? 0}/{debugDiagram?.viewEdges ?? 0}
          </span>
        </div>
        <div className="debug-row">
          <span className="debug-label">ELK routes</span>
          <span className="debug-value">
            {debugDiagram?.elkRouteCount ?? 0} · handles {debugDiagram?.edgeHandleCount ?? 0}
          </span>
        </div>
        <div className="debug-row">
          <span className="debug-label">Dynamic ports</span>
          <span className="debug-value">
            {debugDiagram?.dynamicPortNodeCount ?? 0} nodes · {debugDiagram?.dynamicPortCount ?? 0} ports
          </span>
        </div>
        <div className="debug-row">
          <span className="debug-label">Layout state</span>
          <span className="debug-value">
            auto={debugDiagram?.autoLayout ? "on" : "off"}
            {" · "}draggable={debugDiagram?.nodesDraggable ? "on" : "off"}
            {" · "}drag={debugDiagram?.dragActive ? "on" : "off"}
            {" · "}manual={debugDiagram?.effectiveManualLayout ? "on" : "off"}
          </span>
        </div>
        <div className="debug-row">
          <span className="debug-label">Saved pos</span>
          <span className="debug-value">
            {debugDiagram?.savedPositionCount ?? 0}
            {" · all="}
            {debugDiagram?.allHaveSavedPositions ? "yes" : "no"}
          </span>
        </div>
        <div className="debug-row">
          <span className="debug-label">Last trigger</span>
          <span className="debug-value">{debugDiagram?.lastLayoutTrigger ?? "—"}</span>
        </div>
        <div className="debug-row">
          <span className="debug-label">View</span>
          <span className="debug-value debug-value--mono">{debugDiagram?.currentViewId ?? "—"}</span>
        </div>
        <div className="debug-row">
          <span className="debug-label">Fingerprint</span>
          <span className="debug-value debug-value--mono">{debugDiagram?.layoutFingerprint || "—"}</span>
        </div>
        <div className="debug-row">
          <span className="debug-label">Layout key</span>
          <span className="debug-value debug-value--mono">{debugDiagram?.layoutKey || "—"}</span>
        </div>
        <div className="debug-sep" />
        <div className="debug-row">
          <span className="debug-label">SSE</span>
          <span className={`debug-dot ${debug?.sseConnected ? "debug-dot--on" : ""}`} />
          <span>{debug?.sseConnected ? "connected" : "disconnected"}</span>
        </div>
        <div className="debug-row">
          <span className="debug-label">Events Poller</span>
          <span className={`debug-dot ${debug?.eventsPollerActive ? "debug-dot--on" : ""}`} />
          <span>{debug?.eventsPollerActive ? "active" : "idle"}</span>
        </div>
        <div className="debug-row">
          <span className="debug-label">Status Poller</span>
          <span className={`debug-dot ${debug?.statusPollerActive ? "debug-dot--on" : ""}`} />
          <span>{debug?.statusPollerActive ? "active" : "idle"}</span>
        </div>
        <div className="debug-sep" />
        <div className="debug-row">
          <span className="debug-label">Last SSE seq</span>
          <span className="debug-value">{debug?.lastSseSeq ?? 0}</span>
        </div>
        <div className="debug-row">
          <span className="debug-label">Last Poll seq</span>
          <span className="debug-value">{debug?.lastPollSeq ?? 0}</span>
        </div>
        <div className="debug-row">
          <span className="debug-label">Events delivered</span>
          <span className="debug-value">{debug?.eventsDelivered ?? 0}</span>
        </div>
        <div className="debug-row">
          <span className="debug-label">Last event</span>
          <span className="debug-value">{age}</span>
        </div>
        <div className="debug-sep" />
        <div className="debug-row">
          <span className="debug-label">AI Phase</span>
          <span className="debug-value">{aiAnalysis?.phase ?? "—"}</span>
        </div>
        <div className="debug-row">
          <span className="debug-label">AI Running</span>
          <span className={`debug-dot ${aiAnalysis?.running ? "debug-dot--on" : ""}`} />
          <span>{aiAnalysis?.running ? "yes" : "no"}</span>
        </div>
        <div className="debug-row">
          <span className="debug-label">Nav Paused</span>
          <span>{aiAnalysis?.navPaused ? "yes" : "no"}</span>
        </div>
        <div className="debug-row">
          <span className="debug-label">Queue len</span>
          <span className="debug-value">{debug?.playbackQueueLen ?? aiAnalysis?.playbackQueue.length ?? 0}</span>
        </div>
        <div className="debug-row">
          <span className="debug-label">Playback active</span>
          <span>{aiAnalysis?.playbackActive ? "yes" : "no"}</span>
        </div>
        <div className="debug-row">
          <span className="debug-label">Nav req / settled</span>
          <span className="debug-value">
            {aiAnalysis?.navigationRequestedSeq ?? 0} / {aiAnalysis?.navigationSettledSeq ?? 0}
          </span>
        </div>
        <div className="debug-row">
          <span className="debug-label">Nav target</span>
          <span className="debug-value debug-value--mono">{aiAnalysis?.navigationTargetSymbolId ?? "—"}</span>
        </div>
      </div>
    </div>
  );
}
