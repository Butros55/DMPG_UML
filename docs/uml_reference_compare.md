# UML Reference Compare

## Ziel

`POST /api/ai/vision/compare-uml` ist der spezialisierte Ist-vs-Soll-Workflow fuer den Hauptanwendungsfall in DMPG_UML:

- Bild A: aktueller React-Flow-Screenshot eines UML-Views
- Bild B: Referenzdiagramm, Professor-Beispiel oder Draw.io-Export

Der Workflow liefert keinen generischen Bildvergleich, sondern umsetzbare UML-Verbesserungsvorschlaege fuer:

- Notation und Shapes
- Layering und View-Schnitt
- Relation-Sichtbarkeit und Kontext
- Benennung und fachliche Klarheit

## Unterschied zum normalen Vision Review

- `POST /api/ai/vision/review`
  - bewertet ein einzelnes Diagrammbild
  - gut fuer allgemeine UML-Qualitaet
- `POST /api/ai/vision/compare`
  - generischer visueller Vergleich von zwei Diagrammen
  - gut fuer grobe Unterschiede
- `POST /api/ai/vision/compare-uml`
  - UML-spezifischer Ist-vs-Soll-Vergleich
  - optimiert fuer React-Flow-Ansicht vs. Referenzbild
  - liefert priorisierte Migrationsvorschlaege und optionale graphnahe Suggestions
- `POST /api/ai/vision/compare-apply`
  - verwendet denselben Compare-Kern
  - erzeugt daraus aber direkt einen validierten Refactor-Plan und wendet sichere Schritte automatisch an
  - liefert Undo-Informationen und Highlight-Ziele fuer das Frontend

## Request-Format

```json
{
  "images": [
    {
      "label": "current_view",
      "mimeType": "image/png",
      "dataBase64": "iVBORw0KGgoAAA..."
    },
    {
      "label": "professor_reference",
      "mimeType": "image/png",
      "dataBase64": "iVBORw0KGgoAAA..."
    }
  ],
  "instruction": "Vergleiche mein aktuelles Layer-1 mit dem Professor-Bild und leite UML-Verbesserungen ab.",
  "viewId": "view:root",
  "graphContext": {
    "focus": "wissenschaftliche UML-Darstellung",
    "targetLayer": "Layer-1"
  },
  "persistSuggestions": true
}
```

### Wichtige Request-Regeln

- Es muessen genau zwei Bilder gesendet werden.
- Bilder werden als Base64 plus `mimeType` gesendet.
- `viewId` ist optional, aber empfohlen, wenn du graphnahe Suggestions willst.
- `persistSuggestions` speichert keine Graph-Mutationen, sondern nur reviewbare Hinweise in `view.reviewHints`.

## Response-Format

```json
{
  "summary": "The reference diagram communicates the architecture more scientifically than the current view.",
  "overallAssessment": {
    "umlQualityDelta": "better_reference",
    "mainProblem": "notation"
  },
  "differences": [
    {
      "category": "notation",
      "severity": "high",
      "message": "The current view looks like UI cards instead of UML packages and typed context nodes.",
      "suggestion": "Replace the major groups with UML packages and use database/component shapes where appropriate.",
      "target": "Datenquellen",
      "confidence": 0.92
    }
  ],
  "migrationSuggestions": [
    {
      "type": "replace_group_with_package",
      "target": "Datenquellen",
      "message": "Promote the domain group to a package.",
      "confidence": 0.9
    },
    {
      "type": "add_context_stub",
      "target": "MES",
      "message": "Expose MES as an explicit external context stub.",
      "confidence": 0.84
    }
  ],
  "recommendedActions": [
    {
      "priority": 1,
      "action": "Fix package and node-type notation before refining labels."
    },
    {
      "priority": 2,
      "action": "Add context stubs and aggregate the important cross-layer relations."
    }
  ],
  "graphSuggestions": [
    {
      "type": "node_type_change",
      "targetIds": ["sym:group:datenquellen"],
      "message": "Change the main group to a package-like node type."
    }
  ],
  "isCurrentDiagramTooUiLike": true
}
```

## Typische Anwendungsfaelle

### Aktueller View vs. Professor-Bild

- Ziel: erkennen, ob dein Diagramm noch zu sehr wie UI-Karten wirkt
- typischer Output: `replace_group_with_package`, `add_context_stub`, `use_database_shape`

### Aktueller View vs. Draw.io-Skizze

- Ziel: die semantische Zielstruktur einer Skizze in konkrete UML-Schritte uebersetzen
- typischer Output: `split_view`, `aggregate_relations`, `rename_group`

### Layer-1 vs. gewuenschtes Prozessdiagramm

- Ziel: pruefen, ob ein echter Top-Level-Fluss sichtbar ist
- typischer Output: `mainProblem: layering`, fehlende Kontextknoten, zu schwache Relation-Sichtbarkeit

## Ableitung konkreter UML-Verbesserungen

- `notation`
  - pruefe Package-, Component-, Database-, Artifact- und Note-Shapes
- `context`
  - fuege externe Systeme als sichtbare Kontext-Stubs hinzu
- `relation_visibility`
  - mache zentrale Abhaengigkeiten sichtbar oder aggregiere wiederholte Kanten
- `layering`
  - trenne zu breite Views in zwei Ebenen oder schaffe eine klarere Layer-1-Sicht

## Fehlerfaelle

- weniger oder mehr als zwei Bilder -> `400`
- ungueltiger MIME-Type oder kaputtes Base64 -> `400`
- `persistSuggestions=true` ohne geladenen Graph oder `viewId` -> `400`
- Modell ohne Vision-Capability -> `400` mit klarer Modellhinweis-Meldung
- Provider- oder Chat-Fehler -> `502`
