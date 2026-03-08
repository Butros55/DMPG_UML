# Vision Review Implementation

## Implementierte Endpunkte

- `POST /api/ai/vision/review`
- `POST /api/ai/vision/compare`
- `POST /api/ai/vision/compare-uml`
- `POST /api/ai/vision/suggestions`

## Angepasste Dateien

- `apps/server/src/ai/client.ts`
- `apps/server/src/ai/useCases.ts`
- `apps/server/src/ai/visionReview.ts`
- `apps/server/src/ai/client.test.ts`
- `apps/server/src/ai/visionReview.test.ts`
- `apps/server/src/routes/ai-vision.ts`
- `apps/server/src/routes/ai.ts`
- `apps/server/src/index.ts`
- `packages/shared/src/schemas.ts`
- `apps/web/src/api.ts`
- `README.md`
- `docs/vision_review.md`

## Request-/Response-Format

### Request

Alle Vision-Endpunkte verwenden JSON mit Base64-Bildern:

```json
{
  "images": [
    {
      "label": "current_view",
      "mimeType": "image/png",
      "dataBase64": "iVBORw0KGgoAAA..."
    }
  ],
  "instruction": "Pruefe UML-Qualitaet",
  "viewId": "view:root",
  "graphContext": {
    "focus": "Package diagram"
  }
}
```

### Responses

- `review` -> `DiagramImageReviewResponseSchema`
- `compare` -> `DiagramImageCompareResponseSchema`
- `compare-uml` -> `UmlReferenceCompareResponseSchema`
- `suggestions` -> `DiagramImageSuggestionsResponseSchema`

## Routing-Einbindung

- `diagram_image_review` -> `vision_review`
- `diagram_image_compare` -> `vision_review`
- `uml_reference_compare` -> `vision_review`
- `diagram_image_to_suggestions` -> `vision_review`

Die Modellauflösung laeuft zentral ueber `getTaskTypeForUseCase()` + `resolveModelForTask()`.

## Provider-/Client-Implementierung

- `callAiVisionJson()` baut jetzt echte multimodale Requests fuer `/api/chat`
- Bilder werden als Base64 in das `images`-Feld der User-Message geschrieben
- vor dem Chat-Request wird `/api/show` genutzt, um die `vision`-Capability des Modells zu pruefen
- MIME-Type und Base64 werden serverseitig validiert
- `compare-uml` nutzt dieselbe Pipeline, aber mit einem UML-spezifischen Prompt und einem strukturierteren Response-Schema fuer Ist-vs-Soll-Migrationen

## Geeignete Modelle

Verwendet werden sollten vision-faehige Ollama-Modelle, also multimodale Modelle mit gemeldeter `vision`-Capability. Das Backend hartcodiert keine Modellnamen; die Auswahl erfolgt komplett ueber `.env`.

## Offen / moegliche Erweiterungen

- optionales Persistieren von `compare-uml`-Findings als reviewbare `view.reviewHints`
- Frontend-Debug-UI fuer Upload und visuelle Ergebnisdarstellung
- spaetere Unterstuetzung fuer weitere Bildquellen oder serverseitige Screenshot-Erzeugung
- ggf. feinere Provider-Erkennung, falls kuenftig neben Ollama weitere AI-Provider hinzukommen
