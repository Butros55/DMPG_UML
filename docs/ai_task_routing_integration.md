# AI Task Routing Integration

## Ziel

Die AI-Endpunkte verwenden das zentrale Model-Routing jetzt nicht nur implizit, sondern mit expliziten Task-Typen pro Use-Case. Endpoints geben nur den fachlichen Kontext vor; die Modellwahl bleibt in der AI-Service-Schicht gekapselt.

## Gefundene AI-Use-Cases

| Use-Case | Route/Phase | Task Type |
| -------- | ----------- | --------- |
| Symbol-Zusammenfassung | `POST /api/ai/summarize` | `code_analysis` |
| Batch-Zusammenfassung | `POST /api/ai/batch-summarize` | `code_analysis` |
| Label-Bereinigung | Analysephase `labels` | `labeling` |
| Dokumentationsgenerierung | Analysephase `docs` | `code_analysis` |
| Relations-Discovery | Analysephase `relations` | `code_analysis` |
| Relations-Validierung | Analysephase `relations` | `relation_validation` |
| Dead-Code-Pruefung | Analysephase `dead-code` | `code_analysis` |
| Struktur-/Diagramm-Review | Analysephase `structure` | `diagram_review` |
| Vision-/Screenshot-Review | `POST /api/ai/vision/review`, `POST /api/ai/vision/compare`, `POST /api/ai/vision/compare-uml`, `POST /api/ai/vision/suggestions` | `vision_review` |

### Zusaetzliche UML-Enrichment-Use-Cases

| Use-Case | Route | Task Type |
| -------- | ----- | --------- |
| UML Symbol Enrichment | `POST /api/ai/uml/enrich-symbol`, `POST /api/ai/uml/enrich-view-symbols` | `code_analysis` |
| UML Relation Enrichment | `POST /api/ai/uml/suggest-missing-relations` | `code_analysis` + `relation_validation` |
| UML Structure Review | `POST /api/ai/uml/review-view-structure` | `diagram_review` |
| UML External Context Review | `POST /api/ai/uml/review-external-context` | `diagram_review` |
| UML Label Improvement | `POST /api/ai/uml/improve-view-labels` | `labeling` |
| Diagram Image Review | `POST /api/ai/vision/review` | `vision_review` |
| Diagram Image Compare | `POST /api/ai/vision/compare` | `vision_review` |
| UML Reference Compare | `POST /api/ai/vision/compare-uml` | `vision_review` |
| Diagram Image to Suggestions | `POST /api/ai/vision/suggestions` | `vision_review` |

## Routing-Logik

1. Call-Site waehlt einen zentral definierten Use-Case aus `apps/server/src/ai/useCases.ts`.
2. Der Use-Case wird auf einen `AiTaskType` gemappt.
3. `callAiJson()` normalisiert fehlende Tasks auf `general`.
4. `resolveModelForTask()` waehlt das Modell ueber Task-spezifische Konfiguration, `UML_FALLBACK_MODEL`, globale Modelle oder den eingebauten Default.

## Angepasste Dateien

- `apps/server/src/ai/taskTypes.ts`
- `apps/server/src/ai/client.ts`
- `apps/server/src/ai/useCases.ts`
- `apps/server/src/ai/useCases.test.ts`
- `apps/server/src/routes/ai.ts`
- `apps/server/src/index.ts`
- `README.md`

## Wichtige Integrationsdetails

- Die Relationsphase ist jetzt logisch getrennt:
  - Discovery (`code_analysis`) extrahiert Kandidaten aus Code.
  - Validation (`relation_validation`) filtert und bestaetigt diese Kandidaten vor dem Schreiben in den Graphen.
- Wenn ein Task nicht gesetzt wird, landet er kontrolliert bei `general`.
- Wenn die Relations-Validierung fehlschlaegt oder ein ungültiges Payload liefert, bleiben die entdeckten Kandidaten als kompatibler Fallback erhalten.
- Vision-Routing laeuft jetzt produktiv ueber echte multimodale Requests in `callAiVisionJson()`.
- Der spezialisierte Use-Case `uml_reference_compare` bleibt beim gleichen Task-Typ `vision_review`, schiebt aber UML-spezifisches Prompting und ein migrationsorientiertes Response-Format in dieselbe Pipeline.

## Wie neue Entwickler neue AI-Tasks anbinden

1. In `apps/server/src/ai/useCases.ts` einen neuen Use-Case definieren oder einen vorhandenen wiederverwenden.
2. Den passenden `AiTaskType` zuordnen, statt im Endpoint ein Modell oder eine Env-Variable auszuwerten.
3. In der Route oder Service-Funktion `callAiJson({ taskType: getTaskTypeForUseCase(...) })` verwenden.
4. Falls der Use-Case Bilder verarbeitet, `vision_review` und `callAiVisionJson()` nutzen.
5. README oder Doku aktualisieren, wenn ein neuer fachlicher AI-Workflow hinzukommt.
