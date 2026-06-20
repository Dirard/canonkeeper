# Canon Keeper

Production-oriented React frontend for Canon Keeper. The app talks to the generated OpenAPI client boundary, while local development can run against a separate HTTP/SSE mock API server.

## Local Development

```powershell
npm install
npm run mock:api
npm run dev
```

`npm run dev` serves the frontend on `127.0.0.1`; the Vite dev proxy forwards `/api/v1` to the mock API. To choose a mock API port explicitly:

```powershell
$env:MOCK_API_PORT='59713'
npm run mock:api
```

Then in another shell:

```powershell
$env:MOCK_API_TARGET='http://127.0.0.1:59713'
npm run dev
```

## Quality Gates

Run these before shipping frontend changes:

```powershell
npm run api:generate
npm run api:check
npm run contract:check
npm run architecture:check
npm run typecheck
npm run lint
npm run test
npm run build
```

`contracts/openapi.json` is the canonical API contract. Generated files under `src/shared/api/generated` must be refreshed with `npm run api:generate` and verified with `npm run api:check`.

## Mock API Notes

- The mock server is local-only development/test infrastructure, not a product runtime fallback.
- Auth uses the OpenAPI cookie session shape; local proof logs must not store passwords, cookies, tokens, request bodies or raw SSE frames.
- Chat streaming uses `POST /api/v1/chats/{chatId}/messages` with `text/event-stream`.
- Import/export use deterministic fake metadata/jobs/URLs in this frontend repair; real parsing, storage and file generation are backend scope.
- `MOCK_RETURN_STATUS` and `mock_return_status` are test harness controls only. Do not expose scenario/reset/debug controls in the product UI.

## Evidence

The Supergoal repair evidence lives under `.supergoal/new-repair-run-for-production-ready-main-Ptuv5B`. The final proof matrix, visual screenshots, browser smoke proof, command logs and audit files are stored there for review.
