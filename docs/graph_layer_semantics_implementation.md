# Graph Layer Semantics

This note documents the current semantic contract for the graph before deeper UI work.

## Layers

- Layer 1 (`processOverview`): process packages, normalized input sources, and grouped output artifacts.
- Layer 2 (`classDiagram`): classes and module containers that belong to one process package.
- Layer 3 (`methodDetail`): class-owned method detail views. The final sequence diagram is still deferred.
- `internal`: technical views kept for layout/back-compat, not part of the user-facing layer model.

Standalone function-only graphs are intentionally not part of the public drill-down flow for now.

## Semantic node types

- `processPackage`: layer-1 package nodes that drill into a class-diagram stage view.
- `classNode`: class nodes that drill into method detail.
- `methodNode`: method nodes shown in layer 3.
- `groupedArtifact`: user-facing artifact groups such as Arrival Table or Generated Simulation Data.
- `externalSource`: normalized layer-1 source nodes such as database import or file ingest.
- `rawArtifact`: low-level file/artifact symbol kept for internal overlays only.
- `internalContainer`, `internalModule`, `internalFunction`: technical nodes/views used to preserve scan structure without exposing them as semantic layers.

Each node is assigned one semantic purpose. User-facing drill-down is restricted to:

- `processPackage` -> `classDiagram`
- `classNode` -> `methodDetail`

Grouped artifacts and external sources are non-drillable.

## Process overview normalization

- The old generic `Artifacts / Outputs` package is no longer part of the visible layer-1 flow.
- Layer 1 shows grouped outputs directly, with edges from the producing process package.
- "Persistence" is renamed to "Generated Simulation Data" where that label referred to generated simulation output.
- "Input Sources" is the normalized label for the incoming source cluster in layer 1.

## Arrival Table ownership

- "Arrival Table" is treated as a grouped artifact produced by the simulation stage.
- Its implementation node (`mod:arrival_table.generate_arrival_table`) lives in the simulation class-diagram stage, not in a standalone output package.
- Layer 1 does not drill from "Arrival Table" into that implementation node.
