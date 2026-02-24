import { Router, type Router as RouterType } from "express";
import { AiDocRequestSchema, SymbolDocSchema } from "@dmpg/shared";
import type { Symbol as Sym, Relation } from "@dmpg/shared";
import { getGraph, setGraph, loadAiProgress, saveAiProgress, clearAiProgress } from "../store.js";
import * as fs from "node:fs";
import * as path from "node:path";

export const aiRouter: RouterType = Router();

/* ── AI Provider config ─────────────────────────── */
const AI_PROVIDER = (process.env.AI_PROVIDER ?? "cloud").toLowerCase(); // "local" | "cloud"

const OLLAMA_CLOUD_URL = normalizeBaseUrl(
  process.env.OLLAMA_BASE_URL ?? "https://ollama.com",
);
const OLLAMA_LOCAL_URL = normalizeBaseUrl(
  process.env.OLLAMA_LOCAL_URL ?? "http://127.0.0.1:11434",
);
const OLLAMA_BASE_URL = AI_PROVIDER === "local" ? OLLAMA_LOCAL_URL : OLLAMA_CLOUD_URL;
const OLLAMA_API_KEY = AI_PROVIDER === "local" ? "" : (process.env.OLLAMA_API_KEY ?? "");
const OLLAMA_MODEL = AI_PROVIDER === "local"
  ? (process.env.OLLAMA_LOCAL_MODEL ?? process.env.OLLAMA_MODEL ?? "llama3.1:8b")
  : (process.env.OLLAMA_CLOUD_MODEL ?? process.env.OLLAMA_MODEL ?? "llama3.1:8b");

console.log(`[AI] Provider: ${AI_PROVIDER}, URL: ${OLLAMA_BASE_URL}, Model: ${OLLAMA_MODEL}`);

/** Normalize the base URL: strip trailing /api and trailing slashes */
function normalizeBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, "");
  if (url.endsWith("/api")) url = url.slice(0, -4);
  return url;
}

/** Try to read source code for a symbol from its location path */
function readSourceForSymbol(
  sym: { location?: { path?: string; line?: number; endLine?: number } },
  scanRoot?: string,
): string | undefined {
  const loc = sym.location;
  if (!loc?.path) return undefined;

  // resolve relative paths with "file" field name compatibility
  const filePath = (loc as any).file ?? loc.path;
  const absPath = path.isAbsolute(filePath) ? filePath : path.join(scanRoot ?? "", filePath);
  try {
    const src = fs.readFileSync(absPath, "utf-8");
    if (loc.line != null) {
      const lines = src.split("\n");
      const start = Math.max(0, (loc.line ?? 1) - 1);
      const end = loc.endLine != null ? loc.endLine : Math.min(start + 60, lines.length);
      return lines.slice(start, end).join("\n");
    }
    return src.split("\n").slice(0, 80).join("\n");
  } catch {
    return undefined;
  }
}

/** Read source for a symbol using the location.file field convention from scanner */
function readSourceCode(sym: Sym, scanRoot?: string): string | undefined {
  const loc = sym.location;
  if (!loc) return undefined;
  const filePath = loc.file;
  if (!filePath) return undefined;
  const absPath = path.isAbsolute(filePath) ? filePath : path.join(scanRoot ?? "", filePath);
  try {
    const src = fs.readFileSync(absPath, "utf-8");
    const lines = src.split("\n");
    const start = Math.max(0, (loc.startLine ?? 1) - 1);
    const end = loc.endLine != null ? loc.endLine : Math.min(start + 80, lines.length);
    return lines.slice(start, end).join("\n");
  } catch {
    return undefined;
  }
}

/** POST /api/ai/summarize — generate AI docs for a symbol */
aiRouter.post("/summarize", async (req, res) => {
  const parsed = AiDocRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { symbolId, codeSnippet, context } = parsed.data;
  const g = getGraph();
  const sym = g?.symbols.find((s) => s.id === symbolId);

  const code =
    codeSnippet ??
    (sym ? readSourceForSymbol(sym as any, process.env.SCAN_PROJECT_PATH) : undefined);

  const systemPrompt = `You are a code documentation assistant. Given the symbol name, code snippet and surrounding context, produce a JSON object with these fields:
- summary (string): a short description
- inputs (array of {name, type?, description?}): parameters/inputs
- outputs (array of {name, type?, description?}): return values
- sideEffects (array of strings): file writes, network calls, DB mutations, etc.
- calls (array of strings): IDs or names of functions/methods this symbol calls
- links (array of {label, symbolId}): references to other symbols
Respond ONLY with valid JSON, no markdown fences.`;

  const userPrompt = `Symbol: ${sym?.label ?? symbolId}
Kind: ${sym?.kind ?? "unknown"}
${code ? `Code:\n${code}` : ""}
${context ? `Context:\n${context}` : ""}`;

  try {
    const doc = await callOllama(systemPrompt, userPrompt);
    const docParsed = SymbolDocSchema.safeParse(doc);
    if (!docParsed.success) {
      res
        .status(502)
        .json({ error: "AI output failed validation", issues: docParsed.error.flatten(), raw: doc });
      return;
    }

    if (g && sym) {
      sym.doc = { ...sym.doc, ...docParsed.data };
      setGraph(g);
    }

    res.json({ doc: docParsed.data });
  } catch (err: any) {
    res.status(502).json({ error: err.message ?? "AI request failed" });
  }
});

/** POST /api/ai/batch-summarize — summarize up to 10 symbols at once */
aiRouter.post("/batch-summarize", async (req, res) => {
  const { symbolIds } = req.body as { symbolIds?: string[] };
  if (!Array.isArray(symbolIds) || symbolIds.length === 0) {
    res.status(400).json({ error: "symbolIds must be a non-empty array" });
    return;
  }
  const ids = symbolIds.slice(0, 10);
  const g = getGraph();
  if (!g) {
    res.status(404).json({ error: "No graph loaded" });
    return;
  }

  const results: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  for (const id of ids) {
    const sym = g.symbols.find((s) => s.id === id);
    if (!sym) {
      errors[id] = "Symbol not found";
      continue;
    }
    const code = readSourceCode(sym, process.env.SCAN_PROJECT_PATH);
    const systemPrompt = `You are a code documentation assistant. Given the symbol name and code, produce a JSON object with fields: summary (string), inputs (array of {name, type?, description?}), outputs (array of {name, type?, description?}), sideEffects (array of strings). Respond ONLY with valid JSON.`;
    const userPrompt = `Symbol: ${sym.label}\nKind: ${sym.kind}\n${code ? `Code:\n${code}` : ""}`;

    try {
      const doc = await callOllama(systemPrompt, userPrompt);
      const docParsed = SymbolDocSchema.safeParse(doc);
      if (docParsed.success) {
        sym.doc = { ...sym.doc, ...docParsed.data };
        results[id] = docParsed.data;
      } else {
        errors[id] = "Validation failed";
      }
    } catch (err: any) {
      errors[id] = err.message ?? "AI request failed";
    }
  }

  if (Object.keys(results).length > 0) setGraph(g);
  res.json({ results, errors });
});

/* ─── Analyze status tracking ─── */
let analyzeState: {
  running: boolean; paused: boolean; phase: string; stats: Record<string, number>;
  current?: number; total?: number;
  currentSymbolId?: string; currentSymbolLabel?: string; thought?: string;
  canResume?: boolean;
} = {
  running: false, paused: false, phase: "idle", stats: {},
  canResume: loadAiProgress() !== null,
};
let cancelRequested = false;
let pauseRequested = false;

/** GET /api/ai/analyze-status — poll analysis progress */
aiRouter.get("/analyze-status", (_req, res) => {
  res.json(analyzeState);
});

/** POST /api/ai/cancel — request cancellation of running analysis */
aiRouter.post("/cancel", (_req, res) => {
  if (!analyzeState.running) {
    res.json({ ok: true, message: "No analysis running" });
    return;
  }
  cancelRequested = true;
  pauseRequested = false;
  console.log("[AI-Analyze] Cancel requested by client");
  res.json({ ok: true, message: "Cancel requested" });
});

/** POST /api/ai/pause — request pause of running analysis */
aiRouter.post("/pause", (_req, res) => {
  if (!analyzeState.running) {
    res.json({ ok: false, message: "No analysis running" });
    return;
  }
  pauseRequested = true;
  console.log("[AI-Analyze] Pause requested by client");
  res.json({ ok: true, message: "Pause requested" });
});

/* ═══════════════════════════════════════════════════════════
   POST /api/ai/analyze — SSE-based full graph post-processing
   Phases: labels → docs → relations → dead-code → done
   Supports resume: skips already-completed symbols from saved progress
   ═══════════════════════════════════════════════════════════ */

aiRouter.post("/analyze", async (req, res) => {
  console.log("[AI-Analyze] POST /api/ai/analyze received");

  if (analyzeState.running) {
    res.status(409).json({ error: "Analysis already running", phase: analyzeState.phase });
    return;
  }

  const g = getGraph();
  if (!g) {
    console.log("[AI-Analyze] ERROR: No graph loaded");
    res.status(404).json({ error: "No graph loaded" });
    return;
  }

  // Optional: scope filter by viewId
  const body = typeof req.body === "object" && req.body ? req.body : {};
  const scopeViewId = body.viewId as string | undefined;
  const resumeMode = body.resume === true;
  const scopeView = scopeViewId ? g.views.find((v) => v.id === scopeViewId) : undefined;
  const scopeSymbolIds = scopeView ? new Set(scopeView.nodeRefs) : null;
  const scopeLabel = scopeView ? `View: ${scopeView.title}` : "Gesamtes Projekt";

  // Load saved progress for resume
  const savedProgress = resumeMode ? loadAiProgress() : null;
  const completedLabels = new Set(savedProgress?.completedSymbols.labels ?? []);
  const completedDocs = new Set(savedProgress?.completedSymbols.docs ?? []);
  const completedRelations = new Set(savedProgress?.completedSymbols.relations ?? []);
  const completedDeadCode = new Set(savedProgress?.completedSymbols.deadCode ?? []);

  console.log(`[AI-Analyze] Graph: ${g.symbols.length} symbols, ${g.relations.length} relations, ${g.views.length} views`);
  console.log(`[AI-Analyze] Scope: ${scopeLabel}${scopeSymbolIds ? ` (${scopeSymbolIds.size} symbols)` : ""}`);
  console.log(`[AI-Analyze] Resume: ${resumeMode} (${completedDocs.size} docs, ${completedLabels.size} labels already done)`);
  console.log(`[AI-Analyze] Ollama config: model=${OLLAMA_MODEL}, url=${OLLAMA_BASE_URL}`);

  cancelRequested = false;
  pauseRequested = false;

  // Set up SSE with explicit flush + no buffering
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(":ok\n\n");
  if (typeof (res as any).flush === "function") (res as any).flush();

  const scanRoot = process.env.SCAN_PROJECT_PATH ?? g.projectPath ?? "";
  let clientGone = false;
  req.on("close", () => { clientGone = true; console.log("[AI-Analyze] Client disconnected (server continues processing)"); });

  function send(event: Record<string, unknown>) {
    if (clientGone) return;
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (typeof (res as any).flush === "function") (res as any).flush();
    } catch { clientGone = true; }
  }

  const heartbeat = setInterval(() => {
    if (clientGone) { clearInterval(heartbeat); return; }
    try { res.write(":ping\n\n"); } catch { clientGone = true; clearInterval(heartbeat); }
  }, 5000);

  const stats = {
    labelsFixed: savedProgress?.stats.labelsFixed ?? 0,
    docsGenerated: savedProgress?.stats.docsGenerated ?? 0,
    relationsAdded: savedProgress?.stats.relationsAdded ?? 0,
    deadCodeFound: savedProgress?.stats.deadCodeFound ?? 0,
  };
  analyzeState = { running: true, paused: false, phase: "labels", stats };

  function updateState(
    phase: string, current?: number, total?: number,
    symbolId?: string, symbolLabel?: string, thought?: string,
  ) {
    analyzeState = {
      running: true, paused: false, phase, stats: { ...stats }, current, total,
      currentSymbolId: symbolId, currentSymbolLabel: symbolLabel, thought,
    };
  }

  /** Save current progress to disk so analysis can be resumed later */
  function persistProgress(phase: string) {
    saveAiProgress({
      completedSymbols: {
        labels: Array.from(completedLabels),
        docs: Array.from(completedDocs),
        relations: Array.from(completedRelations),
        deadCode: Array.from(completedDeadCode),
      },
      lastPhase: phase,
      stats: { ...stats },
    });
  }

  try {
    // ── Phase 1: Label Cleanup ──
    console.log("[AI-Analyze] Phase 1: Labels starting");
    updateState("labels");
    const longLabelSymbols = g.symbols.filter((s) =>
      (s.label.length > 35 || s.label.includes("/") || s.label.includes("\\")) &&
      (!scopeSymbolIds || scopeSymbolIds.has(s.id)) &&
      !completedLabels.has(s.id), // skip already completed
    );
    const labelCount = Math.min(longLabelSymbols.length, 50);
    console.log(`[AI-Analyze] Labels: ${longLabelSymbols.length} to process (${completedLabels.size} already done)`);
    send({ phase: "labels", action: "start", current: 0, total: labelCount });
    send({ phase: "labels", action: "progress", message: `${longLabelSymbols.length} Labels, verarbeite ${labelCount}…`, current: 0, total: labelCount });

    let labelIdx = 0;
    for (const sym of longLabelSymbols.slice(0, labelCount)) {
      if (cancelRequested) { console.log("[AI-Analyze] Cancelled in labels phase"); break; }
      if (pauseRequested) { console.log("[AI-Analyze] Paused in labels phase"); break; }
      labelIdx++;
      updateState("labels", labelIdx, labelCount, sym.id, sym.label, `Kürze Label: \u201E${sym.label}\u201C`);
      try {
        const result = await callOllama(
          `You are a UML diagram labeling assistant. Shorten the given symbol label to max 25 chars. Rules: For file paths, use just the filename without extension. For dotted names like "module.submodule.Class", keep the last meaningful part. For "Pipeline / Orchestration" style, keep the key term. Return JSON: {"label": "short label"}`,
          `Current label: "${sym.label}"\nKind: ${sym.kind}`,
        );
        const newLabel = (result as any)?.label;
        if (newLabel && typeof newLabel === "string" && newLabel.length > 0 && newLabel.length < 40 && newLabel !== sym.label) {
          const oldLabel = sym.label;
          sym.label = newLabel;
          stats.labelsFixed++;
          console.log(`[AI-Analyze] Label: "${oldLabel}" → "${newLabel}"`);
          send({ phase: "labels", symbolId: sym.id, symbolLabel: newLabel, old: oldLabel, new_: newLabel, current: labelIdx, total: labelCount });
        }
        completedLabels.add(sym.id);
      } catch (labelErr: any) {
        console.error(`[AI-Analyze] Label error for "${sym.label}":`, labelErr.message);
        send({ phase: "labels", action: "error", symbolLabel: sym.label, message: labelErr.message });
      }
    }
    setGraph(g);
    persistProgress("labels");
    if (cancelRequested) { send({ phase: "cancelled", stats }); throw { __cancelled: true }; }
    if (pauseRequested) { send({ phase: "paused", stats }); throw { __paused: true }; }

    // ── Phase 2: Documentation Generation ──
    console.log("[AI-Analyze] Phase 2: Docs starting");
    updateState("docs");

    // Document all meaningful symbols — exclude __init__ modules and external files
    const SKIP_DOC_LABELS = ["__init__", "__pycache__"];
    const needDocs = g.symbols.filter((s) => {
      // Include: functions, methods, classes, modules, scripts, constants, packages, variables
      const docKinds = ["function", "method", "class", "module", "script", "package", "constant", "variable"];
      if (!docKinds.includes(s.kind)) return false;
      // Skip if already has a good summary
      if (s.doc?.summary && s.doc.summary.length >= 5) return false;
      // Skip scope filter
      if (scopeSymbolIds && !scopeSymbolIds.has(s.id)) return false;
      // Skip already completed
      if (completedDocs.has(s.id)) return false;
      // Skip __init__ and __pycache__ modules
      const shortLabel = s.label.split(".").pop() ?? s.label;
      if (SKIP_DOC_LABELS.some((skip) => shortLabel === skip || shortLabel.startsWith(skip))) return false;
      // Skip external files (kind=external or no location and no source)
      if (s.kind === "module" && s.label.includes("/") && !s.location) return false;
      return true;
    });
    const docsLimit = Math.min(needDocs.length, 200);
    console.log(`[AI-Analyze] Docs: ${needDocs.length} to process (${completedDocs.size} already done)`);
    send({ phase: "docs", action: "start", current: 0, total: docsLimit });
    send({ phase: "docs", action: "progress", message: `${needDocs.length} Symbole, generiere für ${docsLimit}…`, current: 0, total: docsLimit });

    let docsProcessed = 0;
    for (const sym of needDocs.slice(0, docsLimit)) {
      if (cancelRequested) { console.log("[AI-Analyze] Cancelled in docs phase"); break; }
      if (pauseRequested) { console.log("[AI-Analyze] Paused in docs phase"); break; }
      docsProcessed++;
      updateState("docs", docsProcessed, docsLimit, sym.id, sym.label, `Generiere Docs: \u201E${sym.label}\u201C`);
      const code = readSourceCode(sym, scanRoot);

      const relContext = g.relations
        .filter((r) => r.source === sym.id || r.target === sym.id)
        .slice(0, 10)
        .map((r) => {
          const other = g.symbols.find((s) => s.id === (r.source === sym.id ? r.target : r.source));
          const dir = r.source === sym.id ? "→" : "←";
          return `${r.type} ${dir} ${other?.label ?? "?"}`;
        })
        .join(", ");

      try {
        const result = await callOllama(
          `You are a code documentation expert. Analyze the given code and produce comprehensive, useful documentation.
Return a JSON object with these fields:
- "summary" (string, 1-2 sentences, max 120 chars): What this ${sym.kind} does in plain language
- "inputs" (array of {"name": string, "type": string, "description": string}): Parameters/inputs
- "outputs" (array of {"name": string, "type": string, "description": string}): Return values
- "sideEffects" (array of strings): Side effects like file I/O, network calls, DB operations, logging
- "calls" (array of strings): Names of functions/methods this code calls directly

Be specific and concrete. Write in the language of the code comments (German if code has German comments, otherwise English).
Respond ONLY with valid JSON, no markdown.`,
          `Symbol: ${sym.label}\nKind: ${sym.kind}\nRelations: ${relContext || "none known"}\n${code ? `\nSource code:\n${code.slice(0, 3000)}` : "(no source code available)"}`,
        );

        const docParsed = SymbolDocSchema.safeParse(result);
        if (docParsed.success && docParsed.data.summary) {
          sym.doc = {
            ...docParsed.data,
            ...sym.doc,
            summary: docParsed.data.summary,
            inputs: docParsed.data.inputs?.length ? docParsed.data.inputs : sym.doc?.inputs,
            outputs: docParsed.data.outputs?.length ? docParsed.data.outputs : sym.doc?.outputs,
            sideEffects: docParsed.data.sideEffects?.length ? docParsed.data.sideEffects : sym.doc?.sideEffects,
          };
          stats.docsGenerated++;
          console.log(`[AI-Analyze] Doc [${docsProcessed}/${docsLimit}]: "${sym.label}" → "${docParsed.data.summary?.slice(0, 60)}"`);
          send({
            phase: "docs",
            action: "generated",
            symbolId: sym.id,
            symbolLabel: sym.label,
            summary: docParsed.data.summary,
            current: docsProcessed,
            total: docsLimit,
          });
        } else {
          console.log(`[AI-Analyze] Doc: "${sym.label}" - validation failed, skipping`);
        }
        completedDocs.add(sym.id);
      } catch (docErr: any) {
        console.error(`[AI-Analyze] Doc error for "${sym.label}":`, docErr.message);
        send({ phase: "docs", action: "error", symbolLabel: sym.label, message: docErr.message });
      }

      // Save progress periodically (every 5 symbols)
      if (docsProcessed % 5 === 0) {
        setGraph(g);
        persistProgress("docs");
        send({ phase: "docs", action: "saved", message: `${docsProcessed}/${docsLimit} gespeichert…` });
      }
    }
    setGraph(g);
    persistProgress("docs");
    if (cancelRequested) { send({ phase: "cancelled", stats }); throw { __cancelled: true }; }
    if (pauseRequested) { send({ phase: "paused", stats }); throw { __paused: true }; }

    // ── Phase 3: Relations Discovery ──
    console.log("[AI-Analyze] Phase 3: Relations starting");
    updateState("relations");
    const analyzable = g.symbols.filter((s) =>
      (s.kind === "function" || s.kind === "method" || s.kind === "class") && s.location &&
      (!scopeSymbolIds || scopeSymbolIds.has(s.id)) &&
      !completedRelations.has(s.id), // skip already completed
    );
    const relLimit = Math.min(analyzable.length, 40);
    console.log(`[AI-Analyze] Relations: ${analyzable.length} to process (${completedRelations.size} already done)`);
    send({ phase: "relations", action: "start", current: 0, total: relLimit });
    send({ phase: "relations", action: "progress", message: `${analyzable.length} Symbole, analysiere ${relLimit} für neue Relationen…`, current: 0, total: relLimit });

    // Build a lookup of existing relations for dedup
    const existingRels = new Set(
      g.relations.map((r) => `${r.source}|${r.target}|${r.type}`),
    );
    // Build symbol label→id map for matching
    const labelToIds = new Map<string, string[]>();
    for (const s of g.symbols) {
      const short = s.label.split(".").pop()?.toLowerCase() ?? s.label.toLowerCase();
      const arr = labelToIds.get(short) ?? [];
      arr.push(s.id);
      labelToIds.set(short, arr);
      const full = s.label.toLowerCase();
      if (full !== short) {
        const arr2 = labelToIds.get(full) ?? [];
        arr2.push(s.id);
        labelToIds.set(full, arr2);
      }
    }

    let relIdx = 0;
    for (const sym of analyzable.slice(0, relLimit)) {
      if (cancelRequested) { console.log("[AI-Analyze] Cancelled in relations phase"); break; }
      if (pauseRequested) { console.log("[AI-Analyze] Paused in relations phase"); break; }
      relIdx++;
      updateState("relations", relIdx, relLimit, sym.id, sym.label, `Analysiere Relationen: \u201E${sym.label}\u201C`);
      const code = readSourceCode(sym, scanRoot);
      if (!code) { completedRelations.add(sym.id); continue; }

      const existingForSym = g.relations
        .filter((r) => r.source === sym.id || r.target === sym.id)
        .map((r) => `${r.type}: ${r.source === sym.id ? "→" : "←"} ${g.symbols.find((s) => s.id === (r.source === sym.id ? r.target : r.source))?.label ?? "?"}`)
        .join(", ");

      try {
        const result = await callOllama(
          `You analyze Python/JS code to discover function calls, data reads/writes, and dependencies NOT already known.
Return JSON: {"relations": [{"type": "calls"|"reads"|"writes"|"uses_config"|"instantiates", "targetName": "name"}]}
Rules:
- Only include relations you see DIRECTLY in the code
- "calls": function/method calls (use the function name as targetName)
- "reads": file reads, DB reads (use filename/table as targetName)
- "writes": file writes, DB writes
- "instantiates": class instantiation (use class name)
- Max 8 relations. Skip trivial calls like print/len/str.
Respond ONLY with valid JSON.`,
          `Symbol: ${sym.label} (${sym.kind})\nExisting relations: ${existingForSym || "none"}\nCode:\n${code.slice(0, 2500)}`,
        );

        const rels = (result as any)?.relations;
        if (Array.isArray(rels)) {
          for (const rel of rels.slice(0, 8)) {
            const targetName = (rel.targetName ?? "").toLowerCase().trim();
            const relType = rel.type;
            if (!targetName || !["calls", "reads", "writes", "uses_config", "instantiates"].includes(relType)) continue;

            let targetIds = labelToIds.get(targetName) ?? [];
            if (targetIds.length === 0) {
              for (const [key, ids] of labelToIds) {
                if (key.includes(targetName) || targetName.includes(key)) {
                  targetIds = ids;
                  break;
                }
              }
            }

            for (const targetId of targetIds.slice(0, 1)) {
              if (targetId === sym.id) continue;
              const key = `${sym.id}|${targetId}|${relType}`;
              if (existingRels.has(key)) continue;
              existingRels.add(key);

              const newRel: Relation = {
                id: `ai-rel-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                type: relType as any,
                source: sym.id,
                target: targetId,
                label: relType,
                confidence: 0.7,
              };
              g.relations.push(newRel);
              for (const view of g.views) {
                if (view.nodeRefs.includes(sym.id) && view.nodeRefs.includes(targetId)) {
                  if (!view.edgeRefs.includes(newRel.id)) view.edgeRefs.push(newRel.id);
                }
              }
              stats.relationsAdded++;

              const targetSym = g.symbols.find((s) => s.id === targetId);
              send({
                phase: "relations",
                action: "added",
                symbolId: sym.id,
                relationType: relType,
                sourceLabel: sym.label,
                targetLabel: targetSym?.label ?? rel.targetName,
                current: relIdx,
                total: relLimit,
              });
            }
          }
        }
        completedRelations.add(sym.id);
      } catch (relErr: any) {
        console.error(`[AI-Analyze] Relations error for "${sym.label}":`, relErr.message);
        send({ phase: "relations", action: "error", symbolLabel: sym.label, message: relErr.message });
      }
    }
    setGraph(g);
    persistProgress("relations");
    if (cancelRequested) { send({ phase: "cancelled", stats }); throw { __cancelled: true }; }
    if (pauseRequested) { send({ phase: "paused", stats }); throw { __paused: true }; }

    // ── Phase 4: Dead Code Detection ──
    console.log("[AI-Analyze] Phase 4: Dead-Code starting");
    updateState("dead-code");

    // Build incoming calls/imports map
    const incomingCalls = new Map<string, number>();
    for (const s of g.symbols) incomingCalls.set(s.id, 0);
    for (const r of g.relations) {
      if (r.type === "calls" || r.type === "imports" || r.type === "instantiates") {
        incomingCalls.set(r.target, (incomingCalls.get(r.target) ?? 0) + 1);
      }
    }

    const potentialDead = g.symbols.filter((s) => {
      if (s.kind !== "function" && s.kind !== "method") return false;
      if (scopeSymbolIds && !scopeSymbolIds.has(s.id)) return false;
      const shortName = s.label.split(".").pop() ?? "";
      if (shortName.startsWith("__") || shortName === "main" || shortName === "run") return false;
      if (s.tags?.includes("dead-code")) return false; // already tagged
      if (completedDeadCode.has(s.id)) return false; // already processed
      return (incomingCalls.get(s.id) ?? 0) === 0;
    });
    const deadLimit = Math.min(potentialDead.length, 30);
    console.log(`[AI-Analyze] Dead-Code: ${potentialDead.length} to process (${completedDeadCode.size} already done)`);
    send({ phase: "dead-code", action: "start", current: 0, total: deadLimit });
    send({ phase: "dead-code", action: "progress", message: `${potentialDead.length} potentiell ungenutzte Symbole, prüfe ${deadLimit}…`, current: 0, total: deadLimit });

    let deadIdx = 0;
    for (const sym of potentialDead.slice(0, deadLimit)) {
      if (cancelRequested) { console.log("[AI-Analyze] Cancelled in dead-code phase"); break; }
      if (pauseRequested) { console.log("[AI-Analyze] Paused in dead-code phase"); break; }
      deadIdx++;
      updateState("dead-code", deadIdx, deadLimit, sym.id, sym.label, `Pruefe Dead-Code: \u201E${sym.label}\u201C`);
      const code = readSourceCode(sym, scanRoot);

      let confirmed = true;
      let reason = "Keine eingehenden Aufrufe gefunden";

      if (code) {
        try {
          const result = await callOllama(
            `Determine if a Python/JS function appears to be dead/unused code.
Return JSON: {"isDead": true/false, "reason": "brief explanation"}
A function is NOT dead if: it's an entry point, API handler, event callback, test function, or likely called dynamically.
It IS dead if: it has no callers, not an entry point, and appears to be leftover code.`,
            `Function: ${sym.label}\nKind: ${sym.kind}\n${code ? `Code:\n${code.slice(0, 1500)}` : ""}`,
          );
          confirmed = (result as any)?.isDead === true;
          reason = (result as any)?.reason ?? reason;
        } catch {
          // On LLM failure, still mark based on graph analysis
        }
      }

      if (confirmed) {
        sym.tags = [...(sym.tags ?? []).filter((t) => t !== "dead-code"), "dead-code"];
        stats.deadCodeFound++;
        console.log(`[AI-Analyze] Dead-Code: "${sym.label}" - ${reason}`);
        send({
          phase: "dead-code",
          symbolId: sym.id,
          symbolLabel: sym.label,
          reason,
          current: deadIdx,
          total: deadLimit,
        });
      }
      completedDeadCode.add(sym.id);
    }
    setGraph(g);
    persistProgress("dead-code");
    if (cancelRequested) { send({ phase: "cancelled", stats }); throw { __cancelled: true }; }
    if (pauseRequested) { send({ phase: "paused", stats }); throw { __paused: true }; }

    // ── Done ──
    console.log(`[AI-Analyze] ✅ Done! Stats: ${JSON.stringify(stats)}`);
    clearAiProgress(); // analysis complete, remove saved progress
    analyzeState = { running: false, paused: false, phase: "done", stats: { ...stats } };
    send({ phase: "done", stats });
  } catch (err: any) {
    if (err?.__paused) {
      console.log(`[AI-Analyze] ⏸ Paused! Stats: ${JSON.stringify(stats)}`);
      persistProgress(analyzeState.phase ?? "unknown");
      analyzeState = { running: false, paused: true, phase: "paused", stats: { ...stats }, canResume: true };
      // paused event already sent before throw
    } else if (err?.__cancelled) {
      console.log(`[AI-Analyze] ⏹ Cancelled! Stats: ${JSON.stringify(stats)}`);
      persistProgress(analyzeState.phase ?? "unknown");
      analyzeState = { running: false, paused: false, phase: "cancelled", stats: { ...stats }, canResume: true };
      // cancelled event already sent before throw
    } else {
      console.error("[AI-Analyze] ❌ Fatal error:", err.message, err.stack);
      persistProgress(analyzeState.phase ?? "unknown");
      analyzeState = { running: false, paused: false, phase: "error", stats: { ...stats }, canResume: true };
      send({ phase: "error", message: err.message ?? "Analysis failed" });
    }
  }

  clearInterval(heartbeat);
  res.end();
});

/* ── Shared Ollama call helper ────────────────── */

async function callOllama(systemPrompt: string, userPrompt: string): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (OLLAMA_API_KEY) {
    headers["Authorization"] = `Bearer ${OLLAMA_API_KEY}`;
  }

  const url = `${OLLAMA_BASE_URL}/api/chat`;
  console.log(`[Ollama] Request: ${url} (model: ${OLLAMA_MODEL}, prompt: ${userPrompt.slice(0, 120)}...)`);
  const _ollamaStart = Date.now();

  const ollamaRes = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      stream: false,
      format: "json",
    }),
  });

  if (!ollamaRes.ok) {
    const text = await ollamaRes.text();
    console.error(`[Ollama] ❌ Error ${ollamaRes.status}: ${text.slice(0, 200)}`);
    throw new Error(`Ollama error ${ollamaRes.status}: ${text}`);
  }

  const ollamaData = (await ollamaRes.json()) as any;
  const elapsedMs = Date.now() - _ollamaStart;
  let content = (ollamaData?.message?.content ?? "{}").trim();
  console.log(`[Ollama] ✅ Response in ${elapsedMs}ms (raw): ${content.slice(0, 500)}`);

  // Strip markdown code fences that some models wrap around JSON
  if (content.startsWith("```")) {
    content = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
    console.log(`[Ollama] Stripped fences: ${content.slice(0, 120)}...`);
  }

  try {
    return JSON.parse(content);
  } catch {
    // Last resort: try to extract JSON object/array from the string
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        console.log(`[Ollama] Extracted JSON from response`);
        return JSON.parse(jsonMatch[0]);
      } catch { /* fall through */ }
    }
    throw new Error(`Ollama returned invalid JSON: ${content.slice(0, 200)}`);
  }
}
