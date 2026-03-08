# Review Hint Graph Focus

## Ziel

Review-Hints, Vision-Findings und UML-Compare-Suggestions sollen direkt auf den Graph wirken, ohne automatisch Strukturen zu mutieren.

Der Workflow im Frontend ist:

1. Hinweis im Review-Panel lesen
2. `Focus`, `Open view` oder `Inspect` ausloesen
3. betroffene View oeffnen
4. betroffene Nodes im Canvas highlighten
5. primaeren Target-Knoten im Inspector sehen

## Datenfluss

Die Verknuepfung laeuft ueber drei Schichten:

1. `apps/web/src/reviewHints.ts`
   - normalisiert persistierte AI-/Compare-Daten zu einheitlichen Frontend-Eintraegen
2. `apps/web/src/reviewFocus.ts`
   - loest aus einem Review-Eintrag konkrete Graph-Ziele ab
3. `apps/web/src/store.ts` und `apps/web/src/components/Canvas.tsx`
   - speichern und rendern den Review-Fokus im Graph

## Zielaufloesung

Die Aufloesung eines Review-Hints folgt dieser Reihenfolge:

1. `targetIds`
2. `graphSuggestions.targetIds` nach Normalisierung
3. `target` ueber Label-/Kurzlabel-Matching
4. verwandte Compare-Targets fuer `Top Actions`
5. reiner View-Fallback

View-Auswahl:

- bevorzugt wird die View mit der staerksten Zielabdeckung
- bei Gleichstand bleibt die aktuelle View bevorzugt
- wenn mehrere Targets betroffen sind, wird eine gemeinsame Ziel-View gesucht

## Highlight vs Selection

Es gibt bewusst zwei getrennte Konzepte:

- Selection
  - normaler Inspector-/Knoten-Kontext
- Review-Highlight
  - temporaerer AI-/Compare-Fokus fuer eine oder mehrere Nodes

Review-Highlight:

- kann mehrere Nodes gleichzeitig markieren
- dimmt andere Nodes und Edges
- nutzt einen primaeren Target plus related Targets
- kennt Hover-Preview und persistenten Fokus

## View-Navigation

Wenn ein Hinweis Targets ausserhalb der aktuellen View betrifft:

- der Store oeffnet automatisch die passendste View
- der Review-Fokus wird danach auf diese View gelegt
- `fitView` zeigt die ganze Zielmenge, nicht nur einen Einzelknoten

## Compare-Hinweise

`uml_reference_compare` profitiert besonders davon:

- `Top Actions` koennen direkt fokussiert werden
- `reviewSummary.isCurrentDiagramTooUiLike` bleibt im Panel sichtbar
- Compare-Suggestions wie `replace_group_with_package` oder `add_context_stub` fuehren direkt zu den betroffenen Nodes

## Bekannte Grenzen

- Ein Review-Hint ohne `targetIds`, ohne sinnvolles `target` und ohne passende Ziel-View bleibt lesbar, aber nicht graphisch fokussierbar
- Hover-Preview navigiert nicht zwischen Views; sie bleibt absichtlich lokal zur aktuellen View
- Es gibt noch kein separates Canvas-Overlay fuer Edge-Gruppen oder symbolische Compare-Legenden
