import "dotenv/config";
import express from "express";
import cors from "cors";
import { graphRouter } from "./routes/graph.js";
import { scanRouter } from "./routes/scan.js";
import { aiRouter } from "./routes/ai.js";
import { projectsRouter } from "./routes/projects.js";

const app = express();
const PORT = Number(process.env.PORT ?? 3001);

app.use(cors());
app.use(express.json({ limit: "10mb" }));

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
  const { ide, file, line, projectPath } = req.body as {
    ide?: string;
    file?: string;
    line?: number;
    projectPath?: string;
  };

  if (!file) {
    res.status(400).json({ error: "file is required" });
    return;
  }

  const scanRoot = projectPath ?? getCurrentProjectPath() ?? process.env.SCAN_PROJECT_PATH ?? "";
  const absFile = path.isAbsolute(file) ? file : path.join(scanRoot, file);
  const lineNum = line ?? 1;

  if (ide === "intellij") {
    // IntelliJ: idea64 <projectDir> --line <line> <file>
    // Passing projectDir makes IntelliJ reuse the window if it already has that project open,
    // or open a new window if not.
    const args = [scanRoot, "--line", String(lineNum), absFile];
    execFile("idea64", args, { windowsHide: true }, (err) => {
      if (err) {
        // Fallback: try "idea" without "64"
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
    // Without --reuse-window: if the folder is already open in a VS Code window,
    // that window is reused. Otherwise a new window opens — never hijacks a
    // window that has a different project open.
    const args = ["--goto", `${absFile}:${lineNum}`, scanRoot];
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
import { getCurrentProjectPath } from "./store.js";
app.get("/api/config", (_req, res) => {
  const provider = (process.env.AI_PROVIDER ?? "cloud").toLowerCase();
  const model = provider === "local"
    ? (process.env.OLLAMA_LOCAL_MODEL ?? process.env.OLLAMA_MODEL ?? "")
    : (process.env.OLLAMA_CLOUD_MODEL ?? process.env.OLLAMA_MODEL ?? "");
  res.json({
    scanProjectPath: getCurrentProjectPath() ?? process.env.SCAN_PROJECT_PATH ?? "",
    aiProvider: provider,
    ollamaModel: model,
  });
});

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
