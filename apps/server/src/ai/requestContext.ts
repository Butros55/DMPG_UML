import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";

export const LOCAL_AI_MODEL_HEADER = "x-dmpg-local-ai-model";

export interface AiRequestOverrides {
  localModel?: string;
}

const requestContext = new AsyncLocalStorage<AiRequestOverrides>();

function normalizeLocalModel(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeOverrides(overrides: AiRequestOverrides): AiRequestOverrides {
  return {
    localModel: normalizeLocalModel(overrides.localModel),
  };
}

export function getAiRequestOverrides(): AiRequestOverrides {
  return requestContext.getStore() ?? {};
}

export function runWithAiRequestOverrides<T>(overrides: AiRequestOverrides, callback: () => T): T {
  return requestContext.run(normalizeOverrides(overrides), callback);
}

export function aiRequestContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  runWithAiRequestOverrides(
    { localModel: req.header(LOCAL_AI_MODEL_HEADER) ?? undefined },
    () => next(),
  );
}
