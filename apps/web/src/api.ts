const API_BASE = "/api";

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
  symbolId?: string;
  symbolLabel?: string;
  old?: string;
  new_?: string;
  relationType?: string;
  sourceLabel?: string;
  targetLabel?: string;
  reason?: string;
  summary?: string;
  message?: string;
  current?: number;
  total?: number;
  stats?: { labelsFixed: number; docsGenerated: number; relationsAdded: number; deadCodeFound: number };
  thought?: string;
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
 * Poll the analyze-status endpoint until analysis is no longer running.
 * When done, fires the final onEvent with "done" or "error".
 */
async function pollUntilDone(
  onEvent: (event: AnalyzeEvent) => void,
  signal: AbortSignal,
) {
  console.log("[AI-Poll] SSE stream ended without done event — starting status polling");
  const POLL_INTERVAL = 3000;
  const MAX_POLLS = 200; // ~10 minutes
  for (let i = 0; i < MAX_POLLS; i++) {
    if (signal.aborted) return;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    if (signal.aborted) return;
    try {
      const res = await fetch(`${API_BASE}/ai/analyze-status`);
      if (!res.ok) continue;
      const state = await res.json() as {
        running: boolean; phase: string; stats: Record<string, number>;
        current?: number; total?: number;
        currentSymbolId?: string; currentSymbolLabel?: string; thought?: string;
      };
      console.log(`[AI-Poll] status: phase=${state.phase}, running=${state.running}, ${state.current ?? '?'}/${state.total ?? '?'}`);
      if (!state.running) {
        // Analysis finished — send final event
        onEvent({
          phase: state.phase === "error" ? "error" : "done",
          stats: state.stats as any,
          message: state.phase === "error" ? "Analysis failed on server" : undefined,
        });
        return;
      }
      // Relay progress with per-item data from server state
      onEvent({
        phase: state.phase,
        action: "progress",
        current: state.current,
        total: state.total,
        symbolId: state.currentSymbolId,
        symbolLabel: state.currentSymbolLabel,
        thought: state.thought,
        message: state.thought ?? `Phase: ${state.phase}`,
      });
    } catch { /* ignore fetch errors, keep trying */ }
  }
  // Timeout
  onEvent({ phase: "error", message: "Polling timeout — analysis may still be running on server" });
}

/**
 * Start SSE-based AI analysis. Returns an abort function.
 * If the SSE connection drops before "done", falls back to polling /api/ai/analyze-status.
 */
export function startAnalysis(
  onEvent: (event: AnalyzeEvent) => void,
  onError: (err: Error) => void,
  viewId?: string,
  resume?: boolean,
): () => void {
  const controller = new AbortController();

  (async () => {
    let receivedDone = false;
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
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        onError(new Error("No response body"));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

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
              onEvent(event);
              if (event.phase === "done" || event.phase === "error") {
                receivedDone = true;
              }
            } catch { /* skip invalid JSON */ }
          }
        }
      }

      // SSE stream ended — if we never got "done", fall back to polling
      if (!receivedDone && !controller.signal.aborted) {
        await pollUntilDone(onEvent, controller.signal);
      }

    } catch (err: any) {
      if (err.name !== "AbortError") {
        // Network error — also fall back to polling since server may continue
        console.warn("[AI] SSE connection error, falling back to polling:", err.message);
        try {
          await pollUntilDone(onEvent, controller.signal);
        } catch {
          onError(err);
        }
      }
    }
  })();

  return () => controller.abort();
}
