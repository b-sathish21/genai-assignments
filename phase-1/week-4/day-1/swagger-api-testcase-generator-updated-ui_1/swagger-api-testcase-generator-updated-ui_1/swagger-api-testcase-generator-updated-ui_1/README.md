# Swagger API Testcase Generator

Upload an OpenAPI/Swagger document, validate it, auto-correct it, generate API test cases with Inception Labs Mercury, and export the results as JSON, Excel, a corrected Swagger file, or a Postman collection.

**Stack:** React 19 + Vite (frontend) → Express 5 + TypeScript (backend) → Inception Labs Mercury API (OpenAI-compatible chat completions), all in-memory (no database).

```
frontend/  React SPA (Vite dev server on :5173, proxies /api → :4000)
backend/   Express API (listens on :4000)
```

---

## 1. End-to-end flow (high level)

```
 ┌─────────────┐  1 upload           ┌──────────────────┐  2 parse+validate   ┌────────────────┐
 │  UploadPanel │ ───────────────────▶│ swagger.controller│────────────────────▶│ swagger.service │
 └─────────────┘   POST /swagger/upload └────────┬─────────┘                    └────────┬────────┘
                                                  │ session.store.set()                    │
                                                  ▼                                        │
                                          ┌───────────────┐                                │
                                          │ session.store  │◀───────────────────────────────┘
                                          └───────┬────────┘
                                                  │
 ┌────────────────┐  3 correct (if invalid)      ▼
 │ ValidationPanel │────────────────────▶ correction.service ──▶ groq.service ──▶ Groq API
 └────────┬────────┘  POST /swagger/correct        (deterministic fixes, then optional LLM repair)
          │
          │ 4 confirm + generate
          ▼
 ┌────────────────┐  POST /confirm-test-generation
 │  App.tsx        │  POST /testcases/generate
 └────────┬────────┘────────────────────▶ testcase.service ──▶ groq.service ──▶ Groq API
          │                                (deterministic cases ⊕ Groq-generated cases, merged/capped)
          ▼
 ┌────────────────┐  5 review + export
 │ TestcasePanel   │────────────────────▶ export.controller / postman.controller
 └────────────────┘  GET /export/{json|excel|swagger|postman}, POST /postman/generate
```

Every step after upload is keyed by an in-memory `sessionId` (UUID) held in `session.store.ts` — nothing is persisted to disk or a database; sessions expire after `SESSION_TTL_MINUTES` (default 60).

---

## 2. Frontend — file by file (`frontend/src`)

| File | Role |
|---|---|
| [main.tsx](frontend/src/main.tsx) | React entry point. Mounts `<App />` into `#root` in `StrictMode`, imports global `styles.css`. |
| [App.tsx](frontend/src/App.tsx) | Top-level state machine for the whole workflow. Holds `sessionId`, `validation`, `correction`, `testCases`, `summary`, `generationSource`, `postmanReady`, `busy`, `notice`. Decides which panel to render (`UploadPanel` → `ValidationPanel` → `TestcasePanel`) based on state, and wires each panel's callbacks to functions in `services/api.ts`. |
| [components/UploadPanel.tsx](frontend/src/components/UploadPanel.tsx) | Step 1 UI. Drag-and-drop or file-picker for `.yaml/.yml/.json`. Calls `onUpload(file)` → `App.handleUpload` → `api.uploadSwagger`. |
| [components/ValidationPanel.tsx](frontend/src/components/ValidationPanel.tsx) | Step 2 UI. Shows the validation report (OpenAPI version, error/warning counts, error list) and, once corrected, the list of applied corrections. Exposes "Correct errors" (→ `handleCorrect`) and "Proceed to generate testcases" (→ `handleGenerate`) buttons. |
| [components/TestcasePanel.tsx](frontend/src/components/TestcasePanel.tsx) | Step 3 UI. Renders the summary metrics, a searchable/filterable table of generated test cases with expandable detail rows (preconditions, steps, expected result, request data), and the download/export action bar (JSON, Excel, Swagger, Postman). |
| [components/StatusPill.tsx](frontend/src/components/StatusPill.tsx) | Small presentational badge (`success`/`danger`/`warning`/`neutral` tone) reused across panels. |
| [components/LeafLogo.tsx](frontend/src/components/LeafLogo.tsx) | Static branding header (Testleaf logo + title). |
| [services/api.ts](frontend/src/services/api.ts) | The **only** place that talks to the backend. Wraps `fetch` calls to every `/api/v1/...` endpoint, unwraps the `{success, data}` / `{success:false, error}` envelope, and throws a plain `Error` on failure so components can catch it uniformly. Base URL is `import.meta.env.VITE_API_BASE_URL` or `/api/v1` (proxied by Vite to `http://localhost:4000` in dev, see [vite.config.ts](frontend/vite.config.ts)). |
| [types/index.ts](frontend/src/types/index.ts) | TypeScript mirrors of the backend's response shapes (`ValidationReport`, `CorrectionReport`, `ApiTestCase`, `TestcaseSummary`) so the UI is type-safe without sharing a package. |

### Frontend call sequence (functions, not just files)

1. `UploadPanel` → `App.handleUpload(file)` → `api.uploadSwagger(file)` → `POST /api/v1/swagger/upload`
2. `ValidationPanel` → `App.handleCorrect()` → `api.correctSwagger(sessionId)` → `POST /api/v1/swagger/correct`
3. `ValidationPanel` → `App.handleGenerate()` → `api.confirmGeneration(sessionId)` → `POST /api/v1/sessions/:id/confirm-test-generation`, then `api.generateTestCases(sessionId, categories)` → `POST /api/v1/testcases/generate`
4. `TestcasePanel` → `App.handlePostman()` → `api.generatePostman(sessionId)` → `POST /api/v1/postman/generate`
5. `TestcasePanel` → `App.handleDownload(type)` → browser navigates to `api.downloadUrl(sessionId, type)` → `GET /api/v1/sessions/:id/export/{json|excel|swagger|postman}`
6. `App.handleClear()` → `api.clearSession(sessionId)` → `DELETE /api/v1/sessions/:id`, then resets all local state.

---

## 3. Backend — file by file (`backend/src`)

### Bootstrap & wiring

| File | Role |
|---|---|
| [server.ts](backend/src/server.ts) | Process entry point. Starts the HTTP server (`app.listen(env.PORT)`), schedules a periodic `sessionStore.cleanup()` every 5 minutes to purge expired sessions, and handles `SIGTERM`/`SIGINT` for graceful shutdown. |
| [app.ts](backend/src/app.ts) | Builds the Express app and its middleware pipeline, in order: request-ID tagging → `pino-http` logging → `helmet` (security headers) → `cors` (origin from `env.CORS_ORIGIN`) → JSON body parsing (2 MB limit) → rate limiting (120 req/min) → mounts `apiRouter` at `/api/v1` → 404 handler → `errorHandler`. |
| [routes/index.ts](backend/src/routes/index.ts) | Declares every REST endpoint and binds it to a controller function. This is the map of the entire public API surface (see table below). |
| [config/environment.ts](backend/src/config/environment.ts) | Loads `.env` via `dotenv`, validates provider settings with Zod, and exports `llmEnabled` when an Inception API key is configured. This flag is the single switch that determines whether the external LLM is called. |

### Endpoint → Controller → Service map

| Method & Path | Controller | Service(s) called | Purpose |
|---|---|---|---|
| `GET /health` | inline in `routes/index.ts` | — | Liveness + reports Inception LLM configuration. |
| `POST /swagger/upload` | [swagger.controller.ts](backend/src/controllers/swagger.controller.ts) `uploadSwagger` | `swagger.service.parseSpecification`, `.validateSpecification` | Parses YAML/JSON, validates via `swagger-parser`, creates a new session. |
| `POST /swagger/validate` | `swagger.controller.ts` `validateSwagger` | `swagger.service.validateSpecification` | Re-validates the session's current spec. |
| `POST /swagger/correct` | `swagger.controller.ts` `correctSwagger` | `correction.service.correctSpecification` (→ `llm.service` if needed) | Deterministically fixes common issues, then (unless `applySafeCorrectionsOnly`) asks Inception Labs to repair remaining errors. |
| `POST /sessions/:sessionId/confirm-test-generation` | [testcase.controller.ts](backend/src/controllers/testcase.controller.ts) `confirmTestGeneration` | — | Gate: requires the spec to already be valid; flips `testGenerationConfirmed`. |
| `POST /testcases/generate` | `testcase.controller.ts` `generateCases` | `testcase.service.generateTestCases` (→ `llm.service`) | Core generation using the configured Inception Labs model. |
| `GET /sessions/:sessionId/testcases` | `testcase.controller.ts` `getCases` | — | Re-fetch previously generated cases for the session. |
| `GET /sessions/:sessionId/summary` | [session.controller.ts](backend/src/controllers/session.controller.ts) `getSummary` | `summary.service.createSessionSummary` | Aggregated dashboard-style summary of the whole session. |
| `POST /postman/generate` | [postman.controller.ts](backend/src/controllers/postman.controller.ts) `generatePostman` | `postman.service.createPostmanCollection` | Converts the active spec to a Postman collection (`openapi-to-postmanv2`). |
| `GET /sessions/:sessionId/export/json` | [export.controller.ts](backend/src/controllers/export.controller.ts) `exportJson` | — | Streams raw JSON of test cases. |
| `GET /sessions/:sessionId/export/excel` | `export.controller.ts` `exportExcel` | `export.service.createExcel` | Streams an `.xlsx` workbook (via `exceljs`). |
| `GET /sessions/:sessionId/export/swagger` | `export.controller.ts` `exportSwagger` | `swagger.service.serializeSpecification` | Streams the corrected spec back as YAML or JSON. |
| `GET /sessions/:sessionId/export/postman` | `export.controller.ts` `exportPostman` | — | Streams the previously generated Postman collection JSON. |
| `DELETE /sessions/:sessionId` | `session.controller.ts` `clearSession` | `session.store.delete` | Removes the session from memory. |

### Services (`backend/src/services`)

| File | Role |
|---|---|
| [swagger.service.ts](backend/src/services/swagger.service.ts) | `parseSpecification` (YAML/JSON → object, using the `yaml` package), `validateSpecification` (runs `@apidevtools/swagger-parser` and collects custom warnings like missing `operationId`), `serializeSpecification` (object → YAML/JSON string for export), `getSpecificationSummary` (title, version, path/operation counts, security scheme count — used in the session summary). |
| [correction.service.ts](backend/src/services/correction.service.ts) | `correctSpecification`: first applies **deterministic** fixes (`applyDeterministicCorrections` — fills missing `info.title`/`info.version`, adds missing `responses`/`description` blocks). If the spec is still invalid and Groq is enabled and the caller didn't request "safe corrections only," it calls `applyGroqCorrection` → `groq.service.callGroqJson` with `CORRECTION_SYSTEM_PROMPT`, parses the LLM's JSON reply against `GroqCorrectionOutputSchema`, and merges the results. Re-validates at the end and returns a `CorrectionReport`. |
| [testcase.service.ts](backend/src/services/testcase.service.ts) | The core generation engine. `deterministicCases()` walks every path/method in the spec and synthesizes one test case per requested category (`positive`, `negative`, `boundary`, `authentication`, `authorization`, `validation`, `error-handling`) using schema-driven sample data (`sampleFromSchema`, `defaultValue`, handles both OpenAPI 3 `requestBody` and Swagger 2 `in: body` parameters). `groqCases()` sends the spec + categories to Groq via `groq.service.callGroqJson` with `TEST_CASE_SYSTEM_PROMPT` and validates the reply against `GroqTestCaseOutputSchema`. `generateTestCases()` orchestrates both: always computes deterministic cases; if Groq is enabled, merges `[...groqCases, ...deterministicCases]` and falls back silently to deterministic-only if the Groq call throws. `finalize()` then deduplicates, applies `limitTestCases` (round-robin cap at `MAX_TEST_CASES`, priority-sorted within each category), and renumbers IDs (`TC-API-001`, …). `summarizeTestCases()` produces the per-category counts shown in the UI. |
| [llm.service.ts](backend/src/services/llm.service.ts) | **The only file that talks to Inception Labs.** `isLlmEnabled()` checks provider configuration. `callLlmJson(systemPrompt, userPrompt)` POSTs to `https://api.inceptionlabs.ai/v1/chat/completions` with Bearer authentication, the configured Mercury model, JSON response format, and the two messages; enforces the configured timeout; parses `choices[0].message.content` as JSON; and wraps provider failures in a typed `AppError`. |
| [prompts.ts](backend/src/services/prompts.ts) | Defines the two system prompts sent to Groq: `TEST_CASE_SYSTEM_PROMPT` (spec-grounded, capped at `env.MAX_TEST_CASES`, strict JSON-only output, "ICEPOT" prompt structure) and `CORRECTION_SYSTEM_PROMPT` (repair OpenAPI documents, JSON-only, must preserve valid operations). |
| [postman.service.ts](backend/src/services/postman.service.ts) | `createPostmanCollection`: wraps the callback-based `openapi-to-postmanv2` converter in a Promise, groups requests by Tags, and optionally injects basic `pm.test(...)` scripts (status < 500, response time recorded) into every request via `addBasicTests`. |
| [export.service.ts](backend/src/services/export.service.ts) | `createExcel`: builds a styled `.xlsx` workbook (via `exceljs`) with one row per test case, frozen header row, alternating row shading, autofilter, and `safeCell()` to neutralize formula-injection characters (`=`, `+`, `-`, `@`) in exported strings. |
| [summary.service.ts](backend/src/services/summary.service.ts) | `createSessionSummary`: combines `swagger.service.getSpecificationSummary`, the validation/correction reports, and `testcase.service.summarizeTestCases` into the single object returned by `GET /sessions/:id/summary`. |

### Supporting layers

| File | Role |
|---|---|
| [store/session.store.ts](backend/src/store/session.store.ts) | In-memory `Map<sessionId, ProcessingSession>`. `get()` lazily evicts expired sessions on read; `cleanup()` sweeps all expired sessions (called from `server.ts` on a timer); `createExpiry()` computes `now + SESSION_TTL_MINUTES`. |
| [middleware/upload.ts](backend/src/middleware/upload.ts) | `multer` config: in-memory storage, `MAX_FILE_SIZE_MB` limit, `fileFilter` restricts to `.yaml/.yml/.json`. |
| [middleware/request-id.ts](backend/src/middleware/request-id.ts) | Assigns/propagates an `x-request-id` header for tracing a request through logs and error responses. |
| [middleware/error-handler.ts](backend/src/middleware/error-handler.ts) | Central Express error handler: `ZodError` → `400 INPUT_VALIDATION_FAILED`; `AppError` → its own status/code/message/details; anything else → logged and `500 INTERNAL_SERVER_ERROR`. Every response includes the `requestId`. |
| [utils/errors.ts](backend/src/utils/errors.ts) | `AppError` class (`statusCode`, `code`, `message`, `details`) — the uniform error type thrown across controllers/services. |
| [utils/logger.ts](backend/src/utils/logger.ts) | `pino` logger; redacts `Authorization` headers and `GROQ_API_KEY`/`apiKey` fields from logs. |
| [schemas/api.schemas.ts](backend/src/schemas/api.schemas.ts) | Zod schemas for every request body/param (`SessionRequestSchema`, `CorrectSwaggerRequestSchema`, `GenerateTestCasesRequestSchema`, `GeneratePostmanRequestSchema`, `TestCaseCategorySchema`, …) — validated inside each controller before touching a service. |
| [schemas/llm.schemas.ts](backend/src/schemas/llm.schemas.ts) | Zod schemas that validate **Groq's JSON responses** before they're trusted: `GroqCorrectionOutputSchema` (`correctedSpecification` + `changes[]`) and `GroqTestCaseOutputSchema` (`testCases[]`, reusing the full `ApiTestCaseSchema` shape). This is what guards the app against a malformed or hallucinated LLM reply. |
| [types/index.ts](backend/src/types/index.ts) | Shared TypeScript types: `JsonObject`, `ValidationIssue/Report`, `CorrectionChange/Report`, `TestCaseCategory`, `ApiTestCase`, `ProcessingSession` (the full session record kept in `session.store.ts`). |
| [types/openapi-to-postmanv2.d.ts](backend/src/types/openapi-to-postmanv2.d.ts) | Ambient type declaration for the untyped `openapi-to-postmanv2` package. |

---

## 4. Detailed request flows

### 4.1 Upload → Validate
```
UploadPanel.tsx (file select)
  → App.handleUpload()
    → api.ts: uploadSwagger(file)                         [POST /api/v1/swagger/upload, multipart]
      → routes/index.ts: upload.single("file") + uploadSwagger controller
        → middleware/upload.ts (multer: size/type checked in memory)
        → swagger.controller.ts: uploadSwagger()
          → swagger.service.ts: parseSpecification()       (YAML/JSON → JsonObject)
          → swagger.service.ts: validateSpecification()    (swagger-parser + custom warnings)
          → session.store.ts: sessionStore.set(...)         (new session created)
        ← 201 { sessionId, fileName, format, status, validationReport }
    ← App stores sessionId/validation, renders ValidationPanel
```

### 4.2 Correct (only if invalid)
```
ValidationPanel.tsx ("Correct errors")
  → App.handleCorrect()
    → api.ts: correctSwagger(sessionId)                    [POST /api/v1/swagger/correct]
      → swagger.controller.ts: correctSwagger()
        → correction.service.ts: correctSpecification()
          → applyDeterministicCorrections()                (fills info/responses)
          → validateSpecification() (re-check)
          → IF still invalid AND groqEnabled AND !safeOnly:
              → applyGroqCorrection()
                → groq.service.ts: callGroqJson(CORRECTION_SYSTEM_PROMPT, {specification, errors})
                  → fetch → https://api.groq.com/openai/v1/chat/completions
                → llm.schemas.ts: GroqCorrectionOutputSchema.parse(response)
          → validateSpecification() (final re-check)
        → session.store.ts: sessionStore.set(session)        (activeSpecification updated)
      ← 200 CorrectionReport { correctionStatus, source, isCorrectedSpecificationValid, changes, remainingErrors }
    ← App merges into `validation`/`correction` state
```

### 4.3 Generate test cases
```
ValidationPanel.tsx ("Proceed to generate testcases")
  → App.handleGenerate()
    → api.ts: confirmGeneration(sessionId)                 [POST /confirm-test-generation]
      → testcase.controller.ts: confirmTestGeneration()     (asserts validationReport.isValid; sets flag)
    → api.ts: generateTestCases(sessionId, categories)      [POST /api/v1/testcases/generate]
      → testcase.controller.ts: generateCases()
        → testcase.service.ts: generateTestCases(spec, categories)
          → deterministicCases(spec, categories)             (always runs — schema-driven synthesis)
          → IF groqEnabled:
              → groqCases(spec, categories)
                → groq.service.ts: callGroqJson(TEST_CASE_SYSTEM_PROMPT, {categories, specification})
                  → fetch → https://api.groq.com/openai/v1/chat/completions
                → llm.schemas.ts: GroqTestCaseOutputSchema.parse(response)
              → merge [...groqCases, ...deterministicCases]  (falls back to deterministic-only on any Groq error)
          → finalize(): deduplicate() → limitTestCases(MAX_TEST_CASES) → renumber()
        → session.store.ts: sessionStore.set(session)         (testCases + generationSource saved)
      ← 200 { sessionId, generationSource, summary, testCases }
    ← App renders TestcasePanel with results
```

### 4.4 Postman & exports
```
TestcasePanel.tsx ("Generate Postman")
  → App.handlePostman() → api.ts: generatePostman(sessionId)  [POST /api/v1/postman/generate]
    → postman.controller.ts → postman.service.ts: createPostmanCollection(spec, includeBasicTests)
      → openapi-to-postmanv2 converter → optional addBasicTests() injection
    → session.store.ts: sessionStore.set(session)              (postmanCollection saved)

TestcasePanel.tsx ("JSON" / "Excel" / "Swagger" / "Postman" download buttons)
  → App.handleDownload(type) → browser navigation to api.downloadUrl(sessionId, type)
    [GET /api/v1/sessions/:id/export/{json|excel|swagger|postman}]
    → export.controller.ts: exportJson | exportExcel (export.service.createExcel) |
                             exportSwagger (swagger.service.serializeSpecification) | exportPostman
    ← file streamed with Content-Disposition: attachment
```

### 4.5 Clear session
```
App.handleClear() → api.ts: clearSession(sessionId) [DELETE /api/v1/sessions/:id]
  → session.controller.ts: clearSession() → session.store.ts: sessionStore.delete(sessionId)
← App resets all local React state back to the initial upload screen
```

---

## 5. Where Inception Labs fits in

Inception Labs is called from exactly **one** module — [llm.service.ts](backend/src/services/llm.service.ts) — and only by two callers:

1. **`correction.service.ts`** — repairs an invalid OpenAPI document when deterministic fixes aren't enough (`CORRECTION_SYSTEM_PROMPT` in [prompts.ts](backend/src/services/prompts.ts)).
2. **`testcase.service.ts`** — augments the deterministic test cases with LLM-generated ones (`TEST_CASE_SYSTEM_PROMPT` in [prompts.ts](backend/src/services/prompts.ts)).

Both callers:
- Skip the provider entirely if `llmEnabled` is `false` because no `INCEPTION_API_KEY` is configured.
- Validate every Inception JSON response with a Zod schema in [llm.schemas.ts](backend/src/schemas/llm.schemas.ts) before trusting it.
- Return a controlled application error for provider failures; testcase generation remains LLM-only.

---

## 6. Running locally

```bash
# Backend
cd backend
# configure INCEPTION_API_KEY and INCEPTION_MODEL in backend/.env to enable LLM features
npm install
npm run dev             # tsx watch, listens on :4000

# Frontend
cd frontend
npm install
npm run dev              # Vite dev server on :5173, proxies /api → :4000
```

Open `http://localhost:5173` and step through Upload → Validate/Correct → Generate → Export.
