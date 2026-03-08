# Reference-Driven UML Autorefactor

## Ziel

Der Workflow automatisiert den Hauptfall:

- aktuelle React-Flow-View als IST
- Referenzbild als SOLL
- Compare -> Refactor-Plan -> Validation -> Apply

Der Nutzer laedt im Frontend nur ein Referenzbild hoch. Das aktuelle Diagramm wird intern als PNG exportiert und mit dem Referenzbild an den Backend-Workflow gesendet.

## End-to-End Ablauf

1. Frontend exportiert die aktuelle View als `currentViewImage`
2. Referenzbild wird als `referenceImage` gelesen
3. `POST /api/ai/vision/compare-apply` startet den Workflow
4. Vision-Compare erzeugt strukturierte UML-Unterschiede
5. Diagram-Review erzeugt einen maschinenanwendbaren Refactor-Plan
6. Relation- und Strukturentscheidungen werden validiert
7. sichere Aktionen werden automatisch in den Graph geschrieben
8. vor dem Apply wird ein Snapshot fuer Undo angelegt
9. geaenderte Targets werden im Frontend gehighlightet und fokussiert
10. unsichere Schritte bleiben als Review-Hints sichtbar

## Routing

Der Workflow nutzt kein separates AI-System. Er verwendet bestehende Task-Types:

- Vision-Vergleich -> `vision_review`
- Refactor-Plan -> `diagram_review`
- Label-Nachschaerfung -> `labeling`
- Relations-/Kontext-Validierung -> `relation_validation`

Die Modellwahl laeuft weiter ueber das zentrale Routing:

1. task-spezifisches Modell
2. `UML_FALLBACK_MODEL`
3. globale Ollama-Modelle
4. interner Default

## Request-Schema

```json
{
  "currentViewImage": {
    "label": "current_view",
    "mimeType": "image/png",
    "dataBase64": "..."
  },
  "referenceImage": {
    "label": "reference_view",
    "mimeType": "image/png",
    "dataBase64": "..."
  },
  "viewId": "view:root",
  "instruction": "Vergleiche meinen aktuellen React-Flow-UML-View mit dem Referenzbild und passe das UML automatisch so weit wie sinnvoll an.",
  "graphContext": {
    "viewTitle": "Layer 1",
    "currentSummary": "Reference compare summary"
  },
  "options": {
    "autoApply": true,
    "allowStructuralChanges": true,
    "allowLabelChanges": true,
    "allowRelationChanges": true,
    "persistSuggestions": true,
    "dryRun": false
  }
}
```

## Response-Schema

```json
{
  "compare": {},
  "plan": {},
  "validation": {},
  "appliedActions": [],
  "skippedActions": [],
  "reviewOnlyActions": [],
  "changedTargetIds": [],
  "changedViewIds": [],
  "highlightTargetIds": [],
  "primaryFocusTargetIds": [],
  "focusViewId": "view:root",
  "autoApplied": true,
  "undoInfo": {
    "snapshotId": "graph-snapshot-...",
    "applyRunId": "refactor-run-..."
  },
  "graph": {}
}
```

## Unterstuetzte Aktionsarten

Automatisch anwendbar:

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

Review-only oder skip:

- `split_group`
- `merge_group`
- `rebuild_view`
- `remove_relation`
- `aggregate_relations`
- alles, was lokal oder durch Validation als unsicher eingestuft wird

## Undo

Vor jedem Auto-Apply erzeugt der Server einen Snapshot im Projekt-Datenverzeichnis.

- Undo-Endpoint: `POST /api/ai/vision/compare-apply/undo`
- Input: `{ "snapshotId": "..." }`
- Ergebnis: restaurierter Graph

Das Frontend bietet fuer den letzten Lauf einen `Rueckgaengig`-Button an.

## Fokus, Highlight und Review-Hints

Nach erfolgreichem Apply:

- `highlightTargetIds` gehen direkt in den bestehenden Review-Highlight-State
- `focusViewId` oeffnet die passendste View
- der primaere Target-Knoten wird im Inspector ausgewaehlt

Unsichere oder uebersprungene Aktionen werden als reviewbare Hinweise in der aktuellen View gespeichert, wenn `persistSuggestions=true` gesetzt ist.

## Grenzen

- komplexe View-Splits und Merges bleiben review-only
- die aktuelle Auto-Apply-Stufe aendert keine Relations durch Loeschungen
- der aktuelle View wird als sichtbarer React-Flow-Zustand exportiert, nicht als perfekter druckfertiger Diagramm-Render
- der Undo-Button deckt den letzten serverseitigen Snapshot-Lauf ab, nicht beliebige historische AI-Runs
