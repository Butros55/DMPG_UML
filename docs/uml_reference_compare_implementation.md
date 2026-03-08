# UML Reference Compare Implementation

## Ziel des Workflows

Der spezialisierte Workflow `uml_reference_compare` erweitert die bestehende Vision-Pipeline fuer den Hauptfall:

- aktueller React-Flow-UML-View als IST
- Professor-Bild, Referenzdiagramm oder Draw.io-Export als SOLL

Die Analyse bleibt im bestehenden Routing auf `vision_review`, erzeugt aber ein spezifischeres Compare-Format fuer UML-Verbesserungen.

## Angepasste Dateien

- `packages/shared/src/schemas.ts`
- `apps/server/src/ai/useCases.ts`
- `apps/server/src/ai/useCases.test.ts`
- `apps/server/src/ai/visionReview.ts`
- `apps/server/src/ai/visionReview.test.ts`
- `apps/server/src/routes/ai-vision.ts`
- `apps/web/src/api.ts`
- `README.md`
- `docs/vision_review.md`
- `docs/vision_review_implementation.md`
- `docs/ai_task_routing_integration.md`
- `docs/uml_reference_compare.md`

## Neues Compare-Format

Der Workflow verwendet `UmlReferenceCompareResponseSchema` mit:

- `summary`
- `overallAssessment`
- `differences`
- `migrationSuggestions`
- `recommendedActions`
- `graphSuggestions`
- `isCurrentDiagramTooUiLike`

Damit ist die Response nicht nur beschreibend, sondern direkt fuer spaetere Review- oder Refactoring-Schritte nutzbar.

## Einbindung in die Vision-Pipeline

1. `apps/server/src/routes/ai-vision.ts`
   - neuer Endpoint `POST /api/ai/vision/compare-uml`
2. `apps/server/src/ai/useCases.ts`
   - neuer Use-Case `uml_reference_compare`
3. `apps/server/src/ai/visionReview.ts`
   - neue Service-Funktion `compareUmlReferenceImages()`
   - optionales Mapping auf `view.reviewHints` ueber `persistUmlReferenceCompareReview()`
4. `apps/server/src/ai/client.ts`
   - unveraendert zentrale multimodale Transport-Schicht
5. Routing
   - `uml_reference_compare` -> `vision_review`
   - Modellauflosung weiter ueber `UML_VISION_REVIEW_MODEL`, `UML_FALLBACK_MODEL`, globale Modelle

## Professor-/Referenzbild-Optimierung

Der Prompt ist jetzt explizit auf diese Fragen optimiert:

- wirkt das aktuelle Diagramm wie UI-Karten statt wie UML
- fehlen Package-, Database-, Artifact-, Component- oder Note-Shapes
- ist das Layering zu flach oder unklar
- fehlen sichtbare Relationen oder externe Kontext-Stubs
- welche konkreten Schritte bringen das IST naeher an das SOLL

## Persistenzverhalten

- keine automatische Mutation von Nodes, Gruppen oder Relationen
- optionales `persistSuggestions=true`
- schreibt nur reviewbare Hinweise in `view.reviewHints`
- dadurch bleibt der Workflow sicher und spaeter weiterverwendbar

## Geeignete Modelle

Der Workflow hartcodiert keine Modellnamen. Er erwartet ein vision-faehiges Modell hinter:

1. `UML_VISION_REVIEW_MODEL`
2. `UML_FALLBACK_MODEL`
3. globalem Modell

Geeignet sind multimodale Modelle, die in Ollama die Capability `vision` melden.

## Noch offen

- kein eigenes Frontend-Upload-Panel; aktuell nur API-Helper in `apps/web/src/api.ts`
- `graphSuggestions` werden noch nicht automatisch in eigene Persistenzstrukturen uebernommen
- SVG bleibt weiterhin ausgeschlossen; fuer Draw.io sollte PNG/JPEG verwendet werden
