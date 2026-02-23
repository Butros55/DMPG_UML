import { Router, type Router as RouterType } from "express";
import { AiDocRequestSchema, SymbolDocSchema } from "@dmpg/shared";
import { getGraph, setGraph } from "../store.js";

export const aiRouter: RouterType = Router();

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "https://ollama.com";
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY ?? "";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.1:8b";

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
${codeSnippet ? `Code:\n${codeSnippet}` : ""}
${context ? `Context:\n${context}` : ""}`;

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (OLLAMA_API_KEY) {
      headers["Authorization"] = `Bearer ${OLLAMA_API_KEY}`;
    }

    const ollamaRes = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
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
      res.status(502).json({ error: `Ollama error ${ollamaRes.status}: ${text}` });
      return;
    }

    const ollamaData = (await ollamaRes.json()) as any;
    const content = ollamaData?.message?.content ?? "{}";
    let docJson: unknown;
    try {
      docJson = JSON.parse(content);
    } catch {
      res.status(502).json({ error: "Ollama returned invalid JSON", raw: content });
      return;
    }

    const docParsed = SymbolDocSchema.safeParse(docJson);
    if (!docParsed.success) {
      res.status(502).json({ error: "AI output failed validation", issues: docParsed.error.flatten(), raw: docJson });
      return;
    }

    // persist in graph
    if (g && sym) {
      sym.doc = { ...sym.doc, ...docParsed.data };
      setGraph(g);
    }

    res.json({ doc: docParsed.data });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "AI request failed" });
  }
});
