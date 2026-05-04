import type { Relation, RelationType, Symbol as Sym } from "@dmpg/shared";
import { RELATION_VERBS } from "./diagramSettings";

export const UML_CLASS_PROJECTION_RELATION_TYPES = new Set<RelationType>([
  "inherits",
  "realizes",
  "dependency",
  "association",
  "aggregation",
  "composition",
  "instantiates",
]);

export const UML_CLASS_DEPENDENCY_SOURCE_TYPES = new Set<RelationType>([
  "imports",
  "calls",
  "uses_config",
]);

export function isUmlClassifierSymbol(symbol: Sym | undefined): boolean {
  return symbol?.kind === "class" || symbol?.kind === "interface" || symbol?.kind === "module";
}

export function toClassProjectionRelation(relation: Relation): Relation | null {
  if (UML_CLASS_PROJECTION_RELATION_TYPES.has(relation.type)) return relation;
  if (!UML_CLASS_DEPENDENCY_SOURCE_TYPES.has(relation.type)) return null;

  return {
    ...relation,
    type: "dependency",
    label: relation.label ?? RELATION_VERBS[relation.type] ?? relation.type,
  };
}
