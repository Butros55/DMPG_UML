import { resolveAiConfig } from "../env.js";
import { resolveModelForTask, type ResolvedAiTaskModel } from "./modelRouting.js";
import { AI_TASK_TYPES, normalizeAiTaskType, type AiTaskType } from "./taskTypes.js";

export interface CallAiJsonOptions {
  taskType?: AiTaskType;
  systemPrompt: string;
  userPrompt: string;
  responseFormat?: "json" | Record<string, unknown>;
  requestOptions?: Record<string, unknown>;
}

export interface ParsedAiJsonResponse {
  data: unknown;
  model: ResolvedAiTaskModel;
}

export interface AiVisionImageInput {
  label?: string;
  mimeType: string;
  dataBase64: string;
}

export interface CallAiVisionJsonOptions extends CallAiJsonOptions {
  images: AiVisionImageInput[];
  endpointName?: string;
}

interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
}

interface ExecuteAiChatJsonOptions {
  taskType?: AiTaskType;
  systemPrompt: string;
  userPrompt: string;
  responseFormat?: "json" | Record<string, unknown>;
  requestOptions?: Record<string, unknown>;
  messages?: OllamaChatMessage[];
  logLabel?: string;
}

interface OllamaChatResponse {
  message?: { content?: string };
}

interface OllamaShowResponse {
  capabilities?: string[];
}

const VISION_CAPABILITY = "vision";
const SUPPORTED_VISION_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/bmp",
]);
const modelCapabilityCache = new Map<string, Promise<Set<string> | null>>();

function createAiHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function parseAiJsonContent(content: string, resolvedModel: ResolvedAiTaskModel): ParsedAiJsonResponse {
  let normalized = content.trim();
  if (normalized.startsWith("```")) {
    normalized = normalized.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
    console.log(`[Ollama] Stripped fences: ${normalized.slice(0, 120)}...`);
  }

  try {
    return {
      data: JSON.parse(normalized),
      model: resolvedModel,
    };
  } catch {
    const jsonMatch = normalized.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        console.log("[Ollama] Extracted JSON from response");
        return {
          data: JSON.parse(jsonMatch[0]),
          model: resolvedModel,
        };
      } catch {
        // fall through to final error
      }
    }

    throw new Error(`Ollama returned invalid JSON: ${normalized.slice(0, 200)}`);
  }
}

async function executeAiChatJson(options: ExecuteAiChatJsonOptions): Promise<ParsedAiJsonResponse> {
  const aiConfig = resolveAiConfig();
  const taskType = normalizeAiTaskType(options.taskType);
  const resolvedModel = resolveModelForTask(taskType, aiConfig);
  if (!resolvedModel.model.trim()) {
    throw new Error(
      "No local Ollama model selected. Choose a running model in the AI Workspace dropdown.",
    );
  }
  const headers = createAiHeaders(aiConfig.apiKey);
  const url = `${aiConfig.baseUrl}/api/chat`;
  console.log(
    `[AI] task=${taskType} provider=${aiConfig.provider} model=${resolvedModel.model} source=${resolvedModel.source}${options.logLabel ? ` ${options.logLabel}` : ""}`,
  );
  console.log(
    `[Ollama] Request: ${url} (task=${taskType}, model=${resolvedModel.model}, promptChars=${options.userPrompt.length})`,
  );

  const ollamaStart = Date.now();
  const ollamaRes = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: resolvedModel.model,
      messages: options.messages ?? [
        { role: "system", content: options.systemPrompt },
        { role: "user", content: options.userPrompt },
      ],
      stream: false,
      format: options.responseFormat ?? "json",
      ...(options.requestOptions ? { options: options.requestOptions } : {}),
    }),
  });

  if (!ollamaRes.ok) {
    const text = await ollamaRes.text();
    console.error(`[Ollama] Error ${ollamaRes.status}: ${text.slice(0, 200)}`);
    throw new Error(`Ollama error ${ollamaRes.status}: ${text}`);
  }

  const ollamaData = (await ollamaRes.json()) as OllamaChatResponse;
  const elapsedMs = Date.now() - ollamaStart;
  const content = (ollamaData.message?.content ?? "{}").trim();
  console.log(`[Ollama] Response in ${elapsedMs}ms (contentChars=${content.length})`);

  return parseAiJsonContent(content, resolvedModel);
}

function normalizeVisionBase64(input: string): string {
  const trimmed = input.trim();
  const dataUrlMatch = trimmed.match(/^data:([^;]+);base64,(.+)$/i);
  const base64Payload = dataUrlMatch ? dataUrlMatch[2] : trimmed;
  const normalized = base64Payload.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error("Vision image data must be valid base64-encoded image content.");
  }
  return normalized;
}

function normalizeVisionImages(images: AiVisionImageInput[]): AiVisionImageInput[] {
  if (images.length === 0) {
    throw new Error("Vision review requires at least one input image.");
  }

  return images.map((image, index) => {
    const mimeType = image.mimeType.trim().toLowerCase();
    if (!SUPPORTED_VISION_MIME_TYPES.has(mimeType)) {
      throw new Error(
        `Unsupported vision image MIME type at index ${index}: ${image.mimeType}. ` +
        "Supported types are PNG, JPEG, WEBP, GIF and BMP.",
      );
    }

    return {
      label: image.label?.trim() || undefined,
      mimeType,
      dataBase64: normalizeVisionBase64(image.dataBase64),
    };
  });
}

async function fetchModelCapabilities(model: string, baseUrl: string, apiKey: string): Promise<Set<string> | null> {
  const cacheKey = `${baseUrl}|${model}`;
  const cached = modelCapabilityCache.get(cacheKey);
  if (cached) return cached;

  const pending = (async () => {
    try {
      const response = await fetch(`${baseUrl}/api/show`, {
        method: "POST",
        headers: createAiHeaders(apiKey),
        body: JSON.stringify({ model }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`[AI] Could not inspect model capabilities for "${model}": ${response.status} ${errorText.slice(0, 200)}`);
        return null;
      }

      const payload = (await response.json()) as OllamaShowResponse;
      if (!Array.isArray(payload.capabilities)) return null;
      return new Set(payload.capabilities.map((capability) => capability.toLowerCase()));
    } catch (error) {
      console.warn(
        `[AI] Could not inspect model capabilities for "${model}": ${error instanceof Error ? error.message : "unknown error"}`,
      );
      return null;
    }
  })();

  modelCapabilityCache.set(cacheKey, pending);
  const result = await pending;
  if (result === null) {
    modelCapabilityCache.delete(cacheKey);
  }
  return result;
}

export async function callAiJson(options: CallAiJsonOptions): Promise<ParsedAiJsonResponse> {
  return executeAiChatJson(options);
}

export async function callAiVisionJson(options: CallAiVisionJsonOptions): Promise<ParsedAiJsonResponse> {
  const aiConfig = resolveAiConfig();
  const taskType = normalizeAiTaskType(options.taskType ?? AI_TASK_TYPES.VISION_REVIEW);
  const resolvedModel = resolveModelForTask(taskType, aiConfig);
  if (!resolvedModel.model.trim()) {
    throw new Error(
      "No local Ollama model selected. Choose a running model in the AI Workspace dropdown.",
    );
  }
  const normalizedImages = normalizeVisionImages(options.images);
  const capabilities = await fetchModelCapabilities(resolvedModel.model, aiConfig.baseUrl, aiConfig.apiKey);
  if (capabilities && !capabilities.has(VISION_CAPABILITY)) {
    throw new Error(
      `Configured vision model "${resolvedModel.model}" does not advertise the "${VISION_CAPABILITY}" capability. ` +
      "Set UML_VISION_REVIEW_MODEL or UML_FALLBACK_MODEL to a vision-capable model.",
    );
  }

  try {
    return await executeAiChatJson({
      ...options,
      taskType,
      responseFormat: options.responseFormat ?? "json",
      requestOptions: { temperature: 0, ...(options.requestOptions ?? {}) },
      messages: [
        { role: "system", content: options.systemPrompt },
        {
          role: "user",
          content: options.userPrompt,
          images: normalizedImages.map((image) => image.dataBase64),
        },
      ],
      logLabel: `endpoint=${options.endpointName ?? "vision"} images=${normalizedImages.length}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    const lowerMessage = message.toLowerCase();
    if (
      lowerMessage.includes("vision") ||
      lowerMessage.includes("image") ||
      lowerMessage.includes("multimodal") ||
      lowerMessage.includes("capability")
    ) {
      throw new Error(
        `Vision request failed for model "${resolvedModel.model}": ${message}. ` +
        "Confirm that UML_VISION_REVIEW_MODEL points to a multimodal Ollama model.",
      );
    }
    throw error;
  }
}

