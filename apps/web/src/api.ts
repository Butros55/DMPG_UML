const API_BASE = "/api";

/* ── Project management ────────────────────────── */

export interface ProjectMeta {
  projectPath: string;
  name: string;
  symbolCount: number;
  lastScanned: string;
  hash: string;
}

export async function fetchProjects(): Promise<{
  projects: ProjectMeta[];
  activeProject: string | null;
}> {
  const res = await fetch(`${API_BASE}/projects`);
  if (!res.ok) return { projects: [], activeProject: null };
  return res.json();
}

export async function switchProject(projectPath: string): Promise<{
  ok: boolean;
  graph: import("@dmpg/shared").ProjectGraph | null;
  projectPath: string;
}> {
  const res = await fetch(`${API_BASE}/projects/switch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectPath }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? "Switch failed");
  }
  return res.json();
}

export async function deleteProjectApi(projectPath: string): Promise<void> {
  await fetch(`${API_BASE}/projects`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectPath }),
  });
}

/* ── Source code ────────────────────────────────── */

export interface SourceCodeResult {
  code: string;
  file: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  language: string;
}

export async function fetchSourceCode(symbolId: string): Promise<SourceCodeResult> {
  const res = await fetch(`${API_BASE}/graph/source/${encodeURIComponent(symbolId)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? "Could not load source code");
  }
  return res.json();
}

/* ── Open in IDE ───────────────────────────────── */

export type IdeName = "vscode" | "intellij";

export async function openInIde(
  ide: IdeName,
  file: string,
  line?: number,
): Promise<void> {
  const res = await fetch(`${API_BASE}/open-in-ide`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ide, file, line }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? "Could not open IDE");
  }
}

export async function fetchGraph() {
  const res = await fetch(`${API_BASE}/graph`);
  if (!res.ok) throw new Error("Failed to fetch graph");
  return res.json();
}

export async function scanProject(projectPath: string) {
  const res = await fetch(`${API_BASE}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectPath }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Scan failed");
  }
  return res.json();
}

export async function summarizeSymbol(symbolId: string, codeSnippet?: string, context?: string) {
  const res = await fetch(`${API_BASE}/ai/summarize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbolId, codeSnippet, context }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "AI summarize failed");
  }
  return res.json();
}

export async function batchSummarize(symbolIds: string[]) {
  const res = await fetch(`${API_BASE}/ai/batch-summarize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbolIds }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Batch summarize failed");
  }
  return res.json();
}

export async function fetchConfig(): Promise<{
  scanProjectPath: string;
  aiProvider: string;
  ollamaModel: string;
}> {
  const res = await fetch(`${API_BASE}/config`);
  if (!res.ok) return { scanProjectPath: "", aiProvider: "cloud", ollamaModel: "" };
  return res.json();
}

export async function browseFolders(path?: string): Promise<{
  current: string;
  parent: string | null;
  folders: Array<{ name: string; path: string }>;
}> {
  const params = path ? `?path=${encodeURIComponent(path)}` : "";
  const res = await fetch(`${API_BASE}/scan/browse${params}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Browse failed");
  }
  return res.json();
}

export interface AnalyzeEvent {
  phase: string;
  action?: string;
  seq?: number;
  symbolId?: string;
  symbolLabel?: string;
  viewId?: string;
  old?: string;
  new_?: string;
  relationType?: string;
  sourceLabel?: string;
  targetLabel?: string;
  reason?: string;
  summary?: string;
  message?: string;
  inputs?: Array<{ name: string; type?: string; description?: string }>;
  outputs?: Array<{ name: string; type?: string; description?: string }>;
  current?: number;
  total?: number;
  stats?: { labelsFixed: number; docsGenerated: number; relationsAdded: number; deadCodeFound: number };
  thought?: string;
  // Live graph update fields
  relationId?: string;
  source?: string;
  target?: string;
  relationLabel?: string;
  confidence?: number;
  // Source: "sse" or "poll" — distinguishes real-time SSE from poller
  _source?: "sse" | "poll";
}

/** Cancel a running analysis on the server */
export async function cancelAnalysis(): Promise<void> {
  try {
    await fetch(`${API_BASE}/ai/cancel`, { method: "POST" });
  } catch { /* ignore */ }
}

/** Pause a running analysis on the server (can be resumed later) */
export async function pauseAnalysis(): Promise<void> {
  try {
    await fetch(`${API_BASE}/ai/pause`, { method: "POST" });
  } catch { /* ignore */ }
}

/** Fetch current analysis status (including canResume flag) */
export async function fetchAnalyzeStatus(): Promise<{
  running: boolean;
  phase: string;
  stats: Record<string, number>;
  canResume?: boolean;
  paused?: boolean;
}> {
  const res = await fetch(`${API_BASE}/ai/analyze-status`);
  if (!res.ok) return { running: false, phase: "idle", stats: {} };
  return res.json();
}

/**
 * Poll the analyze-status endpoint continuously, relaying progress to onEvent.
 * Stops when analysis is no longer running.
 */
async function runStatusPoller(
  onEvent: (event: AnalyzeEvent) => void,
  signal: AbortSignal,
  intervalMs = 2500,
) {
  const MAX_POLLS = 600; // ~25 minutes
  for (let i = 0; i < MAX_POLLS; i++) {
    if (signal.aborted) return;
    await new Promise((r) => setTimeout(r, intervalMs));
    if (signal.aborted) return;
    try {
      const res = await fetch(`${API_BASE}/ai/analyze-status`);
      if (!res.ok) continue;
      const state = await res.json() as {
        running: boolean; phase: string; stats: Record<string, number>;
        current?: number; total?: number;
        currentSymbolId?: string; currentSymbolLabel?: string; thought?: string;
        currentViewId?: string; paused?: boolean;
      };
      console.log(`[AI-Poll] status: phase=${state.phase}, running=${state.running}, ${state.current ?? '?'}/${state.total ?? '?'}, symbol=${state.currentSymbolId ?? '-'}`);

      if (!state.running) {
        // Analysis finished or paused
        if (state.paused) {
          onEvent({ phase: "paused", stats: state.stats as any, _source: "poll" });
        } else {
          onEvent({
            phase: state.phase === "error" ? "error" : "done",
            stats: state.stats as any,
            message: state.phase === "error" ? "Analysis failed on server" : undefined,
            _source: "poll",
          });
        }
        return;
      }

      // Relay progress with per-item data from server state
      onEvent({
        phase: state.phase,
        action: "poll-progress",
        current: state.current,
        total: state.total,
        symbolId: state.currentSymbolId,
        symbolLabel: state.currentSymbolLabel,
        viewId: state.currentViewId,
        thought: state.thought,
        message: state.thought ?? `Phase: ${state.phase}`,
        _source: "poll",
      });
    } catch { /* ignore fetch errors, keep trying */ }
  }
  // Timeout
  onEvent({ phase: "error", message: "Polling timeout — analysis may still be running on server", _source: "poll" });
}

/**
 * Start SSE-based AI analysis with parallel status polling for robustness.
 * The SSE stream provides real-time updates. If it stalls (proxy drop, network issue),
 * the parallel poller keeps progress and navigation updated reliably.
 * Returns an abort function.
 */
export function startAnalysis(
  onEvent: (event: AnalyzeEvent) => void,
  onError: (err: Error) => void,
  viewId?: string,
  resume?: boolean,
): () => void {
  const controller = new AbortController();
  let sseAlive = true; // tracks if SSE is delivering data
  let pollerDone = false; // prevents double-done from SSE + poller
  let sseDone = false;

  // ── Parallel status poller — always runs alongside SSE ──
  const pollController = new AbortController();
  const pollerOnEvent = (event: AnalyzeEvent) => {
    if (pollerDone) return;
    // If SSE already delivered a "done" event, suppress duplicate from poller
    if (sseDone && (event.phase === "done" || event.phase === "error" || event.phase === "paused")) return;
    // Always relay poll-progress events (they update current/total/navigation)
    if (event.phase === "done" || event.phase === "error" || event.phase === "cancelled" || event.phase === "paused") {
      pollerDone = true;
    }
    onEvent(event);
  };
  // Start poller after a short delay so SSE gets a chance to connect first
  const pollerStartTimer = setTimeout(() => {
    if (!controller.signal.aborted) {
      console.log("[AI-Poll] Starting parallel status poller");
      runStatusPoller(pollerOnEvent, pollController.signal, 2500);
    }
  }, 3000);

  // ── SSE stream reader ──
  (async () => {
    let receivedDone = false;
    let lastDataTime = Date.now();

    // Inactivity monitor: if no SSE data for 15 seconds, abort the reader
    const inactivityCheck = setInterval(() => {
      if (Date.now() - lastDataTime > 15_000 && !receivedDone) {
        console.warn("[AI-SSE] No data for 15s — SSE likely stalled, relying on poller");
        sseAlive = false;
        // Don't abort the fetch — just stop processing SSE and let poller handle it
        clearInterval(inactivityCheck);
      }
    }, 5000);

    try {
      const body: Record<string, unknown> = {};
      if (viewId) body.viewId = viewId;
      if (resume) body.resume = true;

      const res = await fetch(`${API_BASE}/ai/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        onError(new Error((err as any).error ?? `Analysis failed (${res.status})`));
        clearInterval(inactivityCheck);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        onError(new Error("No response body"));
        clearInterval(inactivityCheck);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (sseAlive) {
        const { done, value } = await reader.read();
        if (done) break;

        lastDataTime = Date.now();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data: ")) {
            try {
              const raw = trimmed.slice(6);
              console.log("[AI-SSE] Raw event:", raw);
              const event = JSON.parse(raw) as AnalyzeEvent;
              event._source = "sse";
              onEvent(event);
              if (event.phase === "done" || event.phase === "error") {
                receivedDone = true;
                sseDone = true;
              }
            } catch { /* skip invalid JSON */ }
          }
        }
      }

      clearInterval(inactivityCheck);

      // If SSE ended cleanly with "done", stop the poller too
      if (receivedDone) {
        pollController.abort();
      }
      // Otherwise, poller is still running and will catch the "done" event

    } catch (err: any) {
      clearInterval(inactivityCheck);
      if (err.name !== "AbortError") {
        console.warn("[AI-SSE] Connection error (poller still active):", err.message);
        // Poller is still running — it will handle progress from here
      }
    }
  })();

  return () => {
    clearTimeout(pollerStartTimer);
    pollController.abort();
    controller.abort();
  };
}
