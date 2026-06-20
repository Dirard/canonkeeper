# Canon Keeper API Contract

`contracts/openapi.json` is the canonical frontend/backend contract for Canon Keeper.

The frontend may use local mock data for now, but mocks should keep the same resource names, IDs, request shapes, and response shapes as this OpenAPI document. When the backend is built, it should implement this contract rather than forcing the frontend to invent API shapes retroactively.

## Contract Boundaries

- The contract covers the frozen design surfaces: auth, projects/sagas, books, imports/indexing, chapters, draft publishing, reader locators, reader annotations, chat sessions/messages, search, and backend-created agent diff suggestions.
- The contract does not require a real backend, database, LLM, vector index, storage bucket, or auth provider during frontend-only work.
- Chat streaming is ordinary LLM streaming over `text/event-stream`: text deltas, reasoning/tool-call events, completion, and errors using the `LlmStreamEvent` vocabulary. Product-specific objects are not custom SSE events.
- Stream events are typed by `type`: text/reasoning deltas require `delta`, tool events require `toolCallId`/`toolName`, completed events require `assistantMessageId`/`turnId`, and errors require a display-safe `message`.
- Assistant text may contain trigger markers such as `::ck-trigger{kind="reader_references" artifactId="..."}` or `::ck-trigger{kind="agent_suggestions_ready" chapterId="..."}`. The client detects the marker and calls the relevant endpoint.
- `ChatTrigger` is typed by `kind`: reader-reference triggers require `artifactId`, while suggestion-ready triggers require `chapterId` plus `suggestionBatchId` or non-empty `suggestionIds`.
- `agent_suggestions_ready` triggers include `suggestionBatchId` and/or `suggestionIds`; list endpoints support filters so the UI can fetch suggestions created by the current assistant turn.
- Reader links are represented by `ReaderLocator`; chat reference artifacts, search results, reader annotations, and agent suggestion diffs should all navigate through that shared shape.
- Reader reference artifacts use `ReaderReferenceLocator`, which requires `paragraphId` for stable scroll/highlight behavior.
- Project summaries include `bookCount`, `chapterCount`, and `wordCount` for shell stats such as `4 книги · 186 глав · 1.2M слов`.
- Books are ordered saga volumes with `order`, `displayNumber`, and `displayLabel` so UI labels like `Книга II` never require title parsing.
- Chapter lists are lightweight `ChapterSummary` structures for sidebars/TOC; full `Chapter` payloads with paragraphs come from `/chapters/{chapterId}`.
- Full `Chapter` payloads include `navigation` metadata for previous/next chapter controls, reading progress, display number, and estimated reading time.
- `ChapterNavigation.previous` and `ChapterNavigation.next` include renderable chapter title/labels for reader footer controls; the raw previous/next IDs remain available.
- Chapter content is paragraph-based. Stable book references should prefer `bookId`, `chapterId`, and `paragraphId`; text ranges are optional precision data inside a paragraph.
- Draft saves use `ChapterParagraphInput`: existing paragraphs keep backend IDs, new paragraphs may send a temporary `clientKey`, and the backend returns stable paragraph IDs after save/indexing.
- Draft formatting is represented by a supported markdown subset for the toolbar actions visible in the design.
- Draft editing and publishing are separate from reader view mode: `Chapter.viewMode` selects reading/draft payloads, while `Chapter.status` and publish endpoints model lifecycle and conflicts.
- `ReaderLocator.targetView` and optional `revision` disambiguate published reading text from draft text.
- Reader annotations cover highlights, notes, and bookmarks through one backend resource with `oneOf + discriminator` validation for response and write shapes. Notes/bookmarks may be chapter-level via `ReaderLocator`; highlights require paragraph-level `ReaderReferenceLocator`.
- Import constraints are machine-readable: `.fb2`, `.epub`, and 50 MB max file size are exposed for dropzone validation and enforced by backend errors including `415`.
- Import/indexing progress exposes structured stage/current/total/cancel fields for banners and book-card badges.
- Export is asynchronous: create an export job, poll `/export-jobs/{exportJobId}`, then use `downloadUrl` when the job is ready.
- Agent suggestions are not client-created artifacts. The backend/agent runtime creates them, and the client can `GET`, `approve`, or `reject` them.
- Agent chat requests carry provider-neutral `agentOptions` and `contextLocators`; the client chooses visible task/scope/context, but does not depend on a specific LLM provider.
- Agent diff hunks use `AgentDiffLocator`, which anchors each hunk to chapter, paragraph, revision, target view, and text range.
- Persisted chat message parts keep stream-like ordering and status (`sequence`, `toolCallId`, `status`, `label`, `metadata`) so reloaded history can render reasoning/tools/text without replaying SSE.
- Approving an agent suggestion is revision-guarded with `expectedChapterRevision`.
- Protected workspace endpoints use provider-neutral same-origin `sessionAuth` and project ownership. `401` means missing/invalid session; `403` means authenticated but not allowed for the requested project resource, and protected operations explicitly list `403`. The contract intentionally avoids JWT/OAuth/refresh-token mechanics.
- Password reset and Google sign-in visible in auth screens are frontend placeholders until the backend auth provider is selected; the contract intentionally avoids JWT/OAuth/refresh-token mechanics.
- Reader display settings are client preferences unless a later backend task explicitly adds preference sync.

## Validation

Run:

```bash
npm run contract:check
```

The check is intentionally dependency-free: it verifies JSON syntax, required contract coverage, and local `$ref` resolution. A stricter OpenAPI linter can be added later when the backend stack is selected.
