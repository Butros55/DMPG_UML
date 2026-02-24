import "dotenv/config";
import express from "express";
import cors from "cors";
import { graphRouter } from "./routes/graph.js";
import { scanRouter } from "./routes/scan.js";
import { aiRouter } from "./routes/ai.js";

const app = express();
const PORT = Number(process.env.PORT ?? 3001);

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.use("/api/graph", graphRouter);
app.use("/api/scan", scanRouter);
app.use("/api/ai", aiRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

/** Expose non-secret config to the frontend */
app.get("/api/config", (_req, res) => {
  const provider = (process.env.AI_PROVIDER ?? "cloud").toLowerCase();
  const model = provider === "local"
    ? (process.env.OLLAMA_LOCAL_MODEL ?? process.env.OLLAMA_MODEL ?? "")
    : (process.env.OLLAMA_CLOUD_MODEL ?? process.env.OLLAMA_MODEL ?? "");
  res.json({
    scanProjectPath: process.env.SCAN_PROJECT_PATH ?? "",
    aiProvider: provider,
    ollamaModel: model,
  });
});

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
