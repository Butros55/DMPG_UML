import test from "node:test";
import assert from "node:assert/strict";
import { callAiVisionJson } from "./client.js";

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_ENV = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

test("callAiVisionJson rejects missing images before contacting the provider", async () => {
  await assert.rejects(
    () =>
      callAiVisionJson({
        images: [],
        systemPrompt: "Inspect the image.",
        userPrompt: "Review UML quality.",
      }),
    /requires at least one input image/,
  );
});

test("callAiVisionJson rejects unsupported MIME types with a clear error", async () => {
  await assert.rejects(
    () =>
      callAiVisionJson({
        images: [{ mimeType: "image/svg+xml", dataBase64: "PHN2Zz48L3N2Zz4=" }],
        systemPrompt: "Inspect the image.",
        userPrompt: "Review UML quality.",
      }),
    /Unsupported vision image MIME type/,
  );
});

test("callAiVisionJson fails early when local mode has no selected model", async () => {
  restoreEnv();
  process.env.AI_PROVIDER = "local";

  await assert.rejects(
    () =>
      callAiVisionJson({
        images: [{ mimeType: "image/png", dataBase64: "AA==" }],
        systemPrompt: "Inspect the image.",
        userPrompt: "Review UML quality.",
      }),
    /No local Ollama model selected/,
  );
});

test("callAiVisionJson uses routing fallback models for vision requests", async () => {
  restoreEnv();
  process.env.AI_MODEL_ROUTING_ENABLED = "true";
  process.env.UML_FALLBACK_MODEL = "fallback-vision-model";
  process.env.OLLAMA_MODEL = "global-model";
  process.env.OLLAMA_BASE_URL = "http://vision.example";
  process.env.AI_PROVIDER = "cloud";

  const calls: Array<{ url: string; body: unknown }> = [];
  global.fetch = (async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body });

    if (url.endsWith("/api/show")) {
      return new Response(JSON.stringify({ capabilities: ["vision"] }), { status: 200 });
    }

    return new Response(
      JSON.stringify({ message: { content: "{\"summary\":\"ok\",\"issues\":[]}" } }),
      { status: 200 },
    );
  }) as typeof fetch;

  try {
    const result = await callAiVisionJson({
      endpointName: "diagram_image_review",
      images: [{ label: "current_view", mimeType: "image/png", dataBase64: "AA==" }],
      systemPrompt: "Inspect the image.",
      userPrompt: "Review UML quality.",
    });

    assert.equal(result.model.model, "fallback-vision-model");
    assert.equal(calls[0]?.url, "http://vision.example/api/show");
    assert.equal(calls[1]?.url, "http://vision.example/api/chat");
    assert.equal((calls[1]?.body as { model?: string })?.model, "fallback-vision-model");
    assert.deepEqual(
      ((calls[1]?.body as { messages?: Array<{ images?: string[] }> })?.messages?.[1]?.images) ?? [],
      ["AA=="],
    );
  } finally {
    global.fetch = ORIGINAL_FETCH;
    restoreEnv();
  }
});

test("callAiVisionJson fails clearly when the configured model lacks vision capability", async () => {
  restoreEnv();
  process.env.AI_MODEL_ROUTING_ENABLED = "true";
  process.env.UML_VISION_REVIEW_MODEL = "text-only-model";
  process.env.OLLAMA_MODEL = "global-model";
  process.env.OLLAMA_BASE_URL = "http://vision.example";
  process.env.AI_PROVIDER = "cloud";

  global.fetch = (async () =>
    new Response(JSON.stringify({ capabilities: ["completion"] }), { status: 200 })) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        callAiVisionJson({
          endpointName: "diagram_image_review",
          images: [{ mimeType: "image/png", dataBase64: "AA==" }],
          systemPrompt: "Inspect the image.",
          userPrompt: "Review UML quality.",
        }),
      /does not advertise the "vision" capability/,
    );
  } finally {
    global.fetch = ORIGINAL_FETCH;
    restoreEnv();
  }
});
