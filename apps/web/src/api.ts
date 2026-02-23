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
