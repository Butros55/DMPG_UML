# Frontend Review Hints Panel

## Wo das Panel sitzt

Das Review-Panel sitzt in der linken Sidebar der Web-App als eigener Tab mit Clipboard-Icon.

- Datei: `apps/web/src/components/ReviewHintsPanel.tsx`
- Integration: `apps/web/src/components/Sidebar.tsx`
- Kontext: immer die aktuell geoeffnete View

Das Panel ist damit kein separates Playground-UI, sondern Teil des normalen View-Workflows.

## Welche Datenquellen angezeigt werden

Die Ansicht normalisiert mehrere View-bezogene AI-Quellen:

- `view.reviewHints`
  - z. B. aus `structure_review`
  - z. B. aus persistiertem `uml_reference_compare`
- `view.contextSuggestions`
  - aus `external_context_review`
- `view.labelSuggestions`
  - aus `label_improvement`
- `view.graphSuggestions`
  - vor allem aus `uml_reference_compare`
- `view.reviewActions`
  - priorisierte Top Actions aus `uml_reference_compare`
- `view.reviewSummary`
  - Compare-Zusammenfassung inkl. `isCurrentDiagramTooUiLike`

## Status und Filter

Jeder Hinweis oder jede Action kann im Frontend einen Status haben:

- `new`
- `acknowledged`
- `applied`
- `dismissed`

Filter im Panel:

- `All`
- `Structure`
- `Context`
- `Labels`
- `Vision Compare`

Standardmaessig werden `dismissed`-Eintraege ausgeblendet. Sie koennen ueber `Show dismissed` wieder eingeblendet werden.

## Darstellung von Compare-Hinweisen

Hinweise aus dem Professor-/Referenzvergleich werden klar als `UML Reference Compare` markiert.

Zusatzverhalten:

- `Top Actions` werden ueber der allgemeinen Liste prominent angezeigt
- `reviewSummary.isCurrentDiagramTooUiLike` erzeugt einen auffaelligen Warnhinweis
- Graph-nahe Compare-Vorschlaege wie `node_type_change` oder `context_stub_addition` erscheinen als normale Review-Items mit Quelle `uml_reference_compare`

## Graph-Verknuepfung

Das Panel ist jetzt direkt mit dem Canvas verknuepft:

- Klick auf einen Hinweis loest einen Review-Fokus aus
- `Focus` zoomt auf betroffene Targets und highlightet sie im Graph
- `Open view` springt, falls noetig, in die passendste View fuer die betroffenen Targets
- `Inspect` selektiert den primaeren Target-Knoten fuer den Inspector
- Hover auf einen Hinweis zeigt eine temporaere Preview, wenn die Targets schon in der aktuellen View sichtbar sind

Multi-Target-Verhalten:

- mehrere `targetIds` werden gemeinsam behandelt
- die View-Auswahl bevorzugt die View mit der staerksten Zielabdeckung
- der primaere Target wird selektiert, weitere Targets bleiben als related highlight sichtbar

Vergleich zum normalen Selection-State:

- Selection bleibt fuer Inspector/aktiven Knoten zustaendig
- Review-Highlight ist ein eigener temporaerer Kontext fuer AI-/Compare-Hinweise
- `Clear highlight` im Panel setzt nur den Review-Fokus zurueck

## Persistenz

Statusaenderungen werden nicht nur lokal gehalten.

Sie werden ueber den bestehenden Graph-Store zurueck in die aktuelle View geschrieben und dann ueber `PUT /api/graph` synchronisiert.

Persistiert werden:

- Status von `reviewHints`
- Status von `contextSuggestions`
- Status von `labelSuggestions`
- Status von `graphSuggestions`
- Status von `reviewActions`

Nicht automatisch angewendet werden:

- Node- oder Group-Umbauten
- Relation-Mutationen
- Label-Ueberschreibungen

Das Panel ist bewusst ein Review-/To-do-Werkzeug, kein Auto-Apply-System.
