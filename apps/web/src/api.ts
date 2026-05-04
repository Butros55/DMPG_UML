import type {
  AiExternalContextReviewResponse,
  AiLabelImprovementResponse,
  AiViewWorkspaceRunRequest,
  AiStructureReviewResponse,
  AiVisionImageInput,
  DiagramImageCompareResponse,
  DiagramImageReviewResponse,
  DiagramImageSuggestionsResponse,
  ProjectGraph,
  UmlReferenceAutorefactorRequest,
  UmlReferenceAutorefactorResponse,
  UmlReferenceCompareResponse,
} from "@dmpg/shared";

const API_BASE = "/api";
const LOCAL_AI_MODEL_STORAGE_KEY = "dmpg.ai.local-model.v1";
const LOCAL_AI_MODEL_HEADER = "x-dmpg-local-ai-model";

let preferredLocalAiModel = "";

function readPreferredLocalAiModel(): string {
  if (preferredLocalAiModel) return preferredLocalAiModel;
  if (typeof window === "undefined") return "";

  try {
    preferredLocalAiModel = window.localStorage.getItem(LOCAL_AI_MODEL_STORAGE_KEY)?.trim() ?? "";
  } catch {
    preferredLocalAiModel = "";
  }

  return preferredLocalAiModel;
}

function buildApiHeaders(headers?: HeadersInit): Headers {
  const merged = new Headers(headers);
  const localModel = readPreferredLocalAiModel();
  if (localModel) {
    merged.set(LOCAL_AI_MODEL_HEADER, localModel);
  }
  return merged;
}

function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, {
    ...init,
    headers: buildApiHeaders(init?.headers),
  });
}

export function getPreferredLocalAiModel(): string {
  return readPreferredLocalAiModel();
}

export function setPreferredLocalAiModel(model: string) {
  preferredLocalAiModel = model.trim();
  if (typeof window === "undefined") return;

  try {
    if (preferredLocalAiModel) {
      window.localStorage.setItem(LOCAL_AI_MODEL_STORAGE_KEY, preferredLocalAiModel);
    } else {
      window.localStorage.removeItem(LOCAL_AI_MODEL_STORAGE_KEY);
    }
  } catch {
    // Ignore localStorage failures and keep the in-memory value.
  }
}

export interface LocalOllamaModel {
  name: string;
  id: string | null;
  size: string | null;
  processor: string | null;
  until: string | null;
}

export async function fetchLocalOllamaModels(): Promise<{
  models: LocalOllamaModel[];
  checkedAt?: string;
  error?: string;
}> {
  const res = await apiFetch(`${API_BASE}/ai/local-models`);
  const payload = await res.json().catch(() => ({ models: [] })) as {
    models?: LocalOllamaModel[];
    checkedAt?: string;
    error?: string;
  };

  return {
    models: Array.isArray(payload.models) ? payload.models : [],
    checkedAt: payload.checkedAt,
    error: !res.ok ? (payload.error ?? "Lokale Ollama-Modelle konnten nicht geladen werden.") : payload.error,
  };
}

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
  const res = await apiFetch(`${API_BASE}/projects`);
  if (!res.ok) return { projects: [], activeProject: null };
  return res.json();
}

export async function switchProject(projectPath: string): Promise<{
  ok: boolean;
  graph: import("@dmpg/shared").ProjectGraph | null;
  projectPath: string;
}> {
  const res = await apiFetch(`${API_BASE}/projects/switch`, {
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

export async function deleteProjectApi(projectPath: string): Promise<{
  ok: boolean;
  projects: ProjectMeta[];
  activeProject: string | null;
  graph: import("@dmpg/shared").ProjectGraph | null;
}> {
  const res = await apiFetch(`${API_BASE}/projects`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectPath }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? "Projekt konnte nicht entfernt werden");
  }
  return res.json();
}

export async function pickProjectFolder(initialPath?: string): Promise<string | null> {
  const res = await apiFetch(`${API_BASE}/projects/pick-folder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initialPath }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? "Ordnerauswahl fehlgeschlagen");
  }
  const payload = await res.json().catch(() => ({})) as { projectPath?: string | null };
  return typeof payload.projectPath === "string" && payload.projectPath.trim()
    ? payload.projectPath
    : null;
}

export async function openProjectFolder(projectPath: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/projects/open-folder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectPath }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? "Ordner konnte nicht geöffnet werden");
  }
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
  const res = await apiFetch(`${API_BASE}/graph/source/${encodeURIComponent(symbolId)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? "Could not load source code");
  }
  return res.json();
}

/* ── Open in IDE ───────────────────────────────── */

export type IdeName = "vscode" | "intellij";
export type IdeOpenMode = "goto" | "diff";

export async function openInIde(
  ide: IdeName,
  file: string,
  line?: number,
  mode?: IdeOpenMode,
  diffFile?: string,
): Promise<void> {
  const body: Record<string, unknown> = { ide, file, line };
  if (mode) body.mode = mode;
  if (diffFile) body.diffFile = diffFile;
  const res = await apiFetch(`${API_BASE}/open-in-ide`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? "Could not open IDE");
  }
}

export async function fetchGraph() {
  const res = await apiFetch(`${API_BASE}/graph`);
  if (!res.ok) throw new Error("Failed to fetch graph");
  return res.json();
}

export async function replaceGraph(graph: ProjectGraph): Promise<ProjectGraph> {
  const res = await apiFetch(`${API_BASE}/graph`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(graph),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? "Graph import failed");
  }
  const payload = await res.json().catch(() => ({}));
  return (payload as { graph?: ProjectGraph }).graph ?? graph;
}

export async function scanProject(projectPath: string): Promise<ProjectGraph> {
  const res = await apiFetch(`${API_BASE}/scan`, {
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

export interface ScanStreamEvent {
  phase: "start" | "python" | "pyreverse" | "graph" | "embeddings" | "class-synthesis" | "done" | "error" | "cancelled";
  message?: string;
  projectPath?: string;
  graph?: ProjectGraph;
  current?: number;
  total?: number;
  viewId?: string;
  relationsAdded?: number;
  warnings?: string[];
}

function createAbortError(message = "Scan aborted"): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export async function scanProjectStream(
  projectPath: string,
  onEvent: (event: ScanStreamEvent) => void,
  options: { signal?: AbortSignal } = {},
): Promise<ProjectGraph> {
  if (options.signal?.aborted) throw createAbortError();

  const res = await apiFetch(`${API_BASE}/scan/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectPath }),
    signal: options.signal,
  });

  if (options.signal?.aborted) throw createAbortError();

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? "Scan failed");
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("Scan stream did not return a response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let finalGraph: ProjectGraph | null = null;

  const handleLine = (line: string) => {
    if (options.signal?.aborted) throw createAbortError();
    const trimmed = line.trim();
    if (!trimmed.startsWith("data: ")) return;
    const event = JSON.parse(trimmed.slice(6)) as ScanStreamEvent;
    if (event.graph) finalGraph = event.graph;
    onEvent(event);
    if (event.phase === "error") {
      throw new Error(event.message ?? "Scan failed");
    }
  };

  while (true) {
    if (options.signal?.aborted) throw createAbortError();
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) handleLine(line);
  }

  if (buffer.trim()) handleLine(buffer);
  if (!finalGraph) throw new Error("Scan stream finished without a graph");
  return finalGraph;
}

export async function summarizeSymbol(symbolId: string, codeSnippet?: string, context?: string) {
  const res = await apiFetch(`${API_BASE}/ai/summarize`, {
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
  const res = await apiFetch(`${API_BASE}/ai/batch-summarize`, {
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

export async function reviewDiagramImage(
  images: AiVisionImageInput[],
  instruction?: string,
  viewId?: string,
): Promise<DiagramImageReviewResponse> {
  const res = await apiFetch(`${API_BASE}/ai/vision/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images, instruction, viewId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Vision review failed");
  }
  return res.json();
}

export async function compareDiagramImages(
  images: AiVisionImageInput[],
  instruction?: string,
  viewId?: string,
): Promise<DiagramImageCompareResponse> {
  const res = await apiFetch(`${API_BASE}/ai/vision/compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images, instruction, viewId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Vision compare failed");
  }
  return res.json();
}

export async function compareUmlDiagramImages(
  images: AiVisionImageInput[],
  options: {
    instruction?: string;
    viewId?: string;
    graphContext?: unknown;
    persistSuggestions?: boolean;
  } = {},
): Promise<UmlReferenceCompareResponse> {
  const res = await apiFetch(`${API_BASE}/ai/vision/compare-uml`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      images,
      instruction: options.instruction,
      viewId: options.viewId,
      graphContext: options.graphContext,
      persistSuggestions: options.persistSuggestions,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "UML vision compare failed");
  }
  return res.json();
}

export async function runReferenceDrivenAutorefactor(
  request: UmlReferenceAutorefactorRequest,
): Promise<UmlReferenceAutorefactorResponse> {
  const res = await apiFetch(`${API_BASE}/ai/vision/compare-apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Reference-driven UML autorefactor failed");
  }
  return res.json();
}

export async function undoReferenceDrivenAutorefactor(
  snapshotId: string,
): Promise<{ ok: true; graph: ProjectGraph }> {
  const res = await apiFetch(`${API_BASE}/ai/vision/compare-apply/undo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ snapshotId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Undo for reference-driven UML autorefactor failed");
  }
  return res.json();
}

export async function suggestDiagramImageImprovements(
  images: AiVisionImageInput[],
  instruction?: string,
  viewId?: string,
): Promise<DiagramImageSuggestionsResponse> {
  const res = await apiFetch(`${API_BASE}/ai/vision/suggestions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images, instruction, viewId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Vision suggestions failed");
  }
  return res.json();
}

export async function reviewCurrentViewStructure(
  viewId: string,
  options: { persist?: boolean; includeContextReview?: boolean } = {},
): Promise<{
  review: AiStructureReviewResponse;
  heuristics: Record<string, unknown>;
  contextReview?: AiExternalContextReviewResponse;
}> {
  const res = await apiFetch(`${API_BASE}/ai/uml/review-view-structure`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      viewId,
      persist: options.persist ?? true,
      includeContextReview: options.includeContextReview ?? true,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "View structure review failed");
  }
  return res.json();
}

export async function improveCurrentViewLabels(
  viewId: string,
  options: { persist?: boolean } = {},
): Promise<AiLabelImprovementResponse> {
  const res = await apiFetch(`${API_BASE}/ai/uml/improve-view-labels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      viewId,
      persist: options.persist ?? true,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Label improvement failed");
  }
  return res.json();
}

export async function fetchConfig(): Promise<{
  scanProjectPath: string;
  aiProvider: string;
  ollamaModel: string;
}> {
  const res = await apiFetch(`${API_BASE}/config`);
  if (!res.ok) return { scanProjectPath: "", aiProvider: "cloud", ollamaModel: "" };
  return res.json();
}

export async function browseFolders(path?: string): Promise<{
  current: string;
  parent: string | null;
  folders: Array<{ name: string; path: string }>;
}> {
  const params = path ? `?path=${encodeURIComponent(path)}` : "";
  const res = await apiFetch(`${API_BASE}/scan/browse${params}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Browse failed");
  }
  return res.json();
}

export interface AnalyzeEvent {
  runKind?: "project_analysis" | "view_workspace";
  phase: string;
  action?: string;
  step?: "structure" | "context" | "labels" | "reference";
  seq?: number;
  symbolId?: string;
  symbolLabel?: string;
  viewId?: string;
  focusViewId?: string;
  groupId?: string;
  moduleId?: string;
  moduleLabel?: string;
  old?: string;
  new_?: string;
  relationType?: string;
  sourceLabel?: string;
  targetLabel?: string;
  fromGroup?: string;
  toGroup?: string;
  sourceGroup?: string;
  targetGroup?: string;
  groupLabel?: string;
  subGroupCount?: number;
  parentGroup?: string;
  subGroupLabel?: string;
  moduleCount?: number;
  reason?: string;
  deadCodeKind?: "unused_symbol" | "unreachable_code";
  summary?: string;
  message?: string;
  file?: string;
  startLine?: number;
  endLine?: number;
  inputs?: Array<{ name: string; type?: string; description?: string }>;
  outputs?: Array<{ name: string; type?: string; description?: string }>;
  current?: number;
  total?: number;
  targetIds?: string[];
  appliedCount?: number;
  reviewOnlyCount?: number;
  autoApplied?: boolean;
  undoSnapshotId?: string;
  applyRunId?: string;
  stats?: {
    labelsFixed: number;
    docsGenerated: number;
    relationsAdded: number;
    deadCodeFound: number;
    commentedOutFound?: number;
    groupsReviewed?: number;
  };
  thought?: string;
  // Live graph update fields
  relationId?: string;
  source?: string;
  target?: string;
  relationLabel?: string;
  confidence?: number;
  // Source: "sse" or "poll" — distinguishes real-time SSE from poller
  _source?: "sse" | "poll" | "poll-events";
}

/** Cancel a running analysis on the server */
export async function cancelAnalysis(): Promise<void> {
  try {
    await apiFetch(`${API_BASE}/ai/cancel`, { method: "POST" });
  } catch { /* ignore */ }
}

/** Pause a running analysis on the server (can be resumed later) */
export async function pauseAnalysis(): Promise<void> {
  try {
    await apiFetch(`${API_BASE}/ai/pause`, { method: "POST" });
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
  const res = await apiFetch(`${API_BASE}/ai/analyze-status`);
  if (!res.ok) return { running: false, phase: "idle", stats: {} };
  return res.json();
}

/** Fetch the baseline snapshot (symbol states before AI analysis started) */
export async function fetchAnalyzeBaseline(): Promise<{
  runId: string | null;
  symbols: Record<string, { label: string; doc?: any; tags?: string[] }>;
  relationIds: string[];
}> {
  const res = await apiFetch(`${API_BASE}/ai/analyze-baseline`);
  if (!res.ok) return { runId: null, symbols: {}, relationIds: [] };
  return res.json();
}

/**
 * Poll the analyze-events endpoint continuously, relaying data events to onEvent.
 * Unlike status polling, this delivers actual SSE-equivalent data events with
 * deterministic sequence ordering — no events are lost even if the client reconnects.
 */
async function runEventsPoller(
  onEvent: (event: AnalyzeEvent) => void,
  signal: AbortSignal,
  intervalMs = 1500,
) {
  let afterSeq = 0;
  let runId: string | null = null;
  const MAX_POLLS = 1200; // ~30 minutes

  for (let i = 0; i < MAX_POLLS; i++) {
    if (signal.aborted) return;
    await new Promise((r) => setTimeout(r, intervalMs));
    if (signal.aborted) return;
    try {
      const res = await apiFetch(`${API_BASE}/ai/analyze-events?afterSeq=${afterSeq}`);
      if (!res.ok) continue;
      const data = await res.json() as {
        runId: string;
        latestSeq: number;
        events: Array<AnalyzeEvent & { seq?: number }>;
      };

      // Detect new run → reset
      if (runId && data.runId !== runId) {
        afterSeq = 0;
        runId = data.runId;
        continue;
      }
      runId = data.runId;

      for (const event of data.events) {
        event._source = "poll-events";
        onEvent(event);
        if (event.seq && event.seq > afterSeq) afterSeq = event.seq;
      }

      // Update high-water mark even if no events (server may have advanced)
      if (data.latestSeq > afterSeq) afterSeq = data.latestSeq;

      // Check if analysis is done
      const hasTerminal = data.events.some(
        (e) => e.phase === "done" || e.phase === "error" || e.phase === "cancelled" || e.phase === "paused",
      );
      if (hasTerminal) return;
    } catch { /* ignore fetch errors, keep trying */ }
  }
  onEvent({ phase: "error", message: "Event polling timeout — analysis may still be running on server", _source: "poll" });
}

/**
 * Poll the analyze-status endpoint continuously, relaying progress to onEvent.
 * This poller only provides UI overlay info (phase, thought, working symbol).
 * Actual data events come from runEventsPoller.
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
      const res = await apiFetch(`${API_BASE}/ai/analyze-status`);
      if (!res.ok) continue;
      const state = await res.json() as {
        running: boolean; phase: string; stats: Record<string, number>;
        current?: number; total?: number;
        currentSymbolId?: string; currentSymbolLabel?: string; thought?: string;
        currentViewId?: string; paused?: boolean;
      };
      console.log(`[AI-Poll] status: phase=${state.phase}, running=${state.running}, ${state.current ?? '?'}/${state.total ?? '?'}, symbol=${state.currentSymbolId ?? '-'}`);

      if (!state.running) {
        // Analysis finished or paused — terminal events come from events poller
        return;
      }

      // Relay progress with per-item data from server state (UI overlay only)
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
}

/**
 * Start SSE-based AI analysis with parallel event & status polling.
 *
 * Three channels run in parallel for maximum robustness:
 * 1. SSE stream — real-time data events from the server
 * 2. Events poller — polls /api/ai/analyze-events for missed SSE events (primary fallback)
 * 3. Status poller — polls /api/ai/analyze-status for UI overlay only (phase/thought)
 *
 * Navigation is driven ONLY by data events (SSE or events poller), never by status poller.
 * Returns an abort function.
 */
export function startAnalysis(
  onEvent: (event: AnalyzeEvent) => void,
  onError: (err: Error) => void,
  viewId?: string,
  resume?: boolean,
): () => void {
  const controller = new AbortController();
  let sseAlive = true;
  let sseDone = false;

  // Track which SSE seqs we already delivered to avoid duplicates from events poller
  const deliveredSeqs = new Set<number>();

  // ── Parallel status poller — UI overlay only (phase, thought, working symbol) ──
  const pollController = new AbortController();
  const statusPollerStartTimer = setTimeout(() => {
    if (!controller.signal.aborted) {
      console.log("[AI-Poll] Starting parallel status poller");
      runStatusPoller(
        (event) => onEvent(event),
        pollController.signal,
        2500,
      );
    }
  }, 1000);

  // ── Events poller — deterministic event delivery (catches missed SSE data) ──
  const eventsPollerController = new AbortController();
  const eventsPollerStartTimer = setTimeout(() => {
    if (!controller.signal.aborted) {
      console.log("[AI-Events] Starting parallel events poller");
      runEventsPoller(
        (event) => {
          // Deduplicate: if SSE already delivered this seq, skip
          if (event.seq && deliveredSeqs.has(event.seq)) return;
          if (event.seq) deliveredSeqs.add(event.seq);
          onEvent(event);
        },
        eventsPollerController.signal,
        1500,
      );
    }
  }, 250); // Start almost immediately — primary transport

  // ── SSE stream reader ──
  (async () => {
    let receivedDone = false;
    let lastDataTime = Date.now();

    const inactivityCheck = setInterval(() => {
      if (Date.now() - lastDataTime > 15_000 && !receivedDone) {
        console.warn("[AI-SSE] No data for 15s — SSE likely stalled, relying on events poller");
        sseAlive = false;
        clearInterval(inactivityCheck);
      }
    }, 5000);

    try {
      const body: Record<string, unknown> = {};
      if (viewId) body.viewId = viewId;
      if (resume) body.resume = true;

      const res = await apiFetch(`${API_BASE}/ai/analyze`, {
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
              // Track seq so events poller can deduplicate
              if (event.seq) deliveredSeqs.add(event.seq);
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

      if (receivedDone) {
        pollController.abort();
        eventsPollerController.abort();
      }
    } catch (err: any) {
      clearInterval(inactivityCheck);
      if (err.name !== "AbortError") {
        console.warn("[AI-SSE] Connection error (pollers still active):", err.message);
      }
    }
  })();

  return () => {
    clearTimeout(statusPollerStartTimer);
    clearTimeout(eventsPollerStartTimer);
    pollController.abort();
    eventsPollerController.abort();
    controller.abort();
  };
}

export function startViewWorkspaceRun(
  onEvent: (event: AnalyzeEvent) => void,
  onError: (err: Error) => void,
  request: AiViewWorkspaceRunRequest,
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await apiFetch(`${API_BASE}/ai/uml/workspace-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        onError(new Error((err as { error?: string }).error ?? `Workspace run failed (${res.status})`));
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        onError(new Error("No response body"));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(trimmed.slice(6)) as AnalyzeEvent;
            event._source = "sse";
            onEvent(event);
          } catch {
            // Ignore malformed SSE chunks and continue reading the stream.
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        onError(err instanceof Error ? err : new Error("Workspace run failed"));
      }
    }
  })();

  return () => controller.abort();
}
