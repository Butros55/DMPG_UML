import "dotenv/config";
import express from "express";
import cors from "cors";
import { execFile } from "node:child_process";
import * as path from "node:path";
import { graphRouter } from "./routes/graph.js";
import { scanRouter } from "./routes/scan.js";
import { aiRouter } from "./routes/ai.js";
import { projectsRouter } from "./routes/projects.js";
import { resolveAiConfig } from "./env.js";
import { getActiveAiModelConfig } from "./ai/modelRouting.js";
import { getActiveAiUseCaseRouting } from "./ai/useCases.js";
import { getCurrentProjectPath, getGraph } from "./store.js";

const app = express();
const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.SERVER_HOST?.trim() || "127.0.0.1";
const JSON_BODY_LIMIT = process.env.AI_HTTP_JSON_LIMIT?.trim() || "50mb";
const DEFAULT_CORS_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];
const configuredCorsOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);
const allowedCorsOrigins = new Set(configuredCorsOrigins.length > 0 ? configuredCorsOrigins : DEFAULT_CORS_ORIGINS);

function isAllowedCorsOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  return allowedCorsOrigins.has(origin);
}

function resolvePathWithinScanRoot(scanRoot: string, candidatePath: string): string | null {
  const resolvedCandidate = path.isAbsolute(candidatePath)
    ? path.resolve(candidatePath)
    : path.resolve(scanRoot, candidatePath);
  const relative = path.relative(scanRoot, resolvedCandidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return resolvedCandidate;
}

app.use(cors({
  origin: (origin, callback) => {
    callback(null, isAllowedCorsOrigin(origin));
  },
}));
app.use(express.json({ limit: JSON_BODY_LIMIT }));

app.use("/api/graph", graphRouter);
app.use("/api/scan", scanRouter);
app.use("/api/ai", aiRouter);
app.use("/api/projects", projectsRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

/* Open file in external IDE (VS Code / IntelliJ). */
app.post("/api/open-in-ide", (req, res) => {
  const payload = (typeof req.body === "object" && req.body) ? req.body as {
    ide?: string;
    file?: string;
    line?: number;
    projectPath?: string;
    mode?: "goto" | "diff";
    diffFile?: string;
  } : {};

  const file = typeof payload.file === "string" ? payload.file.trim() : "";
  if (!file) {
    res.status(400).json({ error: "file is required" });
    return;
  }

  const configuredProjectPath = typeof payload.projectPath === "string"
    ? payload.projectPath.trim()
    : "";
  const scanRootRaw = configuredProjectPath
    || getGraph()?.sourceProjectPath
    || getCurrentProjectPath()
    || process.env.SCAN_PROJECT_PATH
    || process.cwd();
  const scanRoot = path.resolve(scanRootRaw);
  const absFile = resolvePathWithinScanRoot(scanRoot, file);
  if (!absFile) {
    res.status(400).json({ error: "file must stay within the active project path" });
    return;
  }

  const lineNum = Number.isInteger(payload.line) && (payload.line as number) > 0
    ? (payload.line as number)
    : 1;
  const openMode = payload.mode === "diff" ? "diff" : "goto";
  const ide = payload.ide === "intellij" ? "intellij" : "vscode";

  if (ide === "intellij") {
    let args: string[];
    if (openMode === "diff") {
      const diffFile = typeof payload.diffFile === "string" ? payload.diffFile.trim() : "";
      if (!diffFile) {
        res.status(400).json({ error: "diffFile is required in diff mode" });
        return;
      }
      const absDiff = resolvePathWithinScanRoot(scanRoot, diffFile);
      if (!absDiff) {
        res.status(400).json({ error: "diffFile must stay within the active project path" });
        return;
      }
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
    return;
  }

  let args: string[];
  if (openMode === "diff") {
    const diffFile = typeof payload.diffFile === "string" ? payload.diffFile.trim() : "";
    if (!diffFile) {
      res.status(400).json({ error: "diffFile is required in diff mode" });
      return;
    }
    const absDiff = resolvePathWithinScanRoot(scanRoot, diffFile);
    if (!absDiff) {
      res.status(400).json({ error: "diffFile must stay within the active project path" });
      return;
    }
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
});

/* Expose non-secret config to the frontend. */
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

app.listen(PORT, HOST, () => {
  console.log(`[server] listening on http://${HOST}:${PORT}`);
});
