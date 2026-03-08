# Frontend Review Hints Panel Implementation

## Angepasste Dateien

- `packages/shared/src/schemas.ts`
- `apps/server/src/ai/umlReview.ts`
- `apps/server/src/ai/visionReview.ts`
- `apps/server/src/ai/visionReview.test.ts`
- `apps/web/src/store.ts`
- `apps/web/src/api.ts`
- `apps/web/src/reviewHints.ts`
- `apps/web/src/reviewHints.test.ts`
- `apps/web/src/reviewFocus.ts`
- `apps/web/src/reviewFocus.test.ts`
- `apps/web/src/components/ReviewHintsPanel.tsx`
- `apps/web/src/components/Canvas.tsx`
- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/styles/global.css`
- `apps/web/tsconfig.json`
- `README.md`
- `docs/frontend_review_hints_panel.md`

## Frontend-Normalisierung

Die zentrale Normalisierung liegt in `apps/web/src/reviewHints.ts`.

Sie fuehrt mehrere View-Metadaten in ein gemeinsames Frontend-Modell zusammen:

- `reviewHints`
- `contextSuggestions`
- `labelSuggestions`
- `graphSuggestions`
- `reviewActions`
- `reviewSummary`

Ergebnis:

- einheitliche `ReviewHintViewModel`-Eintraege fuer die Liste
- einheitliche `ReviewActionViewModel`-Eintraege fuer `Top Actions`
- gemeinsame Sortierung, Filterung und Status-Updates

## Wo das Panel integriert wurde

Das Panel ist als eigener Sidebar-Tab integriert:

- `apps/web/src/components/Sidebar.tsx`
- Tab-Name intern: `review`

Dadurch bleibt der Workflow direkt an der aktuellen View und in derselben Navigationsstruktur wie `Views`, `AI` und `Project`.

## Statusaktionen

Moegliche Statusaenderungen:

- `acknowledged`
- `applied`
- `dismissed`

Die Aenderung laeuft ueber:

1. Normalisiertes Storage-Ref im Frontend
2. `updateReviewEntityStatus()` in `apps/web/src/reviewHints.ts`
3. `updateView()` im Zustand-Store
4. `syncGraphToServer()` ueber den bestehenden Graph-Sync

## Darstellung von Compare- und Vision-Hinweisen

Besonders fuer `uml_reference_compare` umgesetzt:

- klare Source-Markierung `UML Reference Compare`
- `Top Actions` ganz oben
- `reviewSummary` mit `umlQualityDelta` und `mainProblem`
- prominente Warnbox bei `isCurrentDiagramTooUiLike = true`
- Compare-Graph-Suggestions erscheinen als normale Review-Items

## Graph-Fokus-Integration

Die Aufloesung von Review-Eintraegen zu konkreten Graph-Zielen liegt zentral in `apps/web/src/reviewFocus.ts`.

Prioritaet der Zielaufloesung:

1. direkte `targetIds`
2. Label-Matching ueber `target`
3. abgeleitete Targets aus verwandten `Top Actions`
4. Fallback auf reine View-Navigation

Store-/Canvas-Integration:

- `reviewHighlight` im Zustand-Store haelt aktive IDs, Preview-IDs, View und Fit-Flags
- `activateReviewHighlight()` navigiert bei Bedarf in die beste View und selektiert den primaeren Knoten
- `previewReviewHighlight()` setzt einen leichten Hover-Fokus ohne Navigation
- `clearReviewHighlight()` entfernt nur den Review-Kontext, nicht die normale Selection

In `Canvas.tsx` fuehrt das zu:

- Multi-Target-Highlight auf Nodes
- Dimming nicht betroffener Nodes und Edges
- `fitView` auf ganze Zielmengen statt nur auf einen Node
- getrennte Darstellung fuer persistenten Focus, related Targets und Hover-Preview

## Noch offen

- kein eigenes Upload-UI fuer den Vision-/Compare-Workflow
- kein direkter Button fuer `Run compare again`, weil dafuer weiterhin Bildinput benoetigt wird
- Statusaenderungen werden persistiert, aber noch nicht serverseitig audit-log-artig versioniert
