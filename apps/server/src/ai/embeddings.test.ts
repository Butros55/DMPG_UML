import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildProjectEmbeddingIndex,
  projectEmbeddingCacheFile,
} from "./embeddings.js";

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("embedding cache is keyed by content hash and model", async () => {
  const projectDir = tempDir("dmpg-embed-project-");
  const dataDir = tempDir("dmpg-embed-data-");
  const sourceFile = path.join(projectDir, "sample.py");
  fs.writeFileSync(sourceFile, "class Alpha:\n    pass\n", "utf-8");

  const env = {
    AI_PROVIDER: "cloud",
    OLLAMA_BASE_URL: "http://ollama.test",
    OLLAMA_API_KEY: "test-key",
    UML_EMBEDDINGS_ENABLED: "on",
    UML_EMBEDDING_MODEL: "embed-a",
    UML_EMBEDDING_BASE_URL: "http://ollama.test",
    UML_EMBEDDING_API_KEY: "test-key",
    UML_EMBEDDING_TIMEOUT_MS: "2500",
    UML_EMBEDDING_BATCH_SIZE: "2",
    UML_EMBEDDING_KEEP_ALIVE: "30m",
    DMPG_DATA_DIR: dataDir,
  };

  const originalFetch = globalThis.fetch;
  const calls: string[][] = [];
  const bodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { input?: string[] | string };
    bodies.push(body as Record<string, unknown>);
    const inputs = Array.isArray(body.input) ? body.input : [body.input ?? ""];
    calls.push(inputs);
    return {
      ok: true,
      async json() {
        return {
          embeddings: inputs.map((text, index) => [text.length + index + calls.length, 1]),
        };
      },
      async text() {
        return "";
      },
    } as Response;
  }) as typeof fetch;

  try {
    const first = await buildProjectEmbeddingIndex(projectDir, { env });
    assert.equal(first.entries.length, 1);
    assert.equal(calls.length, 1);
    assert.equal(bodies[0]?.keep_alive, "30m");

    const second = await buildProjectEmbeddingIndex(projectDir, { env });
    assert.equal(second.entries.length, 1);
    assert.equal(calls.length, 1);

    fs.writeFileSync(sourceFile, "class Alpha:\n    value = 1\n", "utf-8");
    const changed = await buildProjectEmbeddingIndex(projectDir, { env });
    assert.equal(changed.entries.length, 1);
    assert.equal(calls.length, 2);
    assert.notEqual(changed.entries[0]?.contentHash, first.entries[0]?.contentHash);

    const otherModel = await buildProjectEmbeddingIndex(projectDir, {
      env: { ...env, UML_EMBEDDING_MODEL: "embed-b" },
    });
    assert.equal(otherModel.entries.length, 1);
    assert.equal(calls.length, 3);

    assert.ok(fs.existsSync(projectEmbeddingCacheFile(projectDir, env)));
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("embedding endpoint defaults to local Ollama when chat provider is cloud", async () => {
  const index = await buildProjectEmbeddingIndex("C:/tmp/project", {
    env: {
      AI_PROVIDER: "cloud",
      OLLAMA_BASE_URL: "https://ollama.com",
      OLLAMA_API_KEY: "cloud-key",
      OLLAMA_LOCAL_URL: "http://local-ollama.test/api",
      UML_EMBEDDINGS_ENABLED: "off",
      UML_EMBEDDING_MODEL: "embeddinggemma",
    },
  });

  assert.equal(index.baseUrl, "http://local-ollama.test");
  assert.equal(index.apiKey, "");
});

test("embedding endpoint can be explicitly overridden", async () => {
  const index = await buildProjectEmbeddingIndex("C:/tmp/project", {
    env: {
      AI_PROVIDER: "cloud",
      OLLAMA_BASE_URL: "https://ollama.com",
      OLLAMA_API_KEY: "cloud-key",
      UML_EMBEDDINGS_ENABLED: "off",
      UML_EMBEDDING_BASE_URL: "https://ollama.com/api",
      UML_EMBEDDING_API_KEY: "embed-key",
    },
  });

  assert.equal(index.baseUrl, "https://ollama.com");
  assert.equal(index.apiKey, "embed-key");
});

test("embedding timeout warning explains local Ollama aborts", async () => {
  const projectDir = tempDir("dmpg-embed-timeout-project-");
  const dataDir = tempDir("dmpg-embed-timeout-data-");
  fs.writeFileSync(path.join(projectDir, "sample.py"), "class TimeoutProbe:\n    pass\n", "utf-8");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new DOMException("This operation was aborted", "AbortError");
  }) as typeof fetch;

  try {
    const index = await buildProjectEmbeddingIndex(projectDir, {
      env: {
        AI_PROVIDER: "cloud",
        OLLAMA_BASE_URL: "https://ollama.com",
        OLLAMA_API_KEY: "cloud-key",
        OLLAMA_LOCAL_URL: "http://127.0.0.1:11434",
        UML_EMBEDDINGS_ENABLED: "on",
        UML_EMBEDDING_TIMEOUT_MS: "3000",
        DMPG_DATA_DIR: dataDir,
      },
    });

    assert.match(index.warnings.join("\n"), /timed out after 3s/i);
    assert.match(index.warnings.join("\n"), /UML_EMBEDDING_TIMEOUT_MS/i);
    assert.doesNotMatch(index.warnings.join("\n"), /This operation was aborted/);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("embedding chunks respect configured size and max chunk limits", async () => {
  const projectDir = tempDir("dmpg-embed-chunks-project-");
  const dataDir = tempDir("dmpg-embed-chunks-data-");
  fs.writeFileSync(path.join(projectDir, "large.py"), "x".repeat(3500), "utf-8");

  const originalFetch = globalThis.fetch;
  const seenInputs: string[] = [];
  globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { input?: string[] | string };
    const inputs = Array.isArray(body.input) ? body.input : [body.input ?? ""];
    seenInputs.push(...inputs);
    return {
      ok: true,
      async json() {
        return { embeddings: inputs.map((text, index) => [text.length, index + 1]) };
      },
      async text() {
        return "";
      },
    } as Response;
  }) as typeof fetch;

  try {
    const index = await buildProjectEmbeddingIndex(projectDir, {
      env: {
        AI_PROVIDER: "cloud",
        OLLAMA_BASE_URL: "https://ollama.com",
        OLLAMA_API_KEY: "cloud-key",
        UML_EMBEDDINGS_ENABLED: "on",
        UML_EMBEDDING_CHUNK_CHARS: "500",
        UML_EMBEDDING_CHUNK_OVERLAP: "50",
        UML_EMBEDDING_MAX_CHUNKS: "3",
        UML_EMBEDDING_BATCH_SIZE: "2",
        DMPG_DATA_DIR: dataDir,
      },
    });

    assert.equal(index.entries.length, 3);
    assert.equal(seenInputs.length, 3);
    assert.ok(seenInputs.every((input) => input.length <= 500));
    assert.match(index.warnings.join("\n"), /limited to 3/i);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("embedding context errors retry batches and skip only oversized chunks", async () => {
  const projectDir = tempDir("dmpg-embed-retry-project-");
  const dataDir = tempDir("dmpg-embed-retry-data-");
  fs.writeFileSync(path.join(projectDir, "a.py"), "class Alpha:\n    pass\n", "utf-8");
  fs.writeFileSync(path.join(projectDir, "b.py"), "class Beta:\n    pass\n", "utf-8");
  fs.writeFileSync(path.join(projectDir, "c.py"), "too-long marker\n", "utf-8");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { input?: string[] | string };
    const inputs = Array.isArray(body.input) ? body.input : [body.input ?? ""];
    const tooLong = inputs.length > 1 || inputs.some((input) => input.includes("too-long"));
    if (tooLong) {
      return {
        ok: false,
        status: 400,
        async json() {
          return {};
        },
        async text() {
          return '{"error":"the input length exceeds the context length"}';
        },
      } as Response;
    }
    return {
      ok: true,
      async json() {
        return { embeddings: inputs.map((text, index) => [text.length + index, 1]) };
      },
      async text() {
        return "";
      },
    } as Response;
  }) as typeof fetch;

  try {
    const index = await buildProjectEmbeddingIndex(projectDir, {
      env: {
        AI_PROVIDER: "cloud",
        OLLAMA_BASE_URL: "https://ollama.com",
        OLLAMA_API_KEY: "cloud-key",
        UML_EMBEDDINGS_ENABLED: "on",
        UML_EMBEDDING_CHUNK_CHARS: "1000",
        UML_EMBEDDING_BATCH_SIZE: "2",
        DMPG_DATA_DIR: dataDir,
      },
    });

    assert.equal(index.entries.length, 2);
    assert.deepEqual(index.entries.map((entry) => entry.filePath), ["a.py", "b.py"]);
    assert.match(index.warnings.join("\n"), /retrying chunks individually/i);
    assert.match(index.warnings.join("\n"), /Skipped embedding chunk c\.py#0/i);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
