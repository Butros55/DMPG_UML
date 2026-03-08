# Review Hint Graph Focus Implementation

## Angepasste Dateien

- `apps/web/src/reviewFocus.ts`
- `apps/web/src/reviewFocus.test.ts`
- `apps/web/src/store.ts`
- `apps/web/src/components/ReviewHintsPanel.tsx`
- `apps/web/src/components/Canvas.tsx`
- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/styles/global.css`
- `README.md`
- `docs/frontend_review_hints_panel.md`
- `docs/frontend_review_hints_panel_implementation.md`
- `docs/review_hint_graph_focus.md`

## Mapping ReviewHint -> Graph-Ziel

Die zentrale Aufloesung passiert in `apps/web/src/reviewFocus.ts`.

Wichtige Regeln:

1. Explizite `targetIds` schlagen alles andere
2. `target` wird gegen Symbol-Labels und Kurzlabels gematcht
3. `Top Actions` ohne eigene Targets leiten Targets aus verwandten Compare-Hinweisen ab
4. Die Ziel-View wird nach staerkster Zielabdeckung gewaehlt
5. Der primaere Target wird bevorzugt aus der finalen Ziel-View bestimmt

Dadurch funktionieren besonders `uml_reference_compare`-Hinweise besser, auch wenn Compare-Findings nicht in derselben View gespeichert wurden, in der der Nutzer gerade steht.

## Highlight, Focus und View-Navigation

Der Store haelt dafuer einen eigenen `reviewHighlight`-State:

- `activeItemId`
- `nodeIds`
- `primaryNodeId`
- `viewId`
- `fitView`
- `previewNodeIds`

Wichtige Aktionen:

- `activateReviewHighlight(...)`
  - wechselt bei Bedarf in die Ziel-View
  - aktualisiert Breadcrumbs
  - selektiert den primaeren Target fuer den Inspector
- `previewReviewHighlight(...)`
  - setzt temporaere Hover-Highlights ohne Navigation
- `clearReviewHighlight()`
  - entfernt den Review-Fokus wieder

`Canvas.tsx` setzt diesen State visuell um:

- mehrere Ziel-Nodes werden gleichzeitig hervorgehoben
- der primaere Target bekommt einen staerkeren Fokus
- nicht betroffene Nodes/Edges werden gedimmt
- bei aktivem Review-Fokus wird der normale Single-Node-Focus-Mode nicht erzwungen
- `fitView` fokussiert die gesamte Zielmenge

## Compare- und Vision-Vorteile

Der Hauptnutzen fuer den UML-Review-Workflow:

- `Replace group with package` aus dem Professor-/Referenzvergleich springt direkt zur betroffenen Group
- Kontext-Hinweise mit mehreren `targetIds` zeigen alle relevanten Systeme gleichzeitig
- Compare-Top-Actions koennen auch ohne direkte `targetIds` auf konkrete Compare-Findings zurueckfallen
- die Summary-Aktion `Focus compare targets` verwendet dieselbe Zielaufloesung wie normale Hinweise

## Tests

Ergaenzt wurden Logiktests in `apps/web/src/reviewFocus.test.ts` fuer:

- Prioritaet `targetIds > target label`
- View-Auswahl fuer Multi-Target-Faelle
- Label-Fallback in der aktuellen View
- Target-Ableitung fuer `Top Actions`
- Request-Aufbau fuer Multi-Target-Highlight

## Offen

- kein eigener Persistenz-Status fuer den Highlight-Zustand; er ist bewusst nur UI-Kontext
- keine gesonderte Edge-Legende oder AI-Heatmap fuer Compare-Findings
- Hover-Preview bleibt auf die aktuelle View beschraenkt und navigiert nicht automatisch
