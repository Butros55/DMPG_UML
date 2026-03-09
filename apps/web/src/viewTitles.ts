export function formatViewTitle(title: string | undefined, fallback: string): string {
  if (!title) return fallback;
  return title.replace(/^Layer\s+\d+\s*-\s*/i, "").trim();
}
