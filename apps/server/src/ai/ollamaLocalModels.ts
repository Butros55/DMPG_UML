import { execFile } from "node:child_process";

export interface RunningOllamaModel {
  name: string;
  id: string | null;
  size: string | null;
  processor: string | null;
  until: string | null;
}

function cellAt(columns: string[], index: number): string | null {
  if (index < 0 || index >= columns.length) return null;
  const value = columns[index]?.trim();
  return value ? value : null;
}

export function parseOllamaPsOutput(stdout: string): RunningOllamaModel[] {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) return [];

  const [headerLine, ...rows] = lines;
  const headers = headerLine.split(/\s{2,}/).map((cell) => cell.trim().toUpperCase());
  const nameIndex = headers.indexOf("NAME");
  const idIndex = headers.indexOf("ID");
  const sizeIndex = headers.indexOf("SIZE");
  const processorIndex = headers.indexOf("PROCESSOR");
  const untilIndex = headers.indexOf("UNTIL");

  return rows
    .map((row) => row.split(/\s{2,}/).map((cell) => cell.trim()))
    .map((columns) => {
      const name = cellAt(columns, nameIndex >= 0 ? nameIndex : 0);
      if (!name) return null;
      return {
        name,
        id: cellAt(columns, idIndex),
        size: cellAt(columns, sizeIndex),
        processor: cellAt(columns, processorIndex),
        until: cellAt(columns, untilIndex),
      } satisfies RunningOllamaModel;
    })
    .filter((entry): entry is RunningOllamaModel => entry !== null);
}

export async function listRunningOllamaModels(): Promise<RunningOllamaModel[]> {
  return new Promise((resolve, reject) => {
    execFile(
      "ollama",
      ["ps"],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const message = stderr.trim() || error.message || "Could not execute `ollama ps`.";
          reject(new Error(message));
          return;
        }

        resolve(parseOllamaPsOutput(stdout));
      },
    );
  });
}
