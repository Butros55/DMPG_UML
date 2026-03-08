import { AI_TASK_TYPES, type AiTaskType } from "./ai/taskTypes.js";

export type AiProvider = "cloud" | "local";
export type AiGlobalModelSource =
  | "ollama_local_model"
  | "ollama_cloud_model"
  | "ollama_model"
  | "default";

export interface AiRoutingConfig {
  enabled: boolean;
  fallbackModel?: string;
  defaultTaskModel?: string;
  taskModels: Partial<Record<AiTaskType, string>>;
}

export interface AiConfig {
  provider: AiProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  modelSource: AiGlobalModelSource;
  routing: AiRoutingConfig;
}

export type EnvMap = Record<string, string | undefined>;

const ROUTED_TASK_MODEL_ENV_VARS: Readonly<Record<AiTaskType, string>> = {
  [AI_TASK_TYPES.GENERAL]: "AI_DEFAULT_TASK_MODEL",
  [AI_TASK_TYPES.CODE_ANALYSIS]: "UML_CODE_ANALYSIS_MODEL",
  [AI_TASK_TYPES.DIAGRAM_REVIEW]: "UML_DIAGRAM_REVIEW_MODEL",
  [AI_TASK_TYPES.VISION_REVIEW]: "UML_VISION_REVIEW_MODEL",
  [AI_TASK_TYPES.LABELING]: "UML_LABELING_MODEL",
  [AI_TASK_TYPES.RELATION_VALIDATION]: "UML_RELATION_VALIDATION_MODEL",
};

export function envNonEmpty(name: string, env: EnvMap = process.env): string | undefined {
  const raw = env[name];
  if (raw == null) return undefined;
  const value = raw.trim();
  return value.length > 0 ? value : undefined;
}

export function normalizeBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, "");
  if (url.endsWith("/api")) url = url.slice(0, -4);
  return url;
}

function envBoolean(name: string, fallback: boolean, env: EnvMap = process.env): boolean {
  const raw = envNonEmpty(name, env);
  if (!raw) return fallback;

  const normalized = raw.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function resolveGlobalModel(provider: AiProvider, env: EnvMap): {
  model: string;
  source: AiGlobalModelSource;
} {
  const defaultModel = "llama3.1:8b";
  const providerSpecificModel = provider === "local"
    ? envNonEmpty("OLLAMA_LOCAL_MODEL", env)
    : envNonEmpty("OLLAMA_CLOUD_MODEL", env);
  const sharedModel = envNonEmpty("OLLAMA_MODEL", env);

  if (providerSpecificModel) {
    return {
      model: providerSpecificModel,
      source: provider === "local" ? "ollama_local_model" : "ollama_cloud_model",
    };
  }

  if (sharedModel) {
    return { model: sharedModel, source: "ollama_model" };
  }

  return { model: defaultModel, source: "default" };
}

function resolveRoutingConfig(env: EnvMap): AiRoutingConfig {
  return {
    enabled: envBoolean("AI_MODEL_ROUTING_ENABLED", false, env),
    fallbackModel: envNonEmpty("UML_FALLBACK_MODEL", env),
    defaultTaskModel: envNonEmpty("AI_DEFAULT_TASK_MODEL", env),
    taskModels: {
      [AI_TASK_TYPES.CODE_ANALYSIS]: envNonEmpty(ROUTED_TASK_MODEL_ENV_VARS[AI_TASK_TYPES.CODE_ANALYSIS], env),
      [AI_TASK_TYPES.DIAGRAM_REVIEW]: envNonEmpty(ROUTED_TASK_MODEL_ENV_VARS[AI_TASK_TYPES.DIAGRAM_REVIEW], env),
      [AI_TASK_TYPES.VISION_REVIEW]: envNonEmpty(ROUTED_TASK_MODEL_ENV_VARS[AI_TASK_TYPES.VISION_REVIEW], env),
      [AI_TASK_TYPES.LABELING]: envNonEmpty(ROUTED_TASK_MODEL_ENV_VARS[AI_TASK_TYPES.LABELING], env),
      [AI_TASK_TYPES.RELATION_VALIDATION]: envNonEmpty(ROUTED_TASK_MODEL_ENV_VARS[AI_TASK_TYPES.RELATION_VALIDATION], env),
    },
  };
}

export function resolveAiConfig(env: EnvMap = process.env): AiConfig {
  const providerRaw = (envNonEmpty("AI_PROVIDER", env) ?? "cloud").toLowerCase();
  const provider: AiProvider = providerRaw === "local" ? "local" : "cloud";

  const cloudUrl = normalizeBaseUrl(
    envNonEmpty("OLLAMA_BASE_URL", env) ?? "https://ollama.com",
  );
  const localUrl = normalizeBaseUrl(
    envNonEmpty("OLLAMA_LOCAL_URL", env) ?? "http://127.0.0.1:11434",
  );
  const globalModel = resolveGlobalModel(provider, env);

  return {
    provider,
    baseUrl: provider === "local" ? localUrl : cloudUrl,
    apiKey: provider === "local" ? "" : (envNonEmpty("OLLAMA_API_KEY", env) ?? ""),
    model: globalModel.model,
    modelSource: globalModel.source,
    routing: resolveRoutingConfig(env),
  };
}
