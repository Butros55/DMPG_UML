# DMPG UML Editor

Interaktiver Multi-Level-UML/Architektur-Editor mit KI-gestützter Dokumentationsgenerierung.

## Features

- **Canvas-Editor**: Zoom, Pan, Drag & Drop von UML-Nodes, Edge-Connecting über Handles
- **Multi-Level Views**: Level-0 Overview → Drilldown in Child-Views → Breadcrumb-Navigation
- **Inspector Panel**: Funktionskarten mit Summary, Inputs/Outputs, Side Effects, Calls, Wiki-Links
- **Code Scanner**: Automatische Analyse von Python-Projekten (Module, Klassen, Funktionen, Imports, Calls)
- **Auto-Layout**: Automatisches Layout via elkjs
- **KI-Anbindung**: Konfigurierbares Ollama-/AI-Setup mit optionalem Task-basiertem Model-Routing
- **Demo-Graph**: Sofort nutzbar ohne Projekt-Scan

## Architektur

```
apps/
  server/     – Express API (Scan, Graph, AI)
  web/        – React + Vite + React Flow (Canvas, Sidebar, Inspector)
packages/
  shared/     – Zod Schemas & TypeScript Types
```

## Setup

### Voraussetzungen

- Node.js ≥ 18
- pnpm (`npm install -g pnpm`)
- Python 3.x (für Code-Scanner)

### Installation

```bash
pnpm install
```

`pnpm install` baut `@dmpg/shared` automatisch mit, damit die Workspace-Exports aktuell sind.

### Entwicklung starten

```bash
pnpm dev
```

Das baut `@dmpg/shared` initial, startet danach den Shared-Watch-Compiler sowie Server (Port 3001) und Web-UI (Port 5173) parallel.

### Einzelne Apps

```bash
pnpm --filter @dmpg/server dev   # nur Server
pnpm --filter @dmpg/web dev      # nur Frontend
```

### Build

```bash
pnpm build
```

### Type-Check

```bash
pnpm typecheck
```

## Konfiguration

Erstelle `apps/server/.env` (Vorlage: `.env.example`):

| Variable          | Default              | Beschreibung                  |
| ----------------- | -------------------- | ----------------------------- |
| `OLLAMA_BASE_URL` | `https://ollama.com` | Ollama API Base URL           |
| `OLLAMA_API_KEY`  | (leer)               | Ollama API Key (Bearer Token) |
| `OLLAMA_MODEL`    | `llama3.1:8b`        | Ollama Modell                 |
| `PORT`            | `3001`               | Server-Port                   |

## AI Model Routing

Das Backend kann AI-Tasks entweder weiter ueber ein einzelnes globales Modell ausfuehren oder task-spezifisch auf mehrere Modelle routen.

- `AI_MODEL_ROUTING_ENABLED=false`: Legacy-/Single-Model-Modus. Alle AI-Calls nutzen wie bisher das globale Modell aus `OLLAMA_MODEL` bzw. `OLLAMA_CLOUD_MODEL`/`OLLAMA_LOCAL_MODEL`.
- `AI_MODEL_ROUTING_ENABLED=true`: Multi-Model-Modus. Das Backend waehlt je Task automatisch ein Modell aus.

### Task-Typen

| Task Type | Zweck | Env Variable |
| --------- | ----- | ------------ |
| `code_analysis` | Code-Strukturanalyse, Symbol-Doku, Signaturen, Calls, Imports, Relation-Inferenz | `UML_CODE_ANALYSIS_MODEL` |
| `diagram_review` | UML-/Diagramm-Review, Layering, Gruppen-/Package-Struktur, Lesbarkeit | `UML_DIAGRAM_REVIEW_MODEL` |
| `vision_review` | Visuelle Analyse fuer Screenshots, Bildexporte, Referenzdiagramme und Draw.io-artige Inputs | `UML_VISION_REVIEW_MODEL` |
| `labeling` | Labels, Titel, Node-/Package-Namen und UML-Notizen | `UML_LABELING_MODEL` |
| `relation_validation` | Plausibilitaetspruefung fuer vorgeschlagene Relationen | `UML_RELATION_VALIDATION_MODEL` |
| `general` | Unspezifische AI-Aufgaben | `AI_DEFAULT_TASK_MODEL` |

### Fallback-Kette

Wenn Routing aktiv ist, wird das Modell in dieser Reihenfolge bestimmt:

1. Task-spezifisches Modell, falls gesetzt
2. `AI_DEFAULT_TASK_MODEL` fuer `general`
3. `UML_FALLBACK_MODEL`
4. Globales Modell (`OLLAMA_CLOUD_MODEL`/`OLLAMA_LOCAL_MODEL`/`OLLAMA_MODEL`)
5. Interner Default `llama3.1:8b`

Leere Werte verursachen keinen Crash. Nicht gesetzte Spezialmodelle fallen automatisch in die Kette zurueck.

Neue AI-Funktionen sollen ihren Task-Typ immer explizit ueber die zentrale Service-Schicht setzen. Endpoints und Use-Cases geben nur den Kontext vor; die Modellwahl bleibt in `apps/server/src/ai/modelRouting.ts` gekapselt.

### Beispielkonfiguration

```env
# AI / Ollama
AI_PROVIDER=cloud
OLLAMA_BASE_URL=https://ollama.com
OLLAMA_MODEL=qwen3.5:cloud

# AI Model Routing
AI_MODEL_ROUTING_ENABLED=true
AI_DEFAULT_TASK_MODEL=
UML_FALLBACK_MODEL=qwen3.5:cloud
UML_CODE_ANALYSIS_MODEL=qwen3-coder:480b-cloud
UML_DIAGRAM_REVIEW_MODEL=qwen3.5:cloud
UML_VISION_REVIEW_MODEL=qwen3.5:cloud
UML_LABELING_MODEL=qwen3.5:cloud
UML_RELATION_VALIDATION_MODEL=glm-5
```

### Aktuelles Use-Case-Mapping im Backend

| Use-Case | Task Type | Hinweis |
| -------- | --------- | ------- |
| `POST /api/ai/summarize` | `code_analysis` | Einzel-Symbol-Zusammenfassung |
| `POST /api/ai/batch-summarize` | `code_analysis` | Batch-Summaries fuer mehrere Symbole |
| Analysephase `labels` | `labeling` | Bereinigt Node-, Gruppen- und View-Labels |
| Analysephase `docs` | `code_analysis` | Generiert detailreiche Symbol-Dokumentation |
| Analysephase `relations` (Discovery) | `code_analysis` | Leitet Relationen direkt aus dem Code ab |
| Analysephase `relations` (Validation) | `relation_validation` | Prueft AI-Kandidaten vor dem Schreiben in den Graphen |
| Analysephase `dead-code` | `code_analysis` | Bewertet potentielle ungenutzte Funktionen/Methoden |
| Analysephase `structure` | `diagram_review` | Bewertet Gruppierung, Splits, Merges und Lesbarkeit |
| Vision-/Screenshot-Review | `vision_review` | Echte multimodale Requests fuer Bild-Review, Bildvergleich und Bild-zu-Suggestions |

### UML AI Enrichment

Fuer gezielte UML-Qualitaetsverbesserung gibt es zusaetzlich dedizierte Endpunkte unter `/api/ai/uml/*`. Sie nutzen die gleiche zentrale Routing-/Use-Case-Schicht wie die bestehenden Analysephasen.

| Route | Use-Case | Task Type | Verhalten |
| ----- | -------- | --------- | --------- |
| `POST /api/ai/uml/enrich-symbol` | `uml_symbol_enrichment` | `code_analysis` | Ergaenzt fehlende Summary-/Input-/Output-Felder direkt am Symbol |
| `POST /api/ai/uml/enrich-view-symbols` | `uml_symbol_enrichment` | `code_analysis` | Ergaenzt mehrere unvollstaendige Symbole einer View direkt im Graph |
| `POST /api/ai/uml/suggest-missing-relations` | `uml_relation_enrichment` + `relation_validation` | `code_analysis` + `relation_validation` | Schlaegt fehlende Beziehungen vor und schreibt nur validierte Relationen |
| `POST /api/ai/uml/review-view-structure` | `uml_structure_review` | `diagram_review` | Liefert strukturierte View-Issues, speichert sie optional in `view.reviewHints` |
| `POST /api/ai/uml/review-external-context` | `uml_external_context_review` | `diagram_review` | Schlaegt fuer sparse Views externe Kontext-Knoten vor, speichert sie optional in `view.contextSuggestions` |
| `POST /api/ai/uml/improve-view-labels` | `uml_label_improvement` | `labeling` | Liefert reviewbare Label-Vorschlaege, speichert sie optional in `view.labelSuggestions` |
| `GET /api/ai/uml/view-opportunities` | lokale Heuristik + Routing-Debug | gemischt | Zeigt sparse/problematische Views, passende Use-Cases und aufgeloeste Modelle |

### Vision Review

Vision-Endpunkte laufen ebenfalls ueber das zentrale Task-Routing und verwenden `UML_VISION_REVIEW_MODEL` bzw. dessen Fallback-Kette. Die Requests senden Bilder als Base64 in JSON; der Server akzeptiert PNG, JPEG, WEBP, GIF und BMP.

| Route | Use-Case | Task Type | Zweck |
| ----- | -------- | --------- | ----- |
| `POST /api/ai/vision/review` | `diagram_image_review` | `vision_review` | UML-Qualitaetsreview eines Diagrammbilds |
| `POST /api/ai/vision/compare` | `diagram_image_compare` | `vision_review` | Vergleich aktuelles Diagramm vs. Referenzbild |
| `POST /api/ai/vision/compare-uml` | `uml_reference_compare` | `vision_review` | Spezialisierter Ist-vs-Soll-UML-Vergleich fuer React-Flow-Screenshots gegen Professor-/Referenzdiagramme |
| `POST /api/ai/vision/compare-apply` | `uml_reference_compare` + Refactor-Plan/Validation | gemischt | Fuehrt Compare -> Refactor-Plan -> Validation -> Auto-Apply fuer eine aktuelle View aus |
| `POST /api/ai/vision/compare-apply/undo` | Snapshot-Restore | kein neuer Task | Stellt den letzten reference-driven Autorefactor-Lauf ueber `snapshotId` wieder her |
| `POST /api/ai/vision/suggestions` | `diagram_image_to_suggestions` | `vision_review` | Strukturierte Verbesserungs- und Anreicherungs-Vorschlaege aus Bildern |

Beispiel-Request:

```json
{
  "images": [
    {
      "label": "current_view",
      "mimeType": "image/png",
      "dataBase64": "iVBORw0KGgoAAA..."
    }
  ],
  "instruction": "Pruefe wissenschaftliche UML-Qualitaet und fehlende Beziehungen.",
  "viewId": "view:root"
}
```

Beispiel-Response fuer `review`:

```json
{
  "summary": "The diagram is readable but lacks visible context for external collaborators.",
  "issues": [
    {
      "type": "missing_context",
      "severity": "medium",
      "message": "Important external systems are implied but not shown.",
      "suggestion": "Add package stubs for the main upstream and downstream systems.",
      "confidence": 0.81
    }
  ]
}
```

Beispiel-Request fuer `compare-uml`:

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
  "instruction": "Vergleiche mein aktuelles React-Flow-Layer-1 mit dem Professor-Bild und liefere konkrete UML-Verbesserungen.",
  "viewId": "view:root",
  "persistSuggestions": true
}
```

Beispiel-Response fuer `compare-uml`:

```json
{
  "summary": "The reference diagram communicates the architecture more scientifically than the current React Flow view.",
  "overallAssessment": {
    "umlQualityDelta": "better_reference",
    "mainProblem": "notation"
  },
  "differences": [
    {
      "category": "notation",
      "severity": "high",
      "message": "The current diagram reads like UI cards instead of UML packages and typed context nodes.",
      "suggestion": "Convert the major domain groups to UML packages and use a database shape for storage systems.",
      "target": "Datenquellen",
      "confidence": 0.92
    }
  ],
  "migrationSuggestions": [
    {
      "type": "replace_group_with_package",
      "target": "Datenquellen",
      "message": "Promote the current group to a UML package.",
      "confidence": 0.9
    },
    {
      "type": "add_context_stub",
      "target": "MES",
      "message": "Add MES as an explicit external context stub.",
      "confidence": 0.84
    }
  ],
  "recommendedActions": [
    {
      "priority": 1,
      "action": "Fix the package and database notation before fine-tuning labels."
    },
    {
      "priority": 2,
      "action": "Add missing context stubs and aggregated cross-layer relations."
    }
  ],
  "graphSuggestions": [
    {
      "type": "node_type_change",
      "targetIds": ["sym:group:datenquellen"],
      "message": "Change the main group to a package-oriented node type."
    }
  ],
  "isCurrentDiagramTooUiLike": true
}
```

Wichtige Fehlerfaelle:

- kein Bild gesendet -> `400`
- ungueltiger MIME-Type oder kaputtes Base64 -> `400`
- Compare ohne genau zwei Bilder -> `400`
- `compare-uml` mit `persistSuggestions=true`, aber ohne geladenen Graph oder `viewId` -> `400`
- konfiguriertes Modell ohne Vision-Capability -> klare Fehlermeldung mit Hinweis auf `UML_VISION_REVIEW_MODEL`

### Reference-Driven UML Autorefactor

Der neue Hauptworkflow fuer "aktueller React-Flow-View vs. Professor-/Referenzbild" ist direkt im Frontend integriert:

1. Review-Tab der aktuellen View oeffnen
2. `Mit Referenz anpassen` klicken
3. genau ein Referenzbild hochladen
4. den Lauf starten

Die Web-App exportiert den aktuellen View automatisch als IST-Bild. Der Nutzer muss keinen Screenshot, kein Base64 und keinen manuellen Request bauen.

Backend-Phasen:

1. `vision_review`: aktueller View gegen Referenzbild vergleichen
2. `diagram_review`: daraus einen maschinenanwendbaren Refactor-Plan bauen
3. `relation_validation`: Relations-/Kontext-Schritte validieren
4. `labeling`: Namensschritte nachschaerfen
5. Apply: sichere Aktionen automatisch in den Graph schreiben
6. Snapshot/Undo: vor dem Apply einen Rueckgaengig-Snapshot anlegen

Haupt-Endpoint:

```text
POST /api/ai/vision/compare-apply
```

Beispiel-Request:

```json
{
  "currentViewImage": {
    "label": "current_view",
    "mimeType": "image/png",
    "dataBase64": "iVBORw0KGgoAAA..."
  },
  "referenceImage": {
    "label": "reference_view",
    "mimeType": "image/png",
    "dataBase64": "iVBORw0KGgoAAA..."
  },
  "viewId": "view:root",
  "instruction": "Vergleiche meinen aktuellen React-Flow-UML-View mit dem Referenzbild und passe das UML automatisch so weit wie sinnvoll an.",
  "options": {
    "autoApply": true,
    "allowStructuralChanges": true,
    "allowLabelChanges": true,
    "allowRelationChanges": true,
    "persistSuggestions": true
  }
}
```

Beispiel-Response:

```json
{
  "compare": {
    "summary": "The reference is more UML-like and exposes clearer context.",
    "overallAssessment": {
      "umlQualityDelta": "better_reference",
      "mainProblem": "notation"
    },
    "differences": [],
    "migrationSuggestions": [],
    "recommendedActions": [
      { "priority": 1, "action": "Fix notation before relation density." }
    ]
  },
  "plan": {
    "summary": "Convert the main group to a package and add missing context.",
    "actions": [],
    "primaryFocusTargetIds": ["sym:group:data"],
    "changedViewIds": ["view:root"],
    "remainingReviewOnlyItems": []
  },
  "validation": {
    "summary": "All deterministic actions were checked.",
    "decisions": []
  },
  "appliedActions": [],
  "skippedActions": [],
  "reviewOnlyActions": [],
  "changedTargetIds": ["sym:group:data", "ref:mes"],
  "changedViewIds": ["view:root"],
  "highlightTargetIds": ["sym:group:data", "ref:mes"],
  "primaryFocusTargetIds": ["sym:group:data"],
  "focusViewId": "view:root",
  "autoApplied": true,
  "undoInfo": {
    "snapshotId": "graph-snapshot-...",
    "applyRunId": "refactor-run-..."
  }
}
```

Automatisch anwendbare Aenderungen:

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

Bewusst review-only oder skip:

- `split_group`
- `merge_group`
- `rebuild_view`
- `remove_relation`
- `aggregate_relations`
- alles, was lokal inkonsistent, nicht erlaubt oder nicht sicher auto-applicable ist

Undo:

- jeder Auto-Apply-Lauf erzeugt serverseitig einen Graph-Snapshot
- das Frontend zeigt danach einen `Rueckgaengig`-Button
- `POST /api/ai/vision/compare-apply/undo` stellt den Snapshot ueber `snapshotId` wieder her

### Was automatisch geschrieben wird

- Symbol-Enrichment schreibt `summary`, `inputs` und `outputs` direkt in `symbol.doc`, aber nur fuer fehlende bzw. sehr schwache Felder. Neue AI-Felder werden in `symbol.doc.aiGenerated` markiert.
- Relation-Enrichment fuegt nur validierte Relationen als `aiGenerated` in den Graph ein.
- Structure-Review schreibt keine Umbauten in den Graph. Stattdessen landen Issues als Review-Hinweise in `view.reviewHints`.
- External-Context-Review schreibt keine Stub-Knoten. Es speichert nur Vorschlaege in `view.contextSuggestions`.
- Label-Improvement aendert keine Labels automatisch. Vorschlaege landen in `view.labelSuggestions`.

### Frontend Review Hints

Die Web-App zeigt AI-, Vision- und Compare-Ergebnisse jetzt direkt in einem dedizierten Review-Tab in der linken Sidebar an. Das Panel reagiert immer auf die aktuell geoeffnete View und normalisiert mehrere Quellen in eine gemeinsame To-do-Ansicht:

- `structure_review`
- `external_context_review`
- `label_improvement`
- `vision_review`
- `uml_reference_compare`

Das Panel zeigt:

- priorisierte Review-Hinweise nach `high`, `medium`, `low`
- `Top Actions` aus dem UML-Referenzvergleich
- Source-Tags, Kategorien, Confidence und betroffene Targets
- einen auffaelligen Hinweis, wenn `uml_reference_compare` das aktuelle Diagramm als zu UI-artig markiert
- direkte Graph-Aktionen pro Hinweis: `Focus`, `Open view`, `Inspect`
- Hover-Preview fuer Hinweise, deren Targets bereits in der aktuellen View sichtbar sind
- einen `Clear highlight`-Reset fuer den Review-Fokus
- den Button `Mit Referenz anpassen`, der den aktuellen View intern exportiert und den kompletten Autorefactor-Lauf startet
- eine Ergebnis-/Undo-Karte fuer den letzten reference-driven Auto-Apply-Lauf

Status pro Hinweis:

- `new`
- `acknowledged`
- `applied`
- `dismissed`

Diese Status aendern keine Graph-Struktur automatisch. Sie dienen nur dem Review- und To-do-Management und werden ueber den bestehenden Graph-Sync persistiert.

Review-Hints sind jetzt direkt mit dem Graph verknuepft:

- `Focus` loest `targetIds` oder Best-Effort-Targets aus Labels auf
- bei fremden Targets wird automatisch in die passendste View navigiert
- mehrere `targetIds` werden gemeinsam gehighlightet und per `fitView` sichtbar gemacht
- der primaere Target-Knoten wird parallel im Inspector selektiert
- Review-Highlight bleibt visuell getrennt von normaler Selection und normalem AI-Focus
- reference-driven Auto-Apply verwendet dieselbe Fokus-/Highlight-Mechanik fuer `changedTargetIds` und `highlightTargetIds`

### Entwicklerhinweise

- Neue AI-Operationen muessen immer ueber die zentrale Task-/Use-Case-Definition in `apps/server/src/ai/useCases.ts` angebunden werden.
- Wenn du eine neue Relation-Pruefung einbaust, verwende `relation_validation`.
- Wenn du Screenshots oder Diagramm-Bilder analysierst, verwende `vision_review` und hange den Endpoint an `callAiVisionJson()`.
- Wenn du einen React-Flow-Screenshot gegen ein Professor-/Draw.io-Bild vergleichen willst, verwende `uml_reference_compare` ueber `POST /api/ai/vision/compare-uml`.
- Fuer unspezifische Hilfsfunktionen ist `general` der Default-Fallback, wenn kein Task gesetzt wurde.

`GET /api/config` liefert neben `aiModelRouting` auch `aiUseCaseRouting`, damit du im Frontend oder beim Debuggen sehen kannst, welches Modell pro Use-Case aktuell aufgeloest wird.

## Nutzung

1. **Demo**: Beim ersten Laden wird ein Demo-Graph angezeigt
2. **Projekt scannen**: Links unten im Sidebar den Pfad eingeben → „Scan"
3. **Navigation**: Doppelklick auf Group-Nodes → Drilldown, Breadcrumb zum Zurück
4. **Inspector**: Node anklicken → rechts Details, Calls, Links
5. **Review Tab**: Links in der Sidebar auf das Clipboard-Icon → Review-Hinweise, Top Actions und Compare-Warnungen der aktuellen View
6. **AI Docs**: Im Inspector → „Generate AI Docs" Button
7. **Drag & Drop**: Neue Nodes aus der linken Palette auf den Canvas ziehen
8. **Edges verbinden**: Handle (oben/unten) eines Nodes auf ein anderes Handle ziehen

## API Endpoints

| Methode | Pfad                        | Beschreibung                  |
| ------- | --------------------------- | ----------------------------- |
| GET     | `/api/graph`                | Aktuellen Graph laden         |
| PUT     | `/api/graph`                | Graph komplett ersetzen       |
| PATCH   | `/api/graph/symbol/:id/doc` | Doku eines Symbols updaten    |
| POST    | `/api/scan`                 | Projektverzeichnis scannen    |
| POST    | `/api/ai/summarize`         | KI-Doku für Symbol generieren |
| POST    | `/api/ai/vision/compare-apply` | Referenzbild-gesteuerten UML-Autorefactor ausfuehren |
| POST    | `/api/ai/vision/compare-apply/undo` | Letzten Autorefactor-Snapshot wiederherstellen |
| GET     | `/api/health`               | Health Check                  |
