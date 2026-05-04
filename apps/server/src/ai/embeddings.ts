import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ScanFeatureOption } from "@dmpg/shared";
import { envNonEmpty, normalizeBaseUrl, resolveAiConfig, type AiConfig, type EnvMap } from "../env.js";

const CACHE_VERSION = 2;
const DEFAULT_EMBEDDING_MODEL = "embeddinggemma";
const DEFAULT_EMBEDDING_TIMEOUT_MS = 120_000;
const DEFAULT_EMBEDDING_BATCH_SIZE = 1;
const DEFAULT_EMBEDDING_KEEP_ALIVE = "10m";
const MAX_EMBEDDING_FILES = 500;
const DEFAULT_MAX_EMBEDDING_CHUNKS = 250;
const MAX_FILE_BYTES = 256 * 1024;
const DEFAULT_CHUNK_CHARS = 1200;
const DEFAULT_CHUNK_OVERLAP = 120;
const MIN_CHUNK_CHARS = 256;
const MAX_CHUNK_CHARS = 4000;
const MAX_BATCH_SIZE = 8;
const MAX_CACHE_CHUNKS = 5000;

const INCLUDE_EXTENSIONS = new Set([
  ".py",
  ".pyi",
  ".md",
  ".txt",
  ".json",
  ".toml",
  ".yaml",
  ".yml",
  ".ini",
  ".cfg",
]);

const SKIP_DIRS = new Set([
  ".git",
  ".dmpg-data",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".tox",
  ".venv",
  "__pycache__",
  "build",
  "dist",
  "node_modules",
  "venv",
]);

type NormalizedFeatureMode = "auto" | "on" | "off";

export interface ProjectEmbeddingEntry {
  key: string;
  projectPath: string;
  model: string;
  filePath: string;
  contentHash: string;
  chunkIndex: number;
  text: string;
  embedding: number[];
}

export interface ProjectEmbeddingIndex {
  projectPath: string;
  model: string;
  entries: ProjectEmbeddingEntry[];
  warnings: string[];
  baseUrl: string;
  apiKey: string;
}

export interface ProjectEmbeddingBuildOptions {
  useEmbeddings?: ScanFeatureOption;
  env?: EnvMap;
}

export interface ProjectEmbeddingSearchResult {
  entry: ProjectEmbeddingEntry;
  score: number;
}

interface EmbeddingRuntimeConfig {
  enabled: boolean;
  model: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  batchSize: number;
  chunkChars: number;
  chunkOverlap: number;
  maxChunks: number;
  keepAlive: string;
  warnings: string[];
}

interface TextChunk {
  filePath: string;
  contentHash: string;
  chunkIndex: number;
  text: string;
}

interface EmbeddingCachePayload {
  version: number;
  projectPath: string;
  entries: ProjectEmbeddingEntry[];
}

function normalizeFeatureOption(option: ScanFeatureOption | string | undefined): NormalizedFeatureMode {
  if (option === true) return "on";
  if (option === false) return "off";
  if (typeof option !== "string") return "auto";
  const normalized = option.trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return "on";
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return "off";
  return "auto";
}

function hashPath(projectPath: string): string {
  return crypto
    .createHash("sha256")
    .update(path.resolve(projectPath).toLowerCase().replace(/\\/g, "/"))
    .digest("hex")
    .slice(0, 12);
}

function sha256(input: string | Buffer): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function dataDir(env: EnvMap = process.env): string {
  return path.resolve(envNonEmpty("DMPG_DATA_DIR", env) ?? path.join(process.cwd(), ".dmpg-data"));
}

export function projectEmbeddingCacheFile(projectPath: string, env: EnvMap = process.env): string {
  return path.join(dataDir(env), "projects", hashPath(projectPath), "embeddings.json");
}

export function createEmbeddingCacheKey(params: {
  projectPath: string;
  model: string;
  filePath: string;
  contentHash: string;
  chunkIndex: number;
  textHash: string;
}): string {
  return sha256([
    path.resolve(params.projectPath).toLowerCase().replace(/\\/g, "/"),
    params.model,
    params.filePath.replace(/\\/g, "/"),
    params.contentHash,
    String(params.chunkIndex),
    params.textHash,
  ].join("|"));
}

function resolveEmbeddingRuntimeConfig(options: ProjectEmbeddingBuildOptions = {}): EmbeddingRuntimeConfig {
  const env = options.env ?? process.env;
  const aiConfig = resolveAiConfig(env);
  const endpoint = resolveEmbeddingEndpoint(env, aiConfig);
  const requestMode = normalizeFeatureOption(options.useEmbeddings);
  const envMode = normalizeFeatureOption(envNonEmpty("UML_EMBEDDINGS_ENABLED", env));
  const effectiveMode = requestMode === "auto" ? envMode : requestMode;
  const model = envNonEmpty("UML_EMBEDDING_MODEL", env) ?? DEFAULT_EMBEDDING_MODEL;
  const timeoutMs = readPositiveInt(env, "UML_EMBEDDING_TIMEOUT_MS", DEFAULT_EMBEDDING_TIMEOUT_MS);
  const batchSize = Math.min(
    MAX_BATCH_SIZE,
    Math.max(1, readPositiveInt(env, "UML_EMBEDDING_BATCH_SIZE", DEFAULT_EMBEDDING_BATCH_SIZE)),
  );
  const chunkChars = readClampedPositiveInt(
    env,
    "UML_EMBEDDING_CHUNK_CHARS",
    DEFAULT_CHUNK_CHARS,
    MIN_CHUNK_CHARS,
    MAX_CHUNK_CHARS,
  );
  const chunkOverlap = Math.min(
    Math.floor(chunkChars / 3),
    readNonNegativeInt(env, "UML_EMBEDDING_CHUNK_OVERLAP", DEFAULT_CHUNK_OVERLAP),
  );
  const maxChunks = readClampedPositiveInt(
    env,
    "UML_EMBEDDING_MAX_CHUNKS",
    DEFAULT_MAX_EMBEDDING_CHUNKS,
    1,
    MAX_CACHE_CHUNKS,
  );
  const keepAlive = envNonEmpty("UML_EMBEDDING_KEEP_ALIVE", env) ?? DEFAULT_EMBEDDING_KEEP_ALIVE;
  const warnings: string[] = [];

  if (effectiveMode === "off") {
    return {
      enabled: false,
      model,
      baseUrl: endpoint.baseUrl,
      apiKey: endpoint.apiKey,
      timeoutMs,
      batchSize,
      chunkChars,
      chunkOverlap,
      maxChunks,
      keepAlive,
      warnings,
    };
  }

  return {
    enabled: true,
    model,
    baseUrl: endpoint.baseUrl,
    apiKey: endpoint.apiKey,
    timeoutMs,
    batchSize,
    chunkChars,
    chunkOverlap,
    maxChunks,
    keepAlive,
    warnings,
  };
}

function readPositiveInt(env: EnvMap, name: string, fallback: number): number {
  const raw = envNonEmpty(name, env);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeInt(env: EnvMap, name: string, fallback: number): number {
  const raw = envNonEmpty(name, env);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readClampedPositiveInt(
  env: EnvMap,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = readPositiveInt(env, name, fallback);
  return Math.min(max, Math.max(min, parsed));
}

function resolveEmbeddingEndpoint(
  env: EnvMap,
  aiConfig: AiConfig,
): Pick<EmbeddingRuntimeConfig, "baseUrl" | "apiKey"> {
  const explicitBaseUrl = envNonEmpty("UML_EMBEDDING_BASE_URL", env);
  if (explicitBaseUrl) {
    return {
      baseUrl: normalizeBaseUrl(explicitBaseUrl),
      apiKey: envNonEmpty("UML_EMBEDDING_API_KEY", env) ?? "",
    };
  }

  if (aiConfig.provider === "local") {
    return { baseUrl: aiConfig.baseUrl, apiKey: "" };
  }

  return {
    baseUrl: normalizeBaseUrl(envNonEmpty("OLLAMA_LOCAL_URL", env) ?? "http://127.0.0.1:11434"),
    apiKey: "",
  };
}

function createAiHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function collectProjectFiles(projectPath: string): string[] {
  const files: string[] = [];

  function walk(dir: string): void {
    if (files.length >= MAX_EMBEDDING_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= MAX_EMBEDDING_FILES) return;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(fullPath);
      } else if (entry.isFile() && INCLUDE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  }

  walk(projectPath);
  return files.sort((left, right) => left.localeCompare(right));
}

function chunkText(
  filePath: string,
  relativePath: string,
  content: string,
  chunkChars: number,
  chunkOverlap: number,
): TextChunk[] {
  const chunks: TextChunk[] = [];
  const normalizedContent = content.replace(/\r\n/g, "\n");
  const contentHash = sha256(normalizedContent);
  const maxChars = Math.max(MIN_CHUNK_CHARS, Math.min(MAX_CHUNK_CHARS, chunkChars));
  const overlap = Math.max(0, Math.min(Math.floor(maxChars / 3), chunkOverlap));
  let offset = 0;
  let chunkIndex = 0;

  while (offset < normalizedContent.length) {
    const maxEnd = Math.min(normalizedContent.length, offset + maxChars);
    let end = maxEnd;
    if (maxEnd < normalizedContent.length) {
      const minEnd = offset + Math.floor(maxChars * 0.6);
      const newlineEnd = normalizedContent.lastIndexOf("\n", maxEnd);
      if (newlineEnd >= minEnd) end = newlineEnd + 1;
    }
    const text = normalizedContent.slice(offset, end).trim();
    if (text) {
      chunks.push({
        filePath: relativePath,
        contentHash,
        chunkIndex,
        text,
      });
    }
    if (end >= normalizedContent.length) break;
    const nextOffset = Math.max(offset + 1, end - overlap);
    offset = nextOffset > offset ? nextOffset : end;
    chunkIndex++;
  }

  if (chunks.length === 0) {
    chunks.push({
      filePath: relativePath || path.basename(filePath),
      contentHash,
      chunkIndex: 0,
      text: "",
    });
  }
  return chunks;
}

function collectTextChunks(
  projectPath: string,
  config: Pick<EmbeddingRuntimeConfig, "chunkChars" | "chunkOverlap">,
): TextChunk[] {
  const chunks: TextChunk[] = [];
  for (const filePath of collectProjectFiles(projectPath)) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }
    if (stat.size > MAX_FILE_BYTES) continue;

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const relativePath = path.relative(projectPath, filePath).replace(/\\/g, "/");
      chunks.push(...chunkText(filePath, relativePath, content, config.chunkChars, config.chunkOverlap));
    } catch {
      // Ignore unreadable project files; the scanner must remain best-effort.
    }
  }
  return chunks;
}

function loadEmbeddingCache(cacheFile: string): EmbeddingCachePayload {
  try {
    if (!fs.existsSync(cacheFile)) return { version: CACHE_VERSION, projectPath: "", entries: [] };
    const parsed = JSON.parse(fs.readFileSync(cacheFile, "utf-8")) as Partial<EmbeddingCachePayload>;
    if (parsed.version !== CACHE_VERSION || !Array.isArray(parsed.entries)) {
      return { version: CACHE_VERSION, projectPath: "", entries: [] };
    }
    return {
      version: CACHE_VERSION,
      projectPath: parsed.projectPath ?? "",
      entries: parsed.entries.filter((entry) =>
        entry &&
        typeof entry.key === "string" &&
        typeof entry.model === "string" &&
        typeof entry.filePath === "string" &&
        Array.isArray(entry.embedding),
      ),
    };
  } catch {
    return { version: CACHE_VERSION, projectPath: "", entries: [] };
  }
}

function saveEmbeddingCache(cacheFile: string, payload: EmbeddingCachePayload): void {
  const dir = path.dirname(cacheFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(payload), "utf-8");
}

async function embedTexts(
  texts: readonly string[],
  config: Pick<EmbeddingRuntimeConfig, "model" | "baseUrl" | "apiKey"> &
    Partial<Pick<EmbeddingRuntimeConfig, "timeoutMs" | "keepAlive">>,
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const timeoutMs = config.timeoutMs ?? DEFAULT_EMBEDDING_TIMEOUT_MS;
  const keepAlive = config.keepAlive ?? DEFAULT_EMBEDDING_KEEP_ALIVE;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}/api/embed`, {
      method: "POST",
      headers: createAiHeaders(config.apiKey),
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        input: [...texts],
        keep_alive: keepAlive,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama embed error ${response.status}: ${body.slice(0, 200)}`);
    }

    const payload = await response.json() as { embeddings?: unknown; embedding?: unknown };
    const rawEmbeddings = Array.isArray(payload.embeddings)
      ? payload.embeddings
      : Array.isArray(payload.embedding)
        ? [payload.embedding]
        : [];

    const embeddings = rawEmbeddings
      .map((vector) => Array.isArray(vector)
        ? vector.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
        : [])
      .filter((vector) => vector.length > 0);

    if (embeddings.length !== texts.length) {
      throw new Error(`Ollama returned ${embeddings.length} embeddings for ${texts.length} inputs.`);
    }
    return embeddings;
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new Error(
        `Ollama embed request timed out after ${Math.round(timeoutMs / 1000)}s at ` +
        `${config.baseUrl}/api/embed. Increase UML_EMBEDDING_TIMEOUT_MS or reduce ` +
        `UML_EMBEDDING_BATCH_SIZE/UML_EMBEDDING_CHUNK_CHARS.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function embeddingErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function isInputTooLongEmbeddingError(message: string): boolean {
  return /input length exceeds|context length|too many tokens|maximum context|num_ctx/i.test(message);
}

function isBatchRetryableEmbeddingError(message: string): boolean {
  return isInputTooLongEmbeddingError(message) || /timed out/i.test(message);
}

function describeChunk(chunk: TextChunk): string {
  return `${chunk.filePath || "<project>"}#${chunk.chunkIndex}`;
}

function createEmbeddingEntry(
  resolvedProjectPath: string,
  model: string,
  chunk: TextChunk,
  embedding: number[],
): ProjectEmbeddingEntry {
  return {
    key: createEmbeddingCacheKey({
      projectPath: resolvedProjectPath,
      model,
      filePath: chunk.filePath,
      contentHash: chunk.contentHash,
      chunkIndex: chunk.chunkIndex,
      textHash: sha256(chunk.text),
    }),
    projectPath: resolvedProjectPath,
    model,
    filePath: chunk.filePath,
    contentHash: chunk.contentHash,
    chunkIndex: chunk.chunkIndex,
    text: chunk.text,
    embedding,
  };
}

async function embedMissingBatch(
  batch: readonly TextChunk[],
  config: EmbeddingRuntimeConfig,
  warnings: string[],
): Promise<Array<{ chunk: TextChunk; embedding: number[] }>> {
  try {
    const embeddings = await embedTexts(batch.map((chunk) => chunk.text), config);
    return batch
      .map((chunk, index) => ({ chunk, embedding: embeddings[index] }))
      .filter((item): item is { chunk: TextChunk; embedding: number[] } => Boolean(item.embedding));
  } catch (error) {
    const message = embeddingErrorMessage(error);
    if (batch.length > 1 && isBatchRetryableEmbeddingError(message)) {
      warnings.push(
        `Embedding batch of ${batch.length} chunks failed (${message.slice(0, 160)}); retrying chunks individually.`,
      );
      const embedded: Array<{ chunk: TextChunk; embedding: number[] }> = [];
      for (const chunk of batch) {
        try {
          const [embedding] = await embedTexts([chunk.text], config);
          if (embedding) embedded.push({ chunk, embedding });
        } catch (singleError) {
          const singleMessage = embeddingErrorMessage(singleError);
          if (isInputTooLongEmbeddingError(singleMessage)) {
            warnings.push(
              `Skipped embedding chunk ${describeChunk(chunk)} because it exceeds the model context. ` +
              `Lower UML_EMBEDDING_CHUNK_CHARS if this repeats.`,
            );
            continue;
          }
          throw singleError;
        }
      }
      return embedded;
    }

    if (isInputTooLongEmbeddingError(message)) {
      for (const chunk of batch) {
        warnings.push(
          `Skipped embedding chunk ${describeChunk(chunk)} because it exceeds the model context. ` +
          `Lower UML_EMBEDDING_CHUNK_CHARS if this repeats.`,
        );
      }
      return [];
    }

    throw error;
  }
}

export async function buildProjectEmbeddingIndex(
  projectPath: string,
  options: ProjectEmbeddingBuildOptions = {},
): Promise<ProjectEmbeddingIndex> {
  const resolvedProjectPath = path.resolve(projectPath);
  const config = resolveEmbeddingRuntimeConfig(options);
  const warnings = [...config.warnings];
  if (!config.enabled) {
    return {
      projectPath: resolvedProjectPath,
      model: config.model,
      entries: [],
      warnings,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
    };
  }

  let chunks = collectTextChunks(resolvedProjectPath, config);
  if (chunks.length > config.maxChunks) {
    warnings.push(
      `Embedding context limited to ${config.maxChunks} of ${chunks.length} chunks. ` +
      `Raise UML_EMBEDDING_MAX_CHUNKS if you need more project context.`,
    );
    chunks = chunks.slice(0, config.maxChunks);
  }
  const cacheFile = projectEmbeddingCacheFile(resolvedProjectPath, options.env);
  const cache = loadEmbeddingCache(cacheFile);
  const cachedEntries = new Map(cache.entries.map((entry) => [entry.key, entry]));
  const entries: ProjectEmbeddingEntry[] = [];
  const missing: TextChunk[] = [];

  for (const chunk of chunks) {
    const key = createEmbeddingCacheKey({
      projectPath: resolvedProjectPath,
      model: config.model,
      filePath: chunk.filePath,
      contentHash: chunk.contentHash,
      chunkIndex: chunk.chunkIndex,
      textHash: sha256(chunk.text),
    });
    const cached = cachedEntries.get(key);
    if (cached?.model === config.model) {
      entries.push(cached);
    } else {
      missing.push(chunk);
    }
  }

  try {
    for (let index = 0; index < missing.length; index += config.batchSize) {
      const batch = missing.slice(index, index + config.batchSize);
      const embeddedChunks = await embedMissingBatch(batch, config, warnings);
      for (const { chunk, embedding } of embeddedChunks) {
        entries.push(createEmbeddingEntry(resolvedProjectPath, config.model, chunk, embedding));
      }
    }
    saveEmbeddingCache(cacheFile, {
      version: CACHE_VERSION,
      projectPath: resolvedProjectPath,
      entries: entries.sort((left, right) =>
        left.filePath.localeCompare(right.filePath) || left.chunkIndex - right.chunkIndex,
      ),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    warnings.push(`Embeddings unavailable: ${message}`);
    return {
      projectPath: resolvedProjectPath,
      model: config.model,
      entries,
      warnings,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
    };
  }

  return {
    projectPath: resolvedProjectPath,
    model: config.model,
    entries,
    warnings,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
  };
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export async function searchProjectEmbeddings(
  index: ProjectEmbeddingIndex | null,
  query: string,
  topK = 5,
): Promise<ProjectEmbeddingSearchResult[]> {
  if (!index || index.entries.length === 0 || !query.trim()) return [];
  const [queryEmbedding] = await embedTexts([query], index);
  if (!queryEmbedding) return [];

  return index.entries
    .map((entry) => ({
      entry,
      score: cosineSimilarity(queryEmbedding, entry.embedding),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(0, topK));
}
