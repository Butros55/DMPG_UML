import test from "node:test";
import assert from "node:assert/strict";
import { parseOllamaPsOutput } from "./ollamaLocalModels.js";

test("parseOllamaPsOutput extracts running models from `ollama ps` table output", () => {
  const models = parseOllamaPsOutput(`
NAME                 ID              SIZE      PROCESSOR    UNTIL
llama3.2:3b          a80c4f17acd5    2.0 GB    100% GPU     4 minutes from now
qwen2.5-coder:14b    7f84b5c4a7df    9.3 GB    100% CPU     2 minutes from now
`);

  assert.deepEqual(models, [
    {
      name: "llama3.2:3b",
      id: "a80c4f17acd5",
      size: "2.0 GB",
      processor: "100% GPU",
      until: "4 minutes from now",
    },
    {
      name: "qwen2.5-coder:14b",
      id: "7f84b5c4a7df",
      size: "9.3 GB",
      processor: "100% CPU",
      until: "2 minutes from now",
    },
  ]);
});

test("parseOllamaPsOutput returns an empty array when no running models are listed", () => {
  const models = parseOllamaPsOutput("NAME    ID    SIZE    PROCESSOR    UNTIL\n");
  assert.deepEqual(models, []);
});
