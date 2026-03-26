# UML AI Enrichment

## Ziel

Die bestehende AI-Routing-Infrastruktur wird jetzt aktiv fuer UML-Qualitaetsverbesserung genutzt. Statt nur allgemeiner AI-Endpunkte gibt es gezielte UML-Workflows fuer Symbol-Doku, Relations-Anreicherung, Struktur-Review, Label-Vorschlaege und externe Kontext-Empfehlungen.

## Neue UML-Use-Cases

| Use-Case | Task Type | Route |
| -------- | --------- | ----- |
| `uml_symbol_enrichment` | `code_analysis` | `POST /api/ai/uml/enrich-symbol`, `POST /api/ai/uml/enrich-view-symbols` |
| `uml_relation_enrichment` | `code_analysis` | `POST /api/ai/uml/suggest-missing-relations` |
| `relation_validation` | `relation_validation` | intern im Relation-Enrichment |
| `uml_structure_review` | `diagram_review` | `POST /api/ai/uml/review-view-structure` |
| `uml_external_context_review` | `diagram_review` | `POST /api/ai/uml/review-external-context` |
| `uml_label_improvement` | `labeling` | `POST /api/ai/uml/improve-view-labels` |
| `vision_diagram_review` | `vision_review` | vorbereitet ueber `callAiVisionJson()` |

## Strukturierte Response-Schemas

### Symbol Enrichment

```json
{
  "symbolId": "sym:...",
  "summary": "Kurzbeschreibung",
  "inputs": [{ "name": "arg", "type": "str", "description": "..." }],
  "outputs": [{ "name": "result", "type": "DataFrame", "description": "..." }],
  "confidence": 0.84
}
```

Schema: `AiSymbolEnrichmentResponseSchema`

### Relation Suggestions

```json
{
  "viewId": "view:...",
  "suggestions": [
    {
      "sourceId": "sym:a",
      "targetId": "sym:b",
      "relationType": "calls",
      "label": "calls",
      "rationale": "Function directly invokes helper_b()",
      "confidence": 0.78
    }
  ]
}
```

Schema: `AiRelationSuggestionsResponseSchema`

### Structure Review

```json
{
  "viewId": "view:...",
  "issues": [
    {
      "type": "sparse_view",
      "severity": "high",
      "message": "Very few internal relations are visible for the number of nodes.",
      "suggestedAction": "Add key dependencies or domain context before restructuring the view.",
      "targetIds": ["sym:a", "sym:b"]
    }
  ]
}
```

Schema: `AiStructureReviewResponseSchema`

### Label Improvement

```json
{
  "viewId": "view:...",
  "improvements": [
    {
      "targetId": "grp:data",
      "oldLabel": "Data Pipeline / Extraction / Raw Inputs",
      "newLabel": "Raw Data Intake",
      "reason": "Shorter and clearer domain label",
      "confidence": 0.73
    }
  ]
}
```

Schema: `AiLabelImprovementResponseSchema`

### External Context Review

```json
{
  "viewId": "view:...",
  "suggestedContextNodes": [
    {
      "label": "Database Access",
      "relatedSymbolIds": ["mod:db", "mod:cache"],
      "reason": "Several nodes depend on these external storage helpers.",
      "confidence": 0.81
    }
  ]
}
```

Schema: `AiExternalContextReviewResponseSchema`

## Graph-Integrationslogik

### Direkt aktiv

- Symbol Enrichment schreibt fehlende `summary`, `inputs` und `outputs` direkt in `symbol.doc`.
- Neue/enrichte Felder werden in `symbol.doc.aiGenerated` markiert.
- Relation Enrichment fuehrt Discovery und Validation getrennt aus und schreibt nur validierte Relationen als `aiGenerated` in den Graph.

### Review-/Suggestion-only

- Structure Review schreibt keine automatischen Umbauten. Die Issues werden in `view.reviewHints` abgelegt.
- External Context Review schreibt keine Stub-Knoten. Die Vorschlaege werden in `view.contextSuggestions` gespeichert.
- Label Improvement schreibt keine Labels direkt um. Die Vorschlaege werden in `view.labelSuggestions` gespeichert.

## Sparse-View-Heuristik

Der Server erkennt problematische Views auch ohne AI vorab. Aktuelle Signale:

- sehr wenige interne Relationen im Verhaeltnis zur Node-Anzahl
- hoher Anteil isolierter Nodes
- deutlich mehr externe als interne Abhaengigkeiten
- stark vertikale, listenartige Node-Anordnung

Diese Heuristik erzeugt:

- `sparse`-Flag pro View
- `reasons` fuer die erkannte Schwaeche
- `applicableUseCases`, die fuer diese View sinnvoll sind

Der Debug-Endpoint `GET /api/ai/uml/view-opportunities` liefert diese Sicht inklusive aufgeloester Modelle.

## Task Routing / Modellwahl

- `uml_symbol_enrichment` -> `code_analysis`
- `uml_relation_enrichment` -> `code_analysis`
- interne Relationsvalidierung -> `relation_validation`
- `uml_structure_review` -> `diagram_review`
- `uml_external_context_review` -> `diagram_review`
- `uml_label_improvement` -> `labeling`
- Vision-Pfad -> `vision_review`

Die konkrete Modellwahl erfolgt weiterhin zentral ueber `resolveModelForTask()` und die `.env`-Konfiguration.
