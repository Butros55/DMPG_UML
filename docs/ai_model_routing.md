# AI Model Routing

## Betroffene Dateien

- `apps/server/src/env.ts`
- `apps/server/src/ai/taskTypes.ts`
- `apps/server/src/ai/modelRouting.ts`
- `apps/server/src/ai/client.ts`
- `apps/server/src/ai/useCases.ts`
- `apps/server/src/routes/ai.ts`
- `apps/server/src/index.ts`
- `apps/server/.env.example`
- `README.md`
- `apps/server/src/ai/modelRouting.test.ts`
- `apps/server/src/ai/useCases.test.ts`

## Routing-Logik

Der Server nutzt jetzt eine zentrale AI-Konfiguration in `apps/server/src/env.ts` und einen zentralen Resolver in `apps/server/src/ai/modelRouting.ts`.

### Modell-Auswahl

Bei `AI_MODEL_ROUTING_ENABLED=true` gilt pro Task folgende Reihenfolge:

1. Task-spezifisches Modell
2. `AI_DEFAULT_TASK_MODEL` fuer `general`
3. `UML_FALLBACK_MODEL`
4. Globales Modell (`OLLAMA_CLOUD_MODEL` / `OLLAMA_LOCAL_MODEL` / `OLLAMA_MODEL`)
5. Interner Default `llama3.1:8b`

Bei `AI_MODEL_ROUTING_ENABLED=false` bleibt das alte Verhalten erhalten: alle Tasks nutzen das globale Modell.

## Task-Type-Mapping

| Task Type | Env Variable | Aktuelle Nutzung |
| --------- | ------------ | ---------------- |
| `general` | `AI_DEFAULT_TASK_MODEL` | Reserviert fuer allgemeine AI-Aufgaben |
| `code_analysis` | `UML_CODE_ANALYSIS_MODEL` | Symbol-Doku, Batch-Doku, Relations-Discovery, Dead-Code-Pruefung |
| `diagram_review` | `UML_DIAGRAM_REVIEW_MODEL` | Struktur-/Gruppenreview in `/api/ai/analyze` |
| `vision_review` | `UML_VISION_REVIEW_MODEL` | Multimodale Bild-/Screenshot-Analyse ueber `/api/ai/vision/*` |
| `labeling` | `UML_LABELING_MODEL` | Label-Bereinigung in `/api/ai/analyze` |
| `relation_validation` | `UML_RELATION_VALIDATION_MODEL` | Plausibilitaetspruefung fuer AI-inferierte Relationskandidaten |

## Beispiel `.env`

```env
AI_PROVIDER=cloud
OLLAMA_BASE_URL=https://ollama.com
OLLAMA_MODEL=qwen3.5:cloud

AI_MODEL_ROUTING_ENABLED=true
AI_DEFAULT_TASK_MODEL=
UML_FALLBACK_MODEL=qwen3.5:cloud
UML_CODE_ANALYSIS_MODEL=qwen3-coder:480b-cloud
UML_DIAGRAM_REVIEW_MODEL=qwen3.5:cloud
UML_VISION_REVIEW_MODEL=qwen3.5:cloud
UML_LABELING_MODEL=qwen3.5:cloud
UML_RELATION_VALIDATION_MODEL=glm-5
```

## Erweiterungshinweise

- Neue Task-Typen zuerst in `apps/server/src/ai/taskTypes.ts` definieren.
- Neue fachliche AI-Use-Cases in `apps/server/src/ai/useCases.ts` an einen bestehenden oder neuen Task-Type binden.
- Danach das Env-Mapping in `apps/server/src/ai/modelRouting.ts` und `apps/server/src/env.ts` erweitern.
- Neue AI-Aufrufe nur noch ueber `callAiJson()` in `apps/server/src/ai/client.ts` anbinden.
- Die Route oder Service-Schicht uebergibt dabei immer explizit einen `taskType`.
- `GET /api/config` liefert mit `aiModelRouting` und `aiUseCaseRouting` eine kompakte Sicht auf aktive Task- und Use-Case-Zuordnungen.
