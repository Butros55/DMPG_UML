import "dotenv/config";
import express from "express";
import cors from "cors";
import { graphRouter } from "./routes/graph.js";
import { scanRouter } from "./routes/scan.js";
import { aiRouter } from "./routes/ai.js";
import { projectsRouter } from "./routes/projects.js";
import { resolveAiConfig } from "./env.js";
import { getActiveAiModelConfig } from "./ai/modelRouting.js";
import { getActiveAiUseCaseRouting } from "./ai/useCases.js";

const app = express();
const PORT = Number(process.env.PORT ?? 3001);
const JSON_BODY_LIMIT = process.env.AI_HTTP_JSON_LIMIT?.trim() || "50mb";

app.use(cors());
app.use(express.json({ limit: JSON_BODY_LIMIT }));

app.use("/api/graph", graphRouter);
app.use("/api/scan", scanRouter);
app.use("/api/ai", aiRouter);
app.use("/api/projects", projectsRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

/* ── Open file in external IDE (VS Code / IntelliJ) ─────────────── */
import { execFile } from "node:child_process";
import * as path from "node:path";

app.post("/api/open-in-ide", (req, res) => {
  const { ide, file, line, projectPath, mode, diffFile } = req.body as {
    ide?: string;
    file?: string;
    line?: number;
    projectPath?: string;
    /** "goto" (default) | "diff" — controls how the IDE opens the file */
    mode?: "goto" | "diff";
    /** Second file for diff mode */
    diffFile?: string;
  };

  if (!file) {
    res.status(400).json({ error: "file is required" });
    return;
  }

  const scanRoot = projectPath ?? getGraph()?.sourceProjectPath ?? getCurrentProjectPath() ?? process.env.SCAN_PROJECT_PATH ?? "";
  const absFile = path.isAbsolute(file) ? file : path.join(scanRoot, file);
  const lineNum = line ?? 1;
  const openMode = mode ?? "goto";

  if (ide === "intellij") {
    // IntelliJ: idea64 <projectDir> --line <line> <file>
    // Diff mode: idea64 diff <file1> <file2>
    let args: string[];
    if (openMode === "diff" && diffFile) {
      const absDiff = path.isAbsolute(diffFile) ? diffFile : path.join(scanRoot, diffFile);
      args = ["diff", absFile, absDiff];
    } else {
      args = [scanRoot, "--line", String(lineNum), absFile];
    }
    execFile("idea64", args, { windowsHide: true }, (err) => {
      if (err) {
        execFile("idea", args, { windowsHide: true }, (err2) => {
          if (err2) {
            res.status(500).json({ error: `Could not open IntelliJ: ${err2.message}` });
          } else {
            res.json({ ok: true, ide: "intellij" });
          }
        });
      } else {
        res.json({ ok: true, ide: "intellij" });
      }
    });
  } else {
    // VS Code: code --goto <file>:<line> <folder>
    // Diff mode: code --diff <file1> <file2>
    let args: string[];
    if (openMode === "diff" && diffFile) {
      const absDiff = path.isAbsolute(diffFile) ? diffFile : path.join(scanRoot, diffFile);
      args = ["--diff", absFile, absDiff];
    } else {
      args = ["--goto", `${absFile}:${lineNum}`, scanRoot];
    }
    const opts = { windowsHide: true, shell: process.platform === "win32" };
    execFile("code", args, opts, (err) => {
      if (err) {
        res.status(500).json({ error: `Could not open VS Code: ${err.message}` });
      } else {
        res.json({ ok: true, ide: "vscode" });
      }
    });
  }
});

/** Expose non-secret config to the frontend */
import { getCurrentProjectPath, getGraph } from "./store.js";
app.get("/api/config", (_req, res) => {
  const aiConfig = resolveAiConfig();
  const graph = getGraph();
  res.json({
    scanProjectPath: graph?.sourceProjectPath ?? getCurrentProjectPath() ?? process.env.SCAN_PROJECT_PATH ?? "",
    aiProvider: aiConfig.provider,
    ollamaModel: aiConfig.model,
    aiModelRouting: getActiveAiModelConfig(aiConfig),
    aiUseCaseRouting: getActiveAiUseCaseRouting(aiConfig),
  });
});

app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const err = error as { type?: string; status?: number; message?: string };
  if (err?.type === "entity.too.large" || err?.status === 413) {
    res.status(413).json({
      error: `Request body too large. Reduce screenshot size or raise AI_HTTP_JSON_LIMIT (current ${JSON_BODY_LIMIT}).`,
    });
    return;
  }

  next(error);
});

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
