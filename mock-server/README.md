# Mock API server

The mock API server is a dev/demo-only HTTP/SSE backend substitute for the Canon Keeper frontend.

## Commands

- `npm run mock:api` starts the mock API on `127.0.0.1:8787` by default.
- `npm run dev:mock` starts both `mock:api` and the Vite dev server. The frontend dev server proxies `/api` to the mock API target.

## Environment

- `MOCK_API_HOST` defaults to `127.0.0.1`.
- `MOCK_API_PORT` defaults to `8787`.
- `MOCK_API_TARGET` defaults to `http://127.0.0.1:8787` for the frontend dev proxy.

## Behavior

- Routes are matched from the generated OpenAPI operation manifest.
- The server uses synthetic in-memory data and resets on server restart.
- Auth uses the OpenAPI cookie model: `ck_session` is issued by login/register and required for protected endpoints.
- `MOCK_RETURN_STATUS` or `mock-return-status` can be sent by tests/dev harnesses to force a safe OpenAPI-shaped error body.
- Chat turns are created with `POST /chats/{chatId}/turns`; deterministic `text/event-stream` frames are read from `GET /chat-turns/{turnId}/events`.

## Safety

- The server binds to localhost by default and does not call external services.
- CORS is local-origin only; no wildcard CORS is emitted.
- Logs include only request id, method, path, status, operation id and duration. They do not include cookies, passwords, request bodies, manuscript text or raw SSE payloads.
