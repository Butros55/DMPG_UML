import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Relation, Symbol } from "@dmpg/shared";
import {
  mergePyreverseModelIntoGraph,
  parsePyreverseDot,
  parsePyreversePuml,
  scanPyreverse,
} from "./pyreverse.js";

function symbol(id: string, label: string, kind: Symbol["kind"], parentId?: string): Symbol {
  return { id, label, kind, parentId };
}

test("parsePyreversePuml extracts classes, members and UML relations", () => {
  const model = parsePyreversePuml(`
@startuml
class Animal {
  # id : int
  + makeNoise()
}
class Goose {
  + layEgg() : Egg
}
class Farm
class Room
Animal <|-- Goose
Farm "1" o-- "0..*" Goose : owns
Farm *-- Room : rooms
Goose ..> Egg : hatch
@enduml
`);

  assert.equal(model.classes.length, 4);
  const animal = model.classes.find((entry) => entry.name === "Animal");
  assert.equal(animal?.attributes[0]?.name, "id");
  assert.equal(animal?.methods[0]?.name, "makeNoise");

  assert.deepEqual(
    model.relations.map((relation) => [
      relation.sourceName,
      relation.targetName,
      relation.type,
      relation.targetMultiplicity,
      relation.targetRole,
    ]),
    [
      ["Goose", "Animal", "inherits", undefined, undefined],
      ["Farm", "Goose", "aggregation", "0..*", "owns"],
      ["Farm", "Room", "composition", undefined, "rooms"],
      ["Goose", "Egg", "dependency", undefined, undefined],
    ],
  );
});

test("parsePyreverseDot maps DOT arrows to UML relation types", () => {
  const model = parsePyreverseDot(`
digraph "classes" {
  Animal [label="{Animal|+ id : int\\l|+ makeNoise()\\l}"];
  Goose [label="{Goose||+ makeNoise()\\l}"];
  Farm [label="{Farm||}"];
  Room [label="{Room||}"];
  Goose -> Animal [arrowhead="empty"];
  Farm -> Room [arrowtail="odiamond", label="rooms"];
  Goose -> Farm [style="dashed"];
}
`);

  assert.equal(model.classes.find((entry) => entry.name === "Animal")?.attributes[0]?.name, "id");
  assert.deepEqual(
    model.relations.map((relation) => [relation.sourceName, relation.targetName, relation.type, relation.label]),
    [
      ["Goose", "Animal", "inherits", undefined],
      ["Farm", "Room", "aggregation", "rooms"],
      ["Goose", "Farm", "dependency", undefined],
    ],
  );
});

test("mergePyreverseModelIntoGraph dedupes scanner relations and adds missing members", () => {
  const symbols: Symbol[] = [
    symbol("mod:farm", "farm", "module"),
    symbol("mod:farm:Animal", "Animal", "class", "mod:farm"),
    symbol("mod:farm:Goose", "Goose", "class", "mod:farm"),
    symbol("mod:farm:Farm", "Farm", "class", "mod:farm"),
    symbol("mod:farm:Room", "Room", "class", "mod:farm"),
  ];
  const relations: Relation[] = [
    {
      id: "scan-e0",
      type: "inherits",
      source: "mod:farm:Goose",
      target: "mod:farm:Animal",
      confidence: 1,
    },
  ];

  const model = parsePyreversePuml(`
class Animal {
  + id : int
  + makeNoise()
}
class Goose
class Farm
class Room
Animal <|-- Goose
Farm "1" o-- "0..*" Goose : owns
Farm *-- Room : rooms
`);

  const stats = mergePyreverseModelIntoGraph({ symbols, relations }, model);

  assert.equal(stats.relationsAdded, 2);
  assert.equal(relations.filter((relation) => relation.type === "inherits").length, 1);
  assert.ok(symbols.some((entry) => entry.id === "mod:farm:Animal.id" && entry.kind === "variable"));
  assert.ok(symbols.some((entry) => entry.id === "mod:farm:Animal.makeNoise" && entry.kind === "method"));

  const aggregation = relations.find((relation) => relation.type === "aggregation");
  assert.equal(aggregation?.source, "mod:farm:Farm");
  assert.equal(aggregation?.target, "mod:farm:Goose");
  assert.equal(aggregation?.targetMultiplicity, "0..*");
  assert.equal(aggregation?.targetRole, "owns");
});

test("scanPyreverse reports AST fallback warning when Pyreverse is unavailable", async () => {
  const previousPath = process.env.PATH;
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "dmpg-pyreverse-missing-"));

  try {
    fs.writeFileSync(path.join(projectDir, "sample.py"), "class Sample:\n    pass\n", "utf-8");
    process.env.PATH = "";

    const model = await scanPyreverse(projectDir);

    assert.equal(model.classes.length, 0);
    assert.match(model.warnings.join("\n"), /Pyreverse unavailable; AST fallback active/i);
  } finally {
    if (previousPath == null) delete process.env.PATH;
    else process.env.PATH = previousPath;
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
