# Vision Review

## Architektur

Die Vision-Analyse nutzt dieselbe AI-Routing- und Client-Architektur wie Text- und UML-Review-Calls:

1. Route unter `apps/server/src/routes/ai-vision.ts`
2. Service in `apps/server/src/ai/visionReview.ts`
3. Multimodaler Client in `apps/server/src/ai/client.ts`
4. Modellauflösung ueber `vision_review` im zentralen Routing

Es gibt kein separates Vision-System. Die Modellwahl laeuft ueber:

1. `UML_VISION_REVIEW_MODEL`
2. `UML_FALLBACK_MODEL`
3. globale Modelle (`OLLAMA_CLOUD_MODEL` / `OLLAMA_LOCAL_MODEL` / `OLLAMA_MODEL`)
4. interner Default

## Endpunkte

### `POST /api/ai/vision/review`

Reviewt ein einzelnes Diagrammbild.

### `POST /api/ai/vision/compare`

Vergleicht genau zwei Bilder: aktuelles Diagramm und Referenzdiagramm.

### `POST /api/ai/vision/compare-uml`

Spezialisierter Ist-vs-Soll-Vergleich fuer React-Flow-UML-Screenshots gegen Professor-/Referenzbilder. Der Workflow liefert UML-spezifische Unterschiede, priorisierte Migrationsvorschlaege und optional graphnahe Suggestions fuer einen bekannten `viewId`.

### `POST /api/ai/vision/compare-apply`

Fuehrt den kompletten reference-driven Autorefactor-Lauf aus:

1. Vision-Compare
2. Refactor-Plan
3. Validation
4. Auto-Apply
5. Snapshot fuer Undo

### `POST /api/ai/vision/suggestions`

Leitet aus einem oder mehreren Bildern strukturierte UML-Verbesserungen ab.

## Request-Format

```json
{
  "images": [
    {
      "label": "current_view",
      "mimeType": "image/png",
      "dataBase64": "iVBORw0KGgoAAA..."
    }
  ],
  "instruction": "Pruefe wissenschaftliche UML-Qualitaet.",
  "viewId": "view:root",
  "graphContext": {
    "course": "Software Architecture",
    "focus": "Package-level readability"
  }
}
```

### Unterstuetzte Bildtypen

- `image/png`
- `image/jpeg`
- `image/jpg`
- `image/webp`
- `image/gif`
- `image/bmp`

SVG wird aktuell nicht akzeptiert. Draw.io-Diagramme sollten vor dem Upload nach PNG/JPEG exportiert werden.

## Response-Formate

### Review

```json
{
  "summary": "The diagram is understandable but misses context packages.",
  "issues": [
    {
      "type": "missing_context",
      "severity": "medium",
      "message": "Important neighbors are not visible.",
      "suggestion": "Add package stubs for external collaborators.",
      "confidence": 0.83
    }
  ],
  "recommendedNodeTypes": [
    {
      "targetLabel": "MES",
      "umlType": "component"
    }
  ]
}
```

### Compare

```json
{
  "summary": "The current diagram omits one package and compresses relation visibility.",
  "differences": [
    {
      "category": "missing_element",
      "message": "The reference diagram shows an external analytics package that is missing.",
      "suggestion": "Add the analytics package as a context node."
    }
  ]
}
```

### UML Reference Compare

```json
{
  "summary": "The reference diagram is more UML-like and clearer in its layering.",
  "overallAssessment": {
    "umlQualityDelta": "better_reference",
    "mainProblem": "notation"
  },
  "differences": [
    {
      "category": "notation",
      "severity": "high",
      "message": "The current diagram reads like UI cards instead of packages and typed context nodes.",
      "suggestion": "Replace flat groups with UML packages and use typed database/component shapes.",
      "target": "Datenquellen",
      "confidence": 0.91
    }
  ],
  "migrationSuggestions": [
    {
      "type": "replace_group_with_package",
      "target": "Datenquellen",
      "message": "Promote the main group to package notation.",
      "confidence": 0.89
    }
  ],
  "recommendedActions": [
    {
      "priority": 1,
      "action": "Fix notation and node types before reworking relation density."
    }
  ],
  "graphSuggestions": [
    {
      "type": "node_type_change",
      "targetIds": ["sym:group:datenquellen"],
      "message": "Change the group node to a package-like node type."
    }
  ],
  "isCurrentDiagramTooUiLike": true
}
```

### Suggestions

```json
{
  "summary": "The diagram would benefit from clearer context and shape semantics.",
  "suggestions": [
    {
      "type": "add_context_stub",
      "target": "Analytics Service",
      "message": "Expose the external analytics dependency as a context stub.",
      "confidence": 0.79
    },
    {
      "type": "use_database_shape",
      "target": "MES / Produktions-DB",
      "message": "Use a database shape for storage systems.",
      "confidence": 0.76
    }
  ]
}
```

## Fehlerfaelle

- keine Bilder -> `400` mit klarer Fehlermeldung
- Compare mit nur einem Bild oder mehr als zwei Bildern -> `400`
- `compare-uml` mit `persistSuggestions=true`, aber ohne `viewId` oder geladenen Graph -> `400`
- nicht unterstuetzter MIME-Type -> `400`
- kaputtes Base64 -> `400`
- Modell ohne Vision-Capability -> klare Fehlermeldung mit Hinweis auf `UML_VISION_REVIEW_MODEL`
- Provider-/Chat-Fehler -> `502`

## Modellwahl

Vision-Endpunkte sollten auf ein multimodales Modell zeigen. Das Backend prueft vor dem Request per `/api/show`, ob das konfigurierte Modell die Capability `vision` meldet. Wenn nicht, wird kein stiller Fallback gebaut, sondern eine klare Fehlermeldung zur Modellkonfiguration geliefert.
