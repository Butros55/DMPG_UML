# Reference-Driven UML Autorefactor Implementation

## Angepasste Dateien

### Server

- `apps/server/src/ai/referenceAutorefactor.ts`
- `apps/server/src/routes/ai-vision.ts`
- `apps/server/src/ai/referenceAutorefactor.test.ts`
- `apps/server/src/ai/useCases.test.ts`
- `apps/server/src/store.ts`

### Frontend

- `apps/web/src/api.ts`
- `apps/web/src/referenceAutorefactor.ts`
- `apps/web/src/referenceAutorefactor.test.ts`
- `apps/web/src/components/ReferenceAutorefactorDialog.tsx`
- `apps/web/src/components/ReviewHintsPanel.tsx`
- `apps/web/src/components/Canvas.tsx`
- `apps/web/src/components/UmlNode.tsx`
- `apps/web/src/styles/global.css`

### Shared / Doku

- `packages/shared/src/schemas.ts`
- `README.md`
- `docs/reference_driven_uml_autorefactor.md`

## Technischer Ablauf

### 1. Compare

`runReferenceDrivenUmlAutorefactor()` startet mit `compareUmlReferenceImages()`:

- Bild 1 = aktueller React-Flow-View
- Bild 2 = Referenzbild
- Task = `vision_review`

Das Ergebnis ist der bestehende UML-Compare mit `differences`, `migrationSuggestions`, `recommendedActions` und optionalen `graphSuggestions`.

### 2. Plan

Danach erzeugt `generateReferenceRefactorPlan()` einen maschinenanwendbaren Plan:

- Input: Compare-Ergebnis, View-Kontext, Graph, Optionen
- Task = `diagram_review`
- Output: `UmlReferenceRefactorPlan`

Wenn der AI-Plan nicht parsebar oder unbrauchbar ist, erzeugt `deriveFallbackRefactorPlan()` einen lokalen Fallback-Plan aus den Compare-Migration-Suggestions.

### 3. Validation

`validateReferenceRefactorPlan()` kombiniert:

- lokale Guard-Rules
- optionale Strukturpruefung
- optionale Relationsvalidierung

Ergebnis ist pro Aktion eine Entscheidung:

- `apply`
- `review_only`
- `skip`

### 4. Apply

`applyReferenceRefactorPlan()` schreibt sichere Aktionen in einen geklonten Graph:

- UML-Typ setzen
- Labels/Titel umbenennen
- Kontext-/Artifact-/Database-/Component-/Note-Nodes anlegen
- Views anlegen oder Scope aendern
- Relationen anfuegen
- Layout fuer betroffene Views invalidieren

Unsichere oder nicht unterstuetzte Schritte werden als `reviewOnlyActions` oder `skippedActions` zurueckgegeben.

### 5. Snapshot + Undo

Vor dem Apply erstellt `createGraphSnapshot()` einen serverseitigen Snapshot.

- `undoInfo.snapshotId` geht an das Frontend
- `POST /api/ai/vision/compare-apply/undo` ruft `undoReferenceDrivenUmlAutorefactor()` auf
- der Graph wird aus dem Snapshot wiederhergestellt

## UI-Workflow

Der Workflow sitzt im Review-Tab:

1. `Mit Referenz anpassen`
2. `ReferenceAutorefactorDialog` oeffnet
3. Referenzbild waehlen
4. Frontend exportiert die aktuelle View via `html-to-image`
5. Request geht an `/api/ai/vision/compare-apply`
6. Rueckgabe-Graph ersetzt den aktuellen Graph
7. `highlightTargetIds` werden ueber die bestehende Review-Highlight-Mechanik aktiviert
8. eine Ergebnis-/Undo-Karte bleibt im Review-Panel sichtbar

## Automatisch angewendete Aenderungen

Aktuell direkt auto-applied:

- `set_uml_type`
- `rename_symbol`
- `rename_view`
- `add_context_stub`
- `add_note`
- `add_artifact`
- `add_database_node`
- `add_component_node`
- `add_relation`
- `move_symbol`
- `reassign_parent`
- `create_view`
- `change_view_scope`
- `rerun_layout`

Aktuell bewusst nicht blind auto-applied:

- `split_group`
- `merge_group`
- `rebuild_view`
- `remove_relation`
- `aggregate_relations`

## Fokus und Highlight

Die Response liefert:

- `changedTargetIds`
- `highlightTargetIds`
- `primaryFocusTargetIds`
- `focusViewId`

Das Frontend speist diese Felder direkt in `activateReviewHighlight()` ein. Dadurch werden:

- die beste Ziel-View geoeffnet
- mehrere Zielknoten gemeinsam fokussiert
- ein primaerer Knoten im Inspector ausgewaehlt
- geaenderte Stellen visuell von normaler Selection getrennt markiert

## Noch offen

- komplexe, view-uebergreifende Refactors koennen nur als Review-Hinweis landen
- es gibt noch keinen separaten Fortschritts-Stream fuer die Phasen Compare/Plan/Validate/Apply
- der View-Export basiert auf dem sichtbaren React-Flow-Canvas, nicht auf einem eigenen Print-Renderer
