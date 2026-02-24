import { useAppStore } from "../store";

/**
 * Floating debug overlay showing transport/navigation state.
 * Toggle via the debug button in the header or store.toggleDebugTransport().
 */
export function DebugTransportPanel() {
  const show = useAppStore((s) => s.showDebugTransport);
  const debug = useAppStore((s) => s.debugTransport);
  const aiAnalysis = useAppStore((s) => s.aiAnalysis);
  const toggle = useAppStore((s) => s.toggleDebugTransport);

  if (!show) return null;

  const age = debug?.lastEventTime
    ? `${Math.round((Date.now() - debug.lastEventTime) / 1000)}s ago`
    : "—";

  return (
    <div className="debug-transport-panel">
      <div className="debug-transport-header">
        <span><i className="bi bi-bug" /> Transport Debug</span>
        <button className="debug-transport-close" onClick={toggle}><i className="bi bi-x-lg" /></button>
      </div>
      <div className="debug-transport-body">
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
