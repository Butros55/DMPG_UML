import type {
  AiExternalContextReviewResponse,
  AiLabelImprovementResponse,
  AiSymbolEnrichmentResponse,
  DiagramImageCompareResponse,
  DiagramImageReviewResponse,
  DiagramImageSuggestionsResponse,
  SymbolDoc,
  UmlReferenceCompareResponse,
} from "@dmpg/shared";

type Severity = "low" | "medium" | "high";
type StructuredParser<T> = {
  safeParse: (value: unknown) =>
    | { success: true; data: T }
    | { success: false; error: { message: string } };
};

interface ParseStructuredResponseOptions {
  alwaysNormalize?: boolean;
}

interface NamedTarget {
  id: string;
  label: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function readString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = normalizeWhitespace(value);
    return normalized.length > 0 ? normalized : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return undefined;
}

function readStringFromKeys(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = readString(record[key]);
    if (value) return value;
  }
  return undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "ja", "1"].includes(normalized)) return true;
    if (["false", "no", "nein", "0"].includes(normalized)) return false;
  }
  return undefined;
}

function splitLooseList(text: string): string[] {
  const normalized = text.replace(/\r/g, "");
  const baseParts = normalized.includes("\n")
    ? normalized.split("\n")
    : normalized.includes(";")
      ? normalized.split(";")
      : [normalized];

  return baseParts
    .map((part) => normalizeWhitespace(part.replace(/^[\s>*•\-–]+/, "").replace(/^\d+[.)]\s*/, "")))
    .filter((part) => part.length > 0);
}

function toList(value: unknown, singularKeys: readonly string[] = []): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return splitLooseList(value);
  if (!isRecord(value)) return [];

  if (singularKeys.some((key) => key in value)) {
    return [value];
  }

  for (const key of ["items", "values", "results", "list", "data"]) {
    if (key in value) {
      return toList(value[key], singularKeys);
    }
  }

  return Object.values(value);
}

function readListFromKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  singularKeys: readonly string[] = [],
): unknown[] {
  for (const key of keys) {
    if (key in record) {
      return toList(record[key], singularKeys);
    }
  }
  return [];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeConfidence(value: unknown, fallback?: number): number | undefined {
  const numeric = readNumber(value);
  if (numeric == null) return fallback;
  if (numeric > 1 && numeric <= 100) {
    return clamp01(numeric / 100);
  }
  return clamp01(numeric);
}

function normalizeSeverity(value: unknown, text = ""): Severity {
  const normalized = readString(value)?.toLowerCase();
  if (normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized;
  }

  const numeric = readNumber(value);
  if (numeric != null) {
    if (numeric >= 0.75 || numeric >= 3) return "high";
    if (numeric >= 0.35 || numeric >= 2) return "medium";
    return "low";
  }

  const lower = text.toLowerCase();
  if (/(critical|severe|major|blocking|high priority|must)/.test(lower)) return "high";
  if (/(minor|small|cosmetic|low priority|optional)/.test(lower)) return "low";
  return "medium";
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function buildAliases(label: string): string[] {
  const normalized = normalizeKey(label);
  const shortLabel = normalizeKey(label.split(/[./\\]/).pop() ?? label);
  return Array.from(new Set([normalized, shortLabel])).filter((entry) => entry.length > 0);
}

function resolveTargetId(targets: readonly NamedTarget[], hint?: string): string | undefined {
  if (!hint) return undefined;
  const normalizedHint = normalizeKey(hint);
  if (!normalizedHint) return undefined;

  const exact = targets.find((target) => buildAliases(target.label).some((alias) => alias === normalizedHint));
  if (exact) return exact.id;

  const fuzzy = targets.find((target) =>
    buildAliases(target.label).some((alias) => alias.includes(normalizedHint) || normalizedHint.includes(alias))
  );
  return fuzzy?.id;
}

function resolveTargetIdsFromText(targets: readonly NamedTarget[], text: string): string[] {
  const normalizedText = normalizeKey(text);
  if (!normalizedText) return [];

  return targets
    .filter((target) => buildAliases(target.label).some((alias) => normalizedText.includes(alias)))
    .map((target) => target.id);
}

function pickBestEnum<T extends string>(
  text: string,
  candidates: ReadonlyArray<{ value: T; keywords: readonly string[] }>,
  fallback: T,
): T {
  const normalized = text.toLowerCase();
  let best: { value: T; score: number } | null = null;

  for (const candidate of candidates) {
    const score = candidate.keywords.reduce(
      (total, keyword) => total + (normalized.includes(keyword) ? 1 : 0),
      0,
    );
    if (score > 0 && (!best || score > best.score)) {
      best = { value: candidate.value, score };
    }
  }

  return best?.value ?? fallback;
}

function summarizeFromMessages(messages: string[], fallback: string): string {
  const first = messages.find((message) => message.length > 0);
  return first ?? fallback;
}

function fallbackDifferenceSuggestion(
  category: UmlReferenceCompareResponse["differences"][number]["category"],
): string {
  switch (category) {
    case "notation":
      return "Use clearer UML notation so the current diagram matches the reference better.";
    case "layout":
      return "Rework the layout so related elements align more clearly.";
    case "grouping":
      return "Regroup the affected elements into clearer architectural units.";
    case "missing_element":
      return "Add the missing architectural element shown or implied by the reference.";
    case "relation_visibility":
      return "Expose the key relations more explicitly in the view.";
    case "context":
      return "Add the missing external or system context to the diagram.";
    case "layering":
      return "Strengthen the visible layer or hierarchy boundaries in the view.";
    case "naming":
      return "Rename the affected element so its responsibility is clearer.";
  }
}

function normalizeUmlQualityDelta(value: unknown, contextText: string): UmlReferenceCompareResponse["overallAssessment"]["umlQualityDelta"] {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "better_reference" || normalized === "roughly_equal" || normalized === "better_current") {
      return normalized;
    }
    if (
      normalized.includes("reference") && (normalized.includes("better") || normalized.includes("stronger") || normalized.includes("clearer"))
    ) {
      return "better_reference";
    }
    if (
      normalized.includes("current") && (normalized.includes("better") || normalized.includes("stronger") || normalized.includes("clearer"))
    ) {
      return "better_current";
    }
    if (normalized.includes("equal") || normalized.includes("similar") || normalized.includes("same")) {
      return "roughly_equal";
    }
  }

  const numeric = readNumber(value);
  if (numeric != null) {
    if (numeric > 0.1) return "better_reference";
    if (numeric < -0.1) return "better_current";
    return "roughly_equal";
  }

  return pickBestEnum(
    contextText,
    [
      { value: "better_reference", keywords: ["reference better", "reference is better", "current is worse", "professor", "move current closer"] },
      { value: "better_current", keywords: ["current better", "reference is weaker", "current is stronger"] },
      { value: "roughly_equal", keywords: ["similar", "roughly equal", "comparable", "close enough"] },
    ],
    "better_reference",
  );
}

function inferUmlMainProblem(text: string): UmlReferenceCompareResponse["overallAssessment"]["mainProblem"] {
  return pickBestEnum(
    text,
    [
      { value: "notation", keywords: ["uml", "notation", "symbol", "shape", "package", "database", "artifact", "component", "note", "ui card", "card style", "generic card"] },
      { value: "layering", keywords: ["layer", "layering", "tier", "hierarchy", "flow", "pipeline level", "level", "schicht"] },
      { value: "relations", keywords: ["relation", "dependency", "edge", "arrow", "link", "beziehung"] },
      { value: "context", keywords: ["context", "external", "actor", "environment", "system boundary", "umfeld"] },
      { value: "grouping", keywords: ["group", "grouping", "cluster", "bucket", "package split"] },
      { value: "naming", keywords: ["name", "naming", "label", "title", "term", "terminology", "benennung"] },
    ],
    "notation",
  );
}

function inferUmlDifferenceCategory(text: string): UmlReferenceCompareResponse["differences"][number]["category"] {
  return pickBestEnum(
    text,
    [
      { value: "notation", keywords: ["uml", "notation", "symbol", "shape", "package", "database", "artifact", "component", "note", "ui card", "card style", "generic card"] },
      { value: "layout", keywords: ["layout", "spacing", "alignment", "position", "overlap", "arrangement"] },
      { value: "grouping", keywords: ["group", "grouping", "cluster", "bucket", "cohesion"] },
      { value: "missing_element", keywords: ["missing", "absent", "not shown", "not represented", "omitted"] },
      { value: "relation_visibility", keywords: ["relation", "dependency", "edge", "arrow", "connector", "link"] },
      { value: "context", keywords: ["context", "external system", "environment", "neighbor", "boundary"] },
      { value: "layering", keywords: ["layer", "layering", "tier", "hierarchy", "flow", "level"] },
      { value: "naming", keywords: ["name", "naming", "label", "title", "term", "terminology"] },
    ],
    "notation",
  );
}

function inferDiagramCompareCategory(text: string): DiagramImageCompareResponse["differences"][number]["category"] {
  return pickBestEnum(
    text,
    [
      { value: "notation", keywords: ["uml", "notation", "symbol", "shape", "package", "database", "artifact", "component", "ui card", "generic card"] },
      { value: "layout", keywords: ["layout", "spacing", "alignment", "position", "overlap", "arrangement"] },
      { value: "grouping", keywords: ["group", "grouping", "cluster", "bucket", "cohesion"] },
      { value: "missing_element", keywords: ["missing", "absent", "context", "not shown", "omitted", "external"] },
      { value: "relation_visibility", keywords: ["relation", "dependency", "edge", "arrow", "connector", "link"] },
    ],
    "notation",
  );
}

function inferDiagramReviewIssueType(text: string): DiagramImageReviewResponse["issues"][number]["type"] {
  return pickBestEnum(
    text,
    [
      { value: "missing_relations", keywords: ["missing relation", "missing dependency", "edge", "arrow", "relation", "dependency"] },
      { value: "weak_grouping", keywords: ["group", "grouping", "cluster", "package split", "weak grouping"] },
      { value: "non_uml_shape", keywords: ["uml", "notation", "shape", "symbol", "ui card", "generic card", "database shape", "package symbol", "plain box", "cylinder", "database"] },
      { value: "too_sparse", keywords: ["sparse", "few relations", "empty", "isolated", "too little", "blank"] },
      { value: "too_dense", keywords: ["dense", "crowded", "cluttered", "too many", "overloaded"] },
      { value: "missing_context", keywords: ["context", "external", "boundary", "surrounding system"] },
      { value: "naming_unclear", keywords: ["name", "naming", "label", "title", "terminology"] },
    ],
    "too_sparse",
  );
}

function inferRecommendedNodeType(text: string): NonNullable<DiagramImageReviewResponse["recommendedNodeTypes"]>[number]["umlType"] {
  return pickBestEnum(
    text,
    [
      { value: "database", keywords: ["database", "db", "storage", "cylinder"] },
      { value: "artifact", keywords: ["artifact", "file", "dataset", "document"] },
      { value: "component", keywords: ["component", "service", "api"] },
      { value: "note", keywords: ["note", "annotation", "comment", "legend"] },
      { value: "package", keywords: ["package", "domain group", "bounded context"] },
    ],
    "package",
  );
}

function inferDiagramSuggestionType(text: string): DiagramImageSuggestionsResponse["suggestions"][number]["type"] {
  return pickBestEnum(
    text,
    [
      { value: "add_context_stub", keywords: ["context", "external", "stub", "boundary"] },
      { value: "change_group_type", keywords: ["group type", "change group", "container type"] },
      { value: "promote_to_package", keywords: ["package", "bounded context", "promote group"] },
      { value: "use_database_shape", keywords: ["database", "db", "storage", "cylinder"] },
      { value: "split_view", keywords: ["split view", "separate view", "too dense", "split into views"] },
      { value: "aggregate_relations", keywords: ["aggregate relation", "merge edges", "simplify relations", "bundle dependencies"] },
    ],
    "promote_to_package",
  );
}

function inferMigrationType(text: string): UmlReferenceCompareResponse["migrationSuggestions"][number]["type"] {
  return pickBestEnum(
    text,
    [
      { value: "replace_group_with_package", keywords: ["package", "replace group", "group card", "domain block"] },
      { value: "use_database_shape", keywords: ["database", "db", "storage", "cylinder"] },
      { value: "add_context_stub", keywords: ["context", "external", "stub", "boundary"] },
      { value: "split_view", keywords: ["split view", "separate view", "new view", "detail view"] },
      { value: "aggregate_relations", keywords: ["aggregate relation", "merge edges", "bundle dependencies", "simplify relations"] },
      { value: "rename_group", keywords: ["rename", "better name", "clearer label"] },
      { value: "add_note", keywords: ["note", "annotation", "legend", "comment"] },
      { value: "promote_artifact_shape", keywords: ["artifact", "file", "dataset", "document"] },
    ],
    "replace_group_with_package",
  );
}

function inferGraphSuggestionType(text: string): NonNullable<UmlReferenceCompareResponse["graphSuggestions"]>[number]["type"] {
  return pickBestEnum(
    text,
    [
      { value: "node_type_change", keywords: ["package", "database", "artifact", "component", "note", "shape", "notation", "uml type"] },
      { value: "context_stub_addition", keywords: ["context", "external", "stub", "boundary"] },
      { value: "relation_aggregation", keywords: ["relation", "dependency", "edge", "aggregate", "bundle"] },
      { value: "view_refactor", keywords: ["view", "layout", "layer", "grouping", "split", "hierarchy"] },
    ],
    "view_refactor",
  );
}

function normalizeDocItem(raw: unknown): { name: string; type?: string; description?: string } | null {
  if (isRecord(raw)) {
    const name = readStringFromKeys(raw, ["name", "param", "parameter", "argument", "id", "label"]);
    if (!name) return null;
    const type = readStringFromKeys(raw, ["type", "datatype"]);
    const description = readStringFromKeys(raw, ["description", "desc", "details", "reason", "meaning"]);
    return {
      name,
      ...(type ? { type } : {}),
      ...(description ? { description } : {}),
    };
  }

  const text = readString(raw);
  if (!text) return null;

  const colonIndex = text.indexOf(":");
  const dashIndex = text.indexOf(" - ");
  if (colonIndex > 0) {
    const name = normalizeWhitespace(text.slice(0, colonIndex));
    const rest = normalizeWhitespace(text.slice(colonIndex + 1));
    if (!name) return null;
    const restDashIndex = rest.indexOf(" - ");
    const type = restDashIndex > 0 ? normalizeWhitespace(rest.slice(0, restDashIndex)) : undefined;
    const description = restDashIndex > 0 ? normalizeWhitespace(rest.slice(restDashIndex + 3)) : rest;
    return {
      name,
      ...(type ? { type } : {}),
      ...(description ? { description } : {}),
    };
  }

  if (dashIndex > 0) {
    const name = normalizeWhitespace(text.slice(0, dashIndex));
    const description = normalizeWhitespace(text.slice(dashIndex + 3));
    if (!name) return null;
    return { name, ...(description ? { description } : {}) };
  }

  return { name: text };
}

function normalizeStringArray(value: unknown): string[] {
  return toList(value)
    .map((entry) => readString(entry))
    .filter((entry): entry is string => !!entry);
}

export function parseStructuredResponse<T>(
  raw: unknown,
  parser: StructuredParser<T>,
  label: string,
  normalizer?: (value: unknown) => unknown,
  options: ParseStructuredResponseOptions = {},
): T {
  if (normalizer && options.alwaysNormalize) {
    const normalized = normalizer(raw);
    const normalizedParsed = parser.safeParse(normalized);
    if (normalizedParsed.success) {
      return normalizedParsed.data;
    }
    throw new Error(`${label} failed validation: ${normalizedParsed.error.message}`);
  }

  const direct = parser.safeParse(raw);
  if (direct.success) {
    return direct.data;
  }

  if (normalizer) {
    try {
      const normalized = normalizer(raw);
      const reparsed = parser.safeParse(normalized);
      if (reparsed.success) {
        console.warn(`[AI] ${label} returned a non-canonical payload. Normalization recovered the response.`);
        return reparsed.data;
      }
    } catch (error) {
      console.warn(
        `[AI] ${label} normalization failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  throw new Error(`${label} failed validation: ${direct.error.message}`);
}

export function normalizeSymbolDocPayload(raw: unknown): SymbolDoc {
  const record = isRecord(raw) ? raw : {};
  const summary = readStringFromKeys(record, ["summary", "description", "overview", "purpose"]);
  const inputs = readListFromKeys(record, ["inputs", "parameters", "args", "arguments"], ["name", "param"])
    .map(normalizeDocItem)
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const outputs = readListFromKeys(record, ["outputs", "returns", "returnValues", "result"], ["name", "label"])
    .map(normalizeDocItem)
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const sideEffects = normalizeStringArray(record.sideEffects ?? record.effects ?? record.side_effects);
  const calls = normalizeStringArray(record.calls ?? record.calledFunctions ?? record.dependencies);

  return {
    ...(summary ? { summary } : {}),
    ...(inputs.length > 0 ? { inputs } : {}),
    ...(outputs.length > 0 ? { outputs } : {}),
    ...(sideEffects.length > 0 ? { sideEffects } : {}),
    ...(calls.length > 0 ? { calls } : {}),
  };
}

export function normalizeAiSymbolEnrichmentPayload(raw: unknown, symbolId: string): AiSymbolEnrichmentResponse {
  const doc = normalizeSymbolDocPayload(raw);
  const record = isRecord(raw) ? raw : {};
  const confidence = normalizeConfidence(record.confidence);
  return {
    symbolId,
    ...doc,
    ...(confidence != null ? { confidence } : {}),
  };
}

export function normalizeDiagramImageReviewPayload(raw: unknown): DiagramImageReviewResponse {
  const record = isRecord(raw) ? raw : {};
  const issues = readListFromKeys(record, ["issues", "findings", "problems", "differences"], ["type", "message", "severity"])
    .map((entry) => {
      const source = isRecord(entry) ? entry : undefined;
      const message = source
        ? readStringFromKeys(source, ["message", "issue", "problem", "description", "title"])
        : readString(entry);
      if (!message) return null;
      const combinedText = source ? Object.values(source).map((value) => readString(value) ?? "").join(" ") : message;
      const suggestion = source
        ? readStringFromKeys(source, ["suggestion", "fix", "recommendation", "action"])
        : undefined;
      const confidence = normalizeConfidence(source?.confidence ?? source?.score);
      return {
        type: inferDiagramReviewIssueType(combinedText),
        severity: normalizeSeverity(source?.severity ?? source?.priority, combinedText),
        message,
        ...(suggestion ? { suggestion } : {}),
        ...(confidence != null ? { confidence } : {}),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const recommendedNodeTypes = readListFromKeys(
    record,
    ["recommendedNodeTypes", "nodeTypeSuggestions", "umlTypeSuggestions", "recommendedShapes"],
    ["targetLabel", "umlType", "type"],
  )
    .map((entry) => {
      const source = isRecord(entry) ? entry : undefined;
      const targetLabel = source
        ? readStringFromKeys(source, ["targetLabel", "target", "label", "node"])
        : undefined;
      const combinedText = source ? Object.values(source).map((value) => readString(value) ?? "").join(" ") : readString(entry) ?? "";
      if (!targetLabel && !combinedText) return null;
      return {
        targetLabel: targetLabel ?? combinedText,
        umlType: inferRecommendedNodeType(combinedText),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const summary = readStringFromKeys(record, ["summary", "overallAssessment", "assessment"])
    ?? summarizeFromMessages(issues.map((issue) => issue.message), "The diagram needs a UML readability review.");

  return {
    summary,
    issues,
    ...(recommendedNodeTypes.length > 0 ? { recommendedNodeTypes } : {}),
  };
}

export function normalizeDiagramImageComparePayload(raw: unknown): DiagramImageCompareResponse {
  const record = isRecord(raw) ? raw : {};
  const differences = readListFromKeys(record, ["differences", "issues", "findings"], ["category", "message", "suggestion"])
    .map((entry) => {
      const source = isRecord(entry) ? entry : undefined;
      const message = source
        ? readStringFromKeys(source, ["message", "issue", "problem", "description", "title"])
        : readString(entry);
      if (!message) return null;
      const combinedText = source ? Object.values(source).map((value) => readString(value) ?? "").join(" ") : message;
      const suggestion = source
        ? readStringFromKeys(source, ["suggestion", "fix", "recommendation", "action"])
        : undefined;
      return {
        category: inferDiagramCompareCategory(`${readString(source?.category) ?? ""} ${combinedText}`),
        message,
        ...(suggestion ? { suggestion } : {}),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  return {
    summary: readStringFromKeys(record, ["summary", "assessment"])
      ?? summarizeFromMessages(differences.map((difference) => difference.message), "The current diagram differs from the reference."),
    differences,
  };
}

export function normalizeDiagramImageSuggestionsPayload(raw: unknown): DiagramImageSuggestionsResponse {
  const record = isRecord(raw) ? raw : {};
  const suggestions = readListFromKeys(record, ["suggestions", "recommendations", "actions", "improvements"], ["type", "message", "target"])
    .map((entry) => {
      const source = isRecord(entry) ? entry : undefined;
      const message = source
        ? readStringFromKeys(source, ["message", "suggestion", "recommendation", "action", "description"])
        : readString(entry);
      if (!message) return null;
      const combinedText = source ? Object.values(source).map((value) => readString(value) ?? "").join(" ") : message;
      const target = source ? readStringFromKeys(source, ["target", "targetLabel", "label", "node"]) : undefined;
      const confidence = normalizeConfidence(source?.confidence ?? source?.score);
      return {
        type: inferDiagramSuggestionType(`${readString(source?.type) ?? ""} ${combinedText}`),
        ...(target ? { target } : {}),
        message,
        ...(confidence != null ? { confidence } : {}),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  return {
    summary: readStringFromKeys(record, ["summary", "assessment"])
      ?? summarizeFromMessages(suggestions.map((suggestion) => suggestion.message), "The diagram needs targeted UML improvements."),
    suggestions,
  };
}

export function normalizeUmlReferenceComparePayload(raw: unknown): UmlReferenceCompareResponse {
  const record = isRecord(raw) ? raw : {};
  const overall = isRecord(record.overallAssessment) ? record.overallAssessment : {};
  const differences = readListFromKeys(
    record,
    ["differences", "issues", "findings", "gaps"],
    ["category", "message", "severity", "suggestion"],
  )
    .map((entry) => {
      const source = isRecord(entry) ? entry : undefined;
      const message = source
        ? readStringFromKeys(source, ["message", "issue", "problem", "description", "title"])
        : readString(entry);
      if (!message) return null;
      const combinedText = source ? Object.values(source).map((value) => readString(value) ?? "").join(" ") : message;
      const category = inferUmlDifferenceCategory(`${readString(source?.category) ?? ""} ${combinedText}`);
      const suggestion = source
        ? readStringFromKeys(source, ["suggestion", "fix", "recommendation", "action", "resolution"])
        : undefined;
      const target = source ? readStringFromKeys(source, ["target", "targetLabel", "label", "element", "node", "area"]) : undefined;
      return {
        category,
        severity: normalizeSeverity(source?.severity ?? source?.priority ?? source?.confidence, combinedText),
        message,
        suggestion: suggestion ?? fallbackDifferenceSuggestion(category),
        ...(target ? { target } : {}),
        confidence: normalizeConfidence(source?.confidence ?? source?.score, 0.75) ?? 0.75,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const migrationSuggestions = readListFromKeys(
    record,
    ["migrationSuggestions", "migrations", "refactorSuggestions", "suggestions"],
    ["type", "message", "target"],
  )
    .map((entry) => {
      const source = isRecord(entry) ? entry : undefined;
      const message = source
        ? readStringFromKeys(source, ["message", "suggestion", "recommendation", "action", "description"])
        : readString(entry);
      if (!message) return null;
      const combinedText = source ? Object.values(source).map((value) => readString(value) ?? "").join(" ") : message;
      const target = source ? readStringFromKeys(source, ["target", "targetLabel", "label", "element", "node"]) : undefined;
      return {
        type: inferMigrationType(`${readString(source?.type) ?? ""} ${combinedText}`),
        ...(target ? { target } : {}),
        message,
        confidence: normalizeConfidence(source?.confidence ?? source?.score, 0.75) ?? 0.75,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const recommendedActions = readListFromKeys(
    record,
    ["recommendedActions", "actions", "nextSteps", "priorities"],
    ["priority", "action"],
  )
    .map((entry, index) => {
      const source = isRecord(entry) ? entry : undefined;
      const action = source
        ? readStringFromKeys(source, ["action", "message", "suggestion", "recommendation", "step"])
        : readString(entry);
      if (!action) return null;
      const priority = Math.max(1, Math.round(readNumber(source?.priority) ?? index + 1));
      return { priority, action };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const graphSuggestions = readListFromKeys(
    record,
    ["graphSuggestions", "graphChanges", "viewSuggestions"],
    ["type", "message", "targetIds"],
  )
    .map((entry) => {
      const source = isRecord(entry) ? entry : undefined;
      const message = source
        ? readStringFromKeys(source, ["message", "suggestion", "recommendation", "action", "description"])
        : readString(entry);
      if (!message) return null;
      const rawTargetIds = source?.targetIds;
      const targetIds = Array.isArray(rawTargetIds)
        ? rawTargetIds.map((value) => readString(value)).filter((value): value is string => !!value)
        : readString(rawTargetIds)?.split(",").map((value) => normalizeWhitespace(value)).filter((value) => value.length > 0);
      const combinedText = source ? Object.values(source).map((value) => readString(value) ?? "").join(" ") : message;
      return {
        type: inferGraphSuggestionType(`${readString(source?.type) ?? ""} ${combinedText}`),
        ...(targetIds && targetIds.length > 0 ? { targetIds } : {}),
        message,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const allContextText = [
    readString(record.summary),
    readString(overall.umlQualityDelta),
    readString(overall.mainProblem),
    ...differences.map((difference) => difference.message),
    ...migrationSuggestions.map((suggestion) => suggestion.message),
    ...recommendedActions.map((action) => action.action),
  ]
    .filter((entry): entry is string => !!entry)
    .join(" ");

  const tooUiLike = readBoolean(record.isCurrentDiagramTooUiLike)
    ?? /ui card|card style|generic card|too ui/i.test(allContextText);

  return {
    summary: readStringFromKeys(record, ["summary", "assessment", "overallSummary"])
      ?? summarizeFromMessages(differences.map((difference) => difference.message), "The reference diagram communicates the architecture more clearly."),
    overallAssessment: {
      umlQualityDelta: normalizeUmlQualityDelta(overall.umlQualityDelta, allContextText),
      mainProblem: inferUmlMainProblem(readString(overall.mainProblem) ?? allContextText),
    },
    differences,
    migrationSuggestions,
    recommendedActions,
    ...(graphSuggestions.length > 0 ? { graphSuggestions } : {}),
    ...(tooUiLike ? { isCurrentDiagramTooUiLike: true } : {}),
  };
}

export function normalizeAiExternalContextReviewPayload(
  raw: unknown,
  viewId: string,
  candidates: readonly NamedTarget[],
): AiExternalContextReviewResponse {
  const record = isRecord(raw) ? raw : {};
  const suggestedContextNodes = readListFromKeys(
    record,
    ["suggestedContextNodes", "contextNodes", "suggestions", "nodes"],
    ["label", "reason", "relatedSymbolIds"],
  )
    .map((entry) => {
      const source = isRecord(entry) ? entry : undefined;
      const combinedText = source ? Object.values(source).map((value) => readString(value) ?? "").join(" ") : readString(entry) ?? "";
      const relatedSymbolIds = Array.isArray(source?.relatedSymbolIds)
        ? source.relatedSymbolIds.map((value) => readString(value)).filter((value): value is string => !!value)
        : resolveTargetIdsFromText(candidates, combinedText);
      const label = source
        ? readStringFromKeys(source, ["label", "target", "name"])
        : undefined;
      const reason = source
        ? readStringFromKeys(source, ["reason", "message", "description", "suggestion"])
        : readString(entry);
      if ((!label && relatedSymbolIds.length === 0) || !reason) return null;
      return {
        label: label ?? candidates.find((candidate) => relatedSymbolIds.includes(candidate.id))?.label ?? "External Context",
        relatedSymbolIds,
        reason,
        confidence: normalizeConfidence(source?.confidence ?? source?.score, 0.7) ?? 0.7,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  return {
    viewId,
    suggestedContextNodes,
  };
}

export function normalizeAiLabelImprovementPayload(
  raw: unknown,
  viewId: string,
  targets: readonly NamedTarget[],
): AiLabelImprovementResponse {
  const record = isRecord(raw) ? raw : {};
  const improvements = readListFromKeys(
    record,
    ["improvements", "labels", "suggestions", "recommendations"],
    ["targetId", "newLabel", "oldLabel"],
  )
    .map((entry) => {
      const source = isRecord(entry) ? entry : undefined;
      const text = source ? Object.values(source).map((value) => readString(value) ?? "").join(" ") : readString(entry);
      if (!text) return null;

      const targetId = source
        ? readStringFromKeys(source, ["targetId", "id"])
          ?? resolveTargetId(targets, readStringFromKeys(source, ["target", "oldLabel", "label", "currentLabel"]))
        : undefined;
      const oldLabel = source
        ? readStringFromKeys(source, ["oldLabel", "currentLabel", "label"])
        : undefined;
      let newLabel = source
        ? readStringFromKeys(source, ["newLabel", "proposedLabel", "replacement", "to"])
        : undefined;

      if (!newLabel && typeof entry === "string") {
        const arrowMatch = entry.match(/(.+?)\s*(?:->|=>|→)\s*(.+)/);
        if (arrowMatch) {
          const hint = normalizeWhitespace(arrowMatch[1] ?? "");
          newLabel = normalizeWhitespace(arrowMatch[2] ?? "");
          const resolvedTargetId = resolveTargetId(targets, hint);
          if (resolvedTargetId) {
            return {
              targetId: resolvedTargetId,
              oldLabel: targets.find((target) => target.id === resolvedTargetId)?.label ?? hint,
              newLabel,
              reason: "Normalized from a string-based label suggestion.",
            };
          }
        }
      }

      if (!targetId || !newLabel) return null;
      const reason = source ? readStringFromKeys(source, ["reason", "message", "description"]) : undefined;
      const confidence = source ? normalizeConfidence(source.confidence ?? source.score) : undefined;
      return {
        targetId,
        oldLabel: oldLabel ?? targets.find((target) => target.id === targetId)?.label ?? "",
        newLabel,
        ...(reason ? { reason } : {}),
        ...(confidence != null ? { confidence } : {}),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  return {
    viewId,
    improvements,
  };
}
