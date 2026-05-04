import test from "node:test";
import assert from "node:assert/strict";
import type { Relation, Symbol as Sym } from "@dmpg/shared";
import {
  isUmlClassifierSymbol,
  toClassProjectionRelation,
} from "./classDiagramProjection";

function symbol(kind: Sym["kind"]): Sym {
  return { id: kind, label: kind, kind };
}

function relation(type: Relation["type"]): Relation {
  return { id: type, type, source: "a", target: "b" };
}

test("isUmlClassifierSymbol accepts classes, interfaces and modules only", () => {
  assert.equal(isUmlClassifierSymbol(symbol("class")), true);
  assert.equal(isUmlClassifierSymbol(symbol("interface")), true);
  assert.equal(isUmlClassifierSymbol(symbol("module")), true);
  assert.equal(isUmlClassifierSymbol(symbol("group")), false);
  assert.equal(isUmlClassifierSymbol(symbol("external")), false);
});

test("toClassProjectionRelation maps Python calls and imports to UML dependencies", () => {
  assert.equal(toClassProjectionRelation(relation("inherits"))?.type, "inherits");
  assert.deepEqual(
    {
      type: toClassProjectionRelation(relation("calls"))?.type,
      label: toClassProjectionRelation(relation("calls"))?.label,
    },
    { type: "dependency", label: "calls" },
  );
  assert.deepEqual(
    {
      type: toClassProjectionRelation(relation("imports"))?.type,
      label: toClassProjectionRelation(relation("imports"))?.label,
    },
    { type: "dependency", label: "imports" },
  );
  assert.equal(toClassProjectionRelation(relation("reads")), null);
});
