# Canon Keeper API Contract

`contracts/openapi.json` is the canonical frontend/backend contract for Canon Keeper.

The frontend may use local mock data for now, but mocks should keep the same resource names, IDs, request shapes, and response shapes as this OpenAPI document. When the backend is built, it should implement this contract rather than forcing the frontend to invent API shapes retroactively.

## Contract Boundaries

- The contract covers the backend-owned product surfaces: auth, projects, project membership/invitations, books, imports/indexing/export through shared jobs, chapters, draft publishing, reader locators, reader annotations, chat sessions/messages, chat turns with resumable events, search, and backend-created agent diff suggestions.
- The contract does not require a real backend, database, LLM, vector index, storage bucket, or auth provider during frontend-only work.
- Chat responses are created as turns: `POST /chats/{chatId}/turns` starts durable work, `GET /chat-turns/{turnId}` recovers state, and `GET /chat-turns/{turnId}/events` streams resumable SSE frames.
- Chat turn stream frames carry `ChatTurnEventEnvelope` payloads with `eventId`, `sequence`, `turnId`, `jobId`, `type`, and structured `data`; `Last-Event-ID` or `afterEventId` resumes from the durable event log.
- Assistant references are persisted as artifacts, suggestions, or structured event payloads. Canonical payloads do not rely on parsing magic directives out of assistant text.
- Persisted chat history may include structured reference lists for legacy records, but text directives are not part of the transport contract.
- Reader links are represented by `ReaderLocator`; chat reference artifacts, search results, reader annotations, and agent suggestion diffs should all navigate through that shared shape.
- Reader reference artifacts use `ReaderReferenceLocator`, which requires `paragraphId` for stable scroll/highlight behavior.
- Project summaries include `bookCount`, `chapterCount`, and `wordCount` for shell stats such as `4 книги · 186 глав · 1.2M слов`.
- Books are ordered project volumes with one-based `order` and stable `displayNumber`; clients derive local labels like `Книга II` without title parsing.
- Chapter lists are lightweight `ChapterSummary` structures for backend navigation; full `Chapter` payloads with paragraphs come from `/chapters/{chapterId}`.
- Full `Chapter` payloads include `navigation` metadata for previous/next chapter summaries, progress, display number, and estimated read time.
- `ChapterNavigation.previous` and `ChapterNavigation.next` include renderable chapter title/labels; the raw previous/next IDs remain available.
- Chapter content is paragraph-based. Stable book references should prefer `bookId`, `chapterId`, and `paragraphId`; text ranges are optional precision data inside a paragraph.
- Draft saves use `ChapterParagraphInput`: existing paragraphs keep backend IDs, new paragraphs omit `id`, and the backend returns stable paragraph IDs after save/indexing.
- Draft formatting uses the backend-owned manuscript markdown profile shared by saved paragraphs and draft update commands.
- Draft editing and publishing are separate from content selection: `Chapter.contentVariant` selects published/draft payloads, while `Chapter.status` and publish endpoints model lifecycle and conflicts.
- `ReaderLocator.targetView` and required `revision` disambiguate published text from draft text.
- Reader annotations cover highlights, notes, and bookmarks through one backend resource with `oneOf + discriminator` validation for response and write shapes. Notes/bookmarks may be chapter-level via `ReaderLocator`; highlights require paragraph-level `ReaderReferenceLocator`.
- Import constraints are machine-readable: `.fb2`, `.epub`, and 50 MB max file size are exposed for client-side preflight checks and enforced by backend errors including `415`.
- Import/indexing/export progress uses the shared `Job` lifecycle. Start commands return `JobStartResponse`; clients list/read/cancel through `/projects/{projectId}/jobs`, `/jobs/{jobId}`, and `/jobs/{jobId}/cancel`.
- Export is asynchronous: create an export job, poll the shared job resource, then use the job result link when the job is ready. Export artifacts are `no-store/private` and expire quickly.
- Agent suggestions are not client-created artifacts. The backend/agent runtime creates them, and the client can `GET`, `approve`, or `reject` them.
- Agent chat requests carry backend-neutral `agentOptions` and `contextLocators`; clients submit explicit task, scope, and context resources without provider or UI widget semantics.
- Agent diff hunks use `AgentDiffLocator`, which anchors each hunk to chapter, paragraph, revision, target view, and text range.
- Persisted chat message parts keep visible text plus bounded render metadata (`sequence`, `status`, `label`, `metadata`) without replaying SSE or exposing internal runtime traces.
- Approving an agent suggestion is revision-guarded with `expectedChapterRevision`.
- Protected project endpoints use provider-neutral same-origin `sessionAuth` and project membership. `401` means missing/invalid session; `403` means an authenticated project member lacks the required role; cross-tenant or non-member direct resource IDs return leak-safe `404`. The contract intentionally avoids JWT/OAuth/refresh-token mechanics.
- Password reset and Google sign-in visible in auth screens are frontend placeholders until the backend auth provider is selected; the contract intentionally avoids JWT/OAuth/refresh-token mechanics.
- Reader display settings are client preferences unless a later backend task explicitly adds preference sync.

## Validation

Run:

```bash
npm run contract:check
```

The check is intentionally dependency-free: it verifies JSON syntax, required contract coverage, and local `$ref` resolution. A stricter OpenAPI linter can be added later when the backend stack is selected.
