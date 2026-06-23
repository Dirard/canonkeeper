# Backend-first OpenAPI Review Matrix

## Summary Counters

- review_rows = 394
- scenario_rows = 15
- baseline_scenarios = 15
- missing_scenario_rows = 0
- duplicate_scenario_rows = 0
- extra_scenario_rows = 0
- old_operation_rows = 45
- old_schema_rows = 102
- final_operation_rows = 57
- missing_final_operation_rows = 0
- final_schema_rows = 118
- missing_final_schema_rows = 0
- policy_rows = 57
- missing_policy_rows = 0
- ui_only_rows = 0
- unresolved_overlap_rows = 0
- missing_proof_notes = 0
- unresolved = 0

## Scenario Coverage Matrix

| scenario_id | source_ref | actor | operationId/path | request schema | success response | auth/authz rule | negative statuses | retry/idempotency/revision | async/SSE/job semantics | proof note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SCN-AUTH-SESSION | SPEC: OpenAPI Security/Data Contract Requirements | anonymous/authenticated | getCsrfToken; registerUser; loginUser; logoutUser; getCurrentUser; rotateSession | CsrfTokenResponse; AuthSession; Problem | 200/201/204 | non-enumerating auth errors; no-store; CSRF before cookie mutation | 400/401/403/409/429 | session rotation; CSRF refresh | n/a | pass: auth/session surface source-anchored in OpenAPI |
| SCN-MEMBERS-INVITES | SPEC: Backend Resource Model Baseline | owner/admin/invited/authenticated | listProjectMembers; updateProjectMemberRole; removeProjectMember; listProjectInvitations; listMyProjectInvitations; createProjectInvitation; cancelProjectInvitation; acceptProjectInvitation | ProjectMembership; ProjectInvitation | 200/201/204 | project membership tenant boundary; owner membership immutable | 401/403/404/409/429 | CSRF on mutations; owner demotion/removal returns 409 | n/a | pass: project invitations have verified-email acceptance, invitee project/inviter context and no raw token responses |
| SCN-PROJECTS | SPEC: Backend Resource Model Baseline | viewer/editor/admin/owner | listProjects; createProject; getProject; updateProject; deleteProject | Project | 200/201/204 | direct IDs resolve through membership; deleteProject owner/admin only; cross-project 404 | 401/403/404/409/429 | expectedRevision where mutating body supports it | n/a | pass: project resource boundary preserved |
| SCN-BOOKS-CHAPTERS | SPEC: Backend Resource Model Baseline | viewer/editor/admin/owner | listBooks; createBook; getBook; updateBook; deleteBook; listChapters; createChapter; getChapter; updateChapter; publishChapter; deleteChapter | Book; Chapter; ChapterList | 200/201/204 | project-scoped membership | 401/403/404/409/429 | expectedRevision for revision-sensitive mutations | n/a | pass: books/chapters resource model stays canonical |
| SCN-READER-NAV | SPEC: Revision And Locator Rules | viewer/editor/admin/owner | getChapter; listChapters | ReaderLocator; ReaderReferenceLocator; ChapterNavigation | 200 | bounded content-read only | 401/403/404/409 | revision-aware locators | n/a | pass: locator schemas remain revision-aware |
| SCN-ANNOTATIONS | SPEC: Revision And Locator Rules | viewer/editor/admin/owner | listChapterAnnotations; createChapterAnnotation; updateReaderAnnotation; deleteReaderAnnotation | ReaderAnnotation; CreateReaderAnnotationRequest | 200/201/204 | project-scoped annotation access | 401/403/404/409/429 | locator revision conflict via 409 Problem | n/a | pass: annotation surfaces preserved |
| SCN-SEARCH | SPEC: Command, Query And Job Rules | viewer/editor/admin/owner | searchProject POST /projects/{projectId}/search | SearchProjectRequest; SearchResponse | 200 | private text in body; no URL leakage | 400/401/403/404/429 | cursor fingerprint returns 400 on mismatch; not idempotency-keyed | n/a | pass: POST search keeps private text in body and requires CSRF because it uses unsafe POST |
| SCN-IMPORT | SPEC: Command, Query And Job Rules | editor/admin/owner | getImportConstraints; importBookFile | ImportBookRequest; ImportConstraints; JobStartResponse; Job | 200/202 | project membership and upload abuse controls | 400/401/403/404/409/413/415/422/429 | Idempotency-Key duplicate/mismatch | shared job start semantics | pass: direct multipart source model, URL fetch out of scope |
| SCN-EXPORT-INDEX-JOBS | SPEC: Command, Query And Job Rules | owner/admin start export/index; editor start indexing; viewer list/read own-visible jobs | startProjectIndexing; createBookExport; listProjectJobs; getJob; cancelJob | Job; JobStartResponse | 200/202 | owner/admin full export; shared job direct-ID 404 | 401/403/404/409/429 | Idempotency-Key for start commands; idempotent cancel | shared Job lifecycle only | pass: typed job endpoints removed from final operation set |
| SCN-CHAT-TURNS-SSE | SPEC: Command, Query And Job Rules | editor/admin/owner create; viewer read | createChatTurn; getChatTurn; streamChatTurnEvents | ChatTurnStartRequest; ChatTurnStartResponse; ChatTurnSnapshot; ChatTurnEventEnvelope | 200/202 | project chat membership | 400/401/403/404/409/410/429 | Idempotency-Key duplicate/mismatch; Last-Event-ID/afterEventId resume | SSE stream, expiry and poll fallback | pass: mixed POST stream removed from final operation set |
| SCN-ARTIFACTS | SPEC: Command, Query And Job Rules | viewer/editor/admin/owner | getChatArtifact | ChatArtifact | 200 | project-scoped artifact read; no raw provider traces | 401/403/404/429 | n/a | persisted resource | pass: artifacts remain canonical resources |
| SCN-AGENT-SUGGESTIONS | SPEC: Command, Query And Job Rules | editor/admin/owner run/apply; viewer read | startAgentRun; listAgentSuggestions; getAgentSuggestion; approveAgentSuggestion; rejectAgentSuggestion | AgentRunRequest; AgentRunStartResponse; AgentSuggestion; RejectAgentSuggestionRequest | 200/202 | project/chapter membership; editor+ mutations | 401/403/404/409/429 | Idempotency-Key for runs; expectedRevision conflict guard | shared Job for runs | pass: suggestions are persisted resources with locator/revision semantics |
| SCN-CONFLICT-RETRY-ERRORS | SPEC: API Policy Decisions | all actors | all mutating/idempotent operations | Problem | 4xx | stable problem code/requestId | 400/401/403/404/409/429 | idempotency mismatch; cursor mismatch; revision conflict | n/a | pass: shared Problem and response parity checked |
| SCN-DATA-GOVERNANCE | SPEC: OpenAPI Security/Data Contract Requirements | all actors/internal | all protected operations | security matrix rows | n/a | no raw secrets/manuscript/provider traces; no-store customer content | 401/403/404/409/429 | audit/rate-limit/deletion rows | n/a | pass: security matrix covers audit/deletion/data exposure |
| SCN-GENERATED-BOUNDARY | SPEC: Proof Package And Contract Gates | developer | operationManifest; api:generate; api:check; contract:check | generated openapi.ts; operation-manifest.ts | n/a | OpenAPI source of truth | n/a | manifest exact set | n/a | pass: contract check verifies operationId uniqueness and generated parity when generated files exist |

## Endpoint Inventory Diff

| old method | old path | old operationId | status | replacement | reason | affected frontend/generated/mock/test surface |
| --- | --- | --- | --- | --- | --- | --- |
| POST | /auth/register | registerUser | keep | registerUser POST /auth/register | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| POST | /auth/login | loginUser | keep | loginUser POST /auth/login | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| POST | /auth/logout | logoutUser | keep | logoutUser POST /auth/logout | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| GET | /auth/me | getCurrentUser | rename | getCurrentUser GET /auth/session | auth session renamed from /auth/me to stable session resource | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| GET | /projects | listProjects | keep | listProjects GET /projects | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| POST | /projects | createProject | keep | createProject POST /projects | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| GET | /projects/{projectId} | getProject | keep | getProject GET /projects/{projectId} | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| PATCH | /projects/{projectId} | updateProject | keep | updateProject PATCH /projects/{projectId} | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| DELETE | /projects/{projectId} | deleteProject | keep | deleteProject DELETE /projects/{projectId} | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| GET | /projects/{projectId}/books | listBooks | keep | listBooks GET /projects/{projectId}/books | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| POST | /projects/{projectId}/books | createBook | keep | createBook POST /projects/{projectId}/books | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| GET | /books/{bookId} | getBook | keep | getBook GET /books/{bookId} | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| PATCH | /books/{bookId} | updateBook | keep | updateBook PATCH /books/{bookId} | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| DELETE | /books/{bookId} | deleteBook | keep | deleteBook DELETE /books/{bookId} | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| GET | /projects/{projectId}/import-constraints | getImportConstraints | keep | getImportConstraints GET /projects/{projectId}/import-constraints | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| POST | /projects/{projectId}/imports | importBookFile | keep | importBookFile POST /projects/{projectId}/imports | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| GET | /projects/{projectId}/indexing-jobs | listIndexingJobs | merge | listProjectJobs GET /projects/{projectId}/jobs?kind=indexing | typed indexing list converges on shared project jobs filtered by kind | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| GET | /indexing-jobs/{jobId} | getIndexingJob | merge | getJob GET /jobs/{jobId} | typed job read converges on shared Job lifecycle | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| POST | /indexing-jobs/{jobId}/cancel | cancelIndexingJob | merge | cancelJob POST /jobs/{jobId}/cancel | typed cancel converges on shared idempotent cancel | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| POST | /books/{bookId}/exports | createBookExport | keep | createBookExport POST /books/{bookId}/exports | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| GET | /export-jobs/{exportJobId} | getExportJob | merge | getJob GET /jobs/{jobId} | export job read converges on shared Job lifecycle | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| GET | /books/{bookId}/chapters | listChapters | keep | listChapters GET /books/{bookId}/chapters | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| POST | /books/{bookId}/chapters | createChapter | keep | createChapter POST /books/{bookId}/chapters | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| GET | /chapters/{chapterId} | getChapter | keep | getChapter GET /chapters/{chapterId} | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| PATCH | /chapters/{chapterId} | updateChapter | keep | updateChapter PATCH /chapters/{chapterId} | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| DELETE | /chapters/{chapterId} | deleteChapter | keep | deleteChapter DELETE /chapters/{chapterId} | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| POST | /chapters/{chapterId}/publish | publishChapter | keep | publishChapter POST /chapters/{chapterId}/publish | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| GET | /chapters/{chapterId}/annotations | listChapterAnnotations | keep | listChapterAnnotations GET /chapters/{chapterId}/annotations | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| POST | /chapters/{chapterId}/annotations | createChapterAnnotation | keep | createChapterAnnotation POST /chapters/{chapterId}/annotations | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| PATCH | /annotations/{annotationId} | updateReaderAnnotation | keep | updateReaderAnnotation PATCH /annotations/{annotationId} | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| DELETE | /annotations/{annotationId} | deleteReaderAnnotation | keep | deleteReaderAnnotation DELETE /annotations/{annotationId} | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| GET | /projects/{projectId}/search | searchProject | rename | searchProject POST /projects/{projectId}/search | private query text moved from URL to request body | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| GET | /projects/{projectId}/chats | listChatSessions | keep | listChatSessions GET /projects/{projectId}/chats | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| POST | /projects/{projectId}/chats | createChatSession | keep | createChatSession POST /projects/{projectId}/chats | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| GET | /chats/{chatId} | getChatSession | keep | getChatSession GET /chats/{chatId} | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| PATCH | /chats/{chatId} | renameChatSession | keep | renameChatSession PATCH /chats/{chatId} | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| DELETE | /chats/{chatId} | deleteChatSession | keep | deleteChatSession DELETE /chats/{chatId} | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| GET | /chats/{chatId}/messages | listChatMessages | keep | listChatMessages GET /chats/{chatId}/messages | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| POST | /chats/{chatId}/messages | sendChatMessage | merge | createChatTurn + streamChatTurnEvents | mixed POST stream split into command plus resumable SSE stream | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| GET | /chat-artifacts/{artifactId} | getChatArtifact | keep | getChatArtifact GET /chat-artifacts/{artifactId} | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| GET | /chapters/{chapterId}/agent-suggestions | listAgentSuggestions | keep | listAgentSuggestions GET /chapters/{chapterId}/agent-suggestions | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| POST | /chapters/{chapterId}/agent-suggestions | requestAgentSuggestion | merge | startAgentRun POST /chapters/{chapterId}/agent-runs | synchronous suggestion command converges on shared agent-run Job lifecycle | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| GET | /agent-suggestions/{suggestionId} | getAgentSuggestion | keep | getAgentSuggestion GET /agent-suggestions/{suggestionId} | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| POST | /agent-suggestions/{suggestionId}/approve | approveAgentSuggestion | keep | approveAgentSuggestion POST /agent-suggestions/{suggestionId}/approve | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |
| POST | /agent-suggestions/{suggestionId}/reject | rejectAgentSuggestion | keep | rejectAgentSuggestion POST /agent-suggestions/{suggestionId}/reject | kept because it maps to a stable backend resource/command/query boundary | generated types; operation manifest; mock-server handlers; API adapter methods; tests as needed |

## Final Operation Inventory

| operationId | method/path | purpose | proof |
| --- | --- | --- | --- |
| acceptProjectInvitation | POST /project-invitations/{invitationId}/accept | resource/command | backend reason: invitation command binds authenticated verified email to a discovered pending project invite id; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| approveAgentSuggestion | POST /agent-suggestions/{suggestionId}/approve | resource/command | backend reason: approve a backend-created agent suggestion as a backend state transition with auth, audit and Problem responses; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| cancelJob | POST /jobs/{jobId}/cancel | command/job | backend reason: cancel shared job under the shared async Job lifecycle; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| cancelProjectInvitation | POST /project-invitations/{invitationId}/cancel | resource/command | backend reason: cancel project invitation as a backend state transition with auth, audit and Problem responses; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| createBook | POST /projects/{projectId}/books | resource/command | backend reason: create a book inside a project as a backend state transition with auth, audit and Problem responses; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| createBookExport | POST /books/{bookId}/exports | command/job | backend reason: start a book export job under the shared async Job lifecycle; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| createChapter | POST /books/{bookId}/chapters | resource/command | backend reason: create a new chapter as a backend state transition with auth, audit and Problem responses; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| createChapterAnnotation | POST /chapters/{chapterId}/annotations | resource/command | backend reason: create a reader annotation anchored to a locator as a backend state transition with auth, audit and Problem responses; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| createChatSession | POST /projects/{projectId}/chats | resource/command | backend reason: create a chat session as a backend state transition with auth, audit and Problem responses; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| createChatTurn | POST /chats/{chatId}/turns | command/job | backend reason: create chat turn under the shared async Job lifecycle; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| createProject | POST /projects | resource/command | backend reason: create a new project as a backend state transition with auth, audit and Problem responses; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| createProjectInvitation | POST /projects/{projectId}/invitations | resource/command | backend reason: create project invitation as a backend state transition with auth, audit and Problem responses; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| deleteBook | DELETE /books/{bookId} | resource/command | backend reason: delete a book as a backend state transition with auth, audit and Problem responses; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| deleteChapter | DELETE /chapters/{chapterId} | resource/command | backend reason: delete a chapter as a backend state transition with auth, audit and Problem responses; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| deleteChatSession | DELETE /chats/{chatId} | resource/command | backend reason: delete a chat session as a backend state transition with auth, audit and Problem responses; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| deleteProject | DELETE /projects/{projectId} | resource/command | backend reason: delete a project as a backend state transition with auth, audit and Problem responses; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| deleteReaderAnnotation | DELETE /annotations/{annotationId} | resource/command | backend reason: delete a reader annotation as a backend state transition with auth, audit and Problem responses; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| getAgentSuggestion | GET /agent-suggestions/{suggestionId} | resource/query | backend reason: get one backend-created agent suggestion as a tenant/auth-scoped backend read model; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| getBook | GET /books/{bookId} | resource/query | backend reason: get a book with current indexing status as a tenant/auth-scoped backend read model; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| getChapter | GET /chapters/{chapterId} | resource/query | backend reason: get chapter content for published or draft editing as a tenant/auth-scoped backend read model; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| getChatArtifact | GET /chat-artifacts/{artifactId} | resource/query | backend reason: get chat reader-reference artifact as a tenant/auth-scoped backend read model; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| getChatSession | GET /chats/{chatId} | resource/query | backend reason: get chat metadata as a tenant/auth-scoped backend read model; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| getChatTurn | GET /chat-turns/{turnId} | resource/query | backend reason: read chat turn snapshot as a tenant/auth-scoped backend read model; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| getCsrfToken | GET /auth/csrf | resource/query | backend reason: bootstrap csrf token as a tenant/auth-scoped backend read model; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| getCurrentUser | GET /auth/session | resource/query | backend reason: read sanitized auth session as a tenant/auth-scoped backend read model; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| getImportConstraints | GET /projects/{projectId}/import-constraints | resource/query | backend reason: return machine-readable import constraints as a tenant/auth-scoped backend read model; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| getJob | GET /jobs/{jobId} | resource/query | backend reason: read shared job as a tenant/auth-scoped backend read model; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| getProject | GET /projects/{projectId} | resource/query | backend reason: get a project shell summary as a tenant/auth-scoped backend read model; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| importBookFile | POST /projects/{projectId}/imports | command/job | backend reason: import manuscript file under the shared async Job lifecycle; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| listAgentSuggestions | GET /chapters/{chapterId}/agent-suggestions | resource/query | backend reason: list draft agent suggestions for a chapter as a tenant/auth-scoped backend read model; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| listBooks | GET /projects/{projectId}/books | resource/query | backend reason: list books in a project shelf as a tenant/auth-scoped backend read model; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| listChapterAnnotations | GET /chapters/{chapterId}/annotations | resource/query | backend reason: list reader annotations anchored to a chapter as a tenant/auth-scoped backend read model; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| listChapters | GET /books/{bookId}/chapters | resource/query | backend reason: list chapter structure for a book as a tenant/auth-scoped backend read model; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| listChatMessages | GET /chats/{chatId}/messages | resource/query | backend reason: list messages in a chat session as a tenant/auth-scoped backend read model; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| listChatSessions | GET /projects/{projectId}/chats | resource/query | backend reason: list chat sessions for a project as a tenant/auth-scoped backend read model; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| listMyProjectInvitations | GET /project-invitations | resource/query | backend reason: verified-email invitation discovery lists only opaque invitation ids plus leak-safe project/inviter context addressed to the authenticated user; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| listProjectInvitations | GET /projects/{projectId}/invitations | resource/query | backend reason: list project invitations as a tenant/auth-scoped backend read model; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| listProjectJobs | GET /projects/{projectId}/jobs | resource/query | backend reason: list shared project jobs as a tenant/auth-scoped backend read model; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| listProjectMembers | GET /projects/{projectId}/members | resource/query | backend reason: list project members as a tenant/auth-scoped backend read model; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| listProjects | GET /projects | resource/query | backend reason: list projects available to the user as a tenant/auth-scoped backend read model; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| loginUser | POST /auth/login | resource/command | backend reason: authenticate with email and password as a backend state transition with auth, audit and Problem responses; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| logoutUser | POST /auth/logout | resource/command | backend reason: invalidate the current session as a backend state transition with auth, audit and Problem responses; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| publishChapter | POST /chapters/{chapterId}/publish | resource/command | backend reason: publish the current draft revision into the reader version as a backend state transition with auth, audit and Problem responses; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| registerUser | POST /auth/register | resource/command | backend reason: create a user account as a backend state transition with auth, audit and Problem responses; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| rejectAgentSuggestion | POST /agent-suggestions/{suggestionId}/reject | resource/command | backend reason: reject a backend-created agent suggestion as a backend state transition with auth, audit and Problem responses; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| removeProjectMember | DELETE /projects/{projectId}/members/{memberId} | resource/command | backend reason: remove project member as a backend state transition with auth, audit and Problem responses; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| renameChatSession | PATCH /chats/{chatId} | resource/command | backend reason: rename a chat session as a backend state transition with auth, audit and Problem responses; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| rotateSession | POST /auth/session/rotate | resource/command | backend reason: rotate active session as a backend state transition with auth, audit and Problem responses; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| searchProject | POST /projects/{projectId}/search | query | backend reason: search private project content as a tenant/auth-scoped backend read model; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| startAgentRun | POST /chapters/{chapterId}/agent-runs | resource/command | backend reason: start agent run as a backend state transition with auth, audit and Problem responses; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| startProjectIndexing | POST /projects/{projectId}/indexing-runs | resource/command | backend reason: start project indexing or reindexing as a backend state transition with auth, audit and Problem responses; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| streamChatTurnEvents | GET /chat-turns/{turnId}/events | stream | backend reason: stream chat turn events as resumable backend event delivery; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| updateBook | PATCH /books/{bookId} | resource/command | backend reason: rename or update book metadata as a backend state transition with auth, audit and Problem responses; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| updateChapter | PATCH /chapters/{chapterId} | resource/command | backend reason: save chapter title, draft body, or ordering metadata as a backend state transition with auth, audit and Problem responses; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| updateProject | PATCH /projects/{projectId} | resource/command | backend reason: rename or update project metadata as a backend state transition with auth, audit and Problem responses; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| updateProjectMemberRole | PATCH /projects/{projectId}/members/{memberId} | resource/command | backend reason: update member role as a backend state transition with auth, audit and Problem responses; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |
| updateReaderAnnotation | PATCH /annotations/{annotationId} | resource/command | backend reason: edit a reader annotation as a backend state transition with auth, audit and Problem responses; no UI-only: operation is categorized by resource/query/command/job/stream semantics and exposes ids, status, links or bounded payloads, not component state |

## Schema Component Inventory Diff

| old schema/component | status | replacement | reason | affected generated/mock/test/API-adapter surface |
| --- | --- | --- | --- | --- |
| AgentDiffLocator | keep | AgentDiffLocator | still maps to product resource/value object or request/response shape | generated types |
| AgentOptions | keep | AgentOptions | still maps to product resource/value object or request/response shape | generated types |
| AgentSuggestion | keep | AgentSuggestion | still maps to product resource/value object or request/response shape | generated types |
| AgentSuggestionActionResult | keep | AgentSuggestionActionResult | still maps to product resource/value object or request/response shape | generated types |
| AgentSuggestionKind | keep | AgentSuggestionKind | still maps to product resource/value object or request/response shape | generated types |
| AgentSuggestionList | keep | AgentSuggestionList | still maps to product resource/value object or request/response shape | generated types |
| AgentSuggestionStatus | keep | AgentSuggestionStatus | still maps to product resource/value object or request/response shape | generated types |
| AgentSuggestionsReadyChatTrigger | merge | AgentSuggestionsChatMessageReference | canonical message references replace text trigger marker schemas | generated types; mock repository; chat API adapter tests |
| AgentTask | keep | AgentTask | still maps to product resource/value object or request/response shape | generated types |
| ApproveAgentSuggestionRequest | keep | ApproveAgentSuggestionRequest | still maps to product resource/value object or request/response shape | generated types |
| AuthSession | keep | AuthSession | still maps to product resource/value object or request/response shape | generated types |
| Book | keep | Book | still maps to product resource/value object or request/response shape | generated types |
| BookList | keep | BookList | still maps to product resource/value object or request/response shape | generated types |
| BookStatus | keep | BookStatus | still maps to product resource/value object or request/response shape | generated types |
| BookmarkAnnotation | keep | BookmarkAnnotation | still maps to product resource/value object or request/response shape | generated types |
| Chapter | keep | Chapter | still maps to product resource/value object or request/response shape | generated types |
| ChapterList | keep | ChapterList | still maps to product resource/value object or request/response shape | generated types |
| ChapterNavigation | keep | ChapterNavigation | still maps to product resource/value object or request/response shape | generated types |
| ChapterNavigationItem | keep | ChapterNavigationItem | still maps to product resource/value object or request/response shape | generated types |
| ChapterParagraph | keep | ChapterParagraph | still maps to product resource/value object or request/response shape | generated types |
| ChapterParagraphInput | keep | ChapterParagraphInput | still maps to product resource/value object or request/response shape | generated types |
| ChapterStatus | keep | ChapterStatus | still maps to product resource/value object or request/response shape | generated types |
| ChapterSummary | keep | ChapterSummary | still maps to product resource/value object or request/response shape | generated types |
| ChapterViewMode | rename | ChapterContentVariant | backend-neutral content variant replaces reader-view naming | generated types; mock repository |
| ChatArtifact | keep | ChatArtifact | still maps to product resource/value object or request/response shape | generated types |
| ChatArtifactKind | keep | ChatArtifactKind | still maps to product resource/value object or request/response shape | generated types |
| ChatArtifactStatus | keep | ChatArtifactStatus | still maps to product resource/value object or request/response shape | generated types |
| ChatMessage | keep | ChatMessage | still maps to product resource/value object or request/response shape | generated types |
| ChatMessageList | keep | ChatMessageList | still maps to product resource/value object or request/response shape | generated types |
| ChatMessagePart | keep | ChatMessagePart | still maps to product resource/value object or request/response shape | generated types |
| ChatMessagePartStatus | keep | ChatMessagePartStatus | still maps to product resource/value object or request/response shape | generated types |
| ChatMessagePartType | keep | ChatMessagePartType | still maps to product resource/value object or request/response shape | generated types |
| ChatRole | keep | ChatRole | still maps to product resource/value object or request/response shape | generated types |
| ChatSession | keep | ChatSession | still maps to product resource/value object or request/response shape | generated types |
| ChatSessionList | keep | ChatSessionList | still maps to product resource/value object or request/response shape | generated types |
| ChatTrigger | merge | ChatMessageReference | canonical message references replace text trigger marker schemas | generated types; mock repository; chat API adapter tests |
| ChatTriggerKind | merge | ChatMessageReferenceKind | canonical message references replace text trigger marker schemas | generated types; mock repository; chat API adapter tests |
| ChatTurn | merge | ChatTurnStartResponse / ChatTurnSnapshot / ChatTurnEventEnvelope | old pair-shaped turn payload splits into durable turn start, snapshot and event schemas | generated types; API adapter methods; tests |
| CreateBookRequest | keep | CreateBookRequest | still maps to product resource/value object or request/response shape | generated types |
| CreateBookmarkAnnotationRequest | keep | CreateBookmarkAnnotationRequest | still maps to product resource/value object or request/response shape | generated types |
| CreateChapterRequest | keep | CreateChapterRequest | still maps to product resource/value object or request/response shape | generated types |
| CreateChatMessageRequest | merge | ChatTurnStartRequest | old message send request merges into durable chat turn command | generated types; API adapter methods; tests |
| CreateChatSessionRequest | keep | CreateChatSessionRequest | still maps to product resource/value object or request/response shape | generated types |
| CreateExportRequest | keep | CreateExportRequest | still maps to product resource/value object or request/response shape | generated types |
| CreateHighlightAnnotationRequest | keep | CreateHighlightAnnotationRequest | still maps to product resource/value object or request/response shape | generated types |
| CreateNoteAnnotationRequest | keep | CreateNoteAnnotationRequest | still maps to product resource/value object or request/response shape | generated types |
| CreateProjectRequest | keep | CreateProjectRequest | still maps to product resource/value object or request/response shape | generated types |
| CreateReaderAnnotationRequest | keep | CreateReaderAnnotationRequest | still maps to product resource/value object or request/response shape | generated types |
| DateTime | keep | DateTime | still maps to product resource/value object or request/response shape | generated types |
| DiffHunk | keep | DiffHunk | still maps to product resource/value object or request/response shape | generated types |
| ExportFormat | keep | ExportFormat | still maps to product resource/value object or request/response shape | generated types |
| ExportJob | merge | Job | canonical backend lifecycle replaces typed job payloads in final contract | generated types; mock repository; migration docs |
| HighlightAnnotation | keep | HighlightAnnotation | still maps to product resource/value object or request/response shape | generated types |
| Id | keep | Id | still maps to product resource/value object or request/response shape | generated types |
| ImportBookRequest | keep | ImportBookRequest | still maps to product resource/value object or request/response shape | generated types |
| ImportConstraints | keep | ImportConstraints | still maps to product resource/value object or request/response shape | generated types |
| IndexingJob | merge | Job | canonical backend lifecycle replaces typed job payloads in final contract | generated types; mock repository; migration docs |
| IndexingJobList | merge | Job | canonical backend lifecycle replaces typed job payloads in final contract | generated types; mock repository; migration docs |
| IndexingJobStage | merge | Job | canonical backend lifecycle replaces typed job payloads in final contract | generated types; mock repository; migration docs |
| IndexingJobStatus | merge | Job | canonical backend lifecycle replaces typed job payloads in final contract | generated types; mock repository; migration docs |
| IndexingStatus | keep | IndexingStatus | still maps to product resource/value object or request/response shape | generated types |
| IndexingSummary | keep | IndexingSummary | still maps to product resource/value object or request/response shape | generated types |
| LlmCompletedEvent | merge | ChatTurnEventEnvelope / ChatTurnEventType | canonical turn events replace provider-shaped stream events | generated types; SSE parser tests; migration docs |
| LlmErrorEvent | merge | ChatTurnEventEnvelope / ChatTurnEventType | canonical turn events replace provider-shaped stream events | generated types; SSE parser tests; migration docs |
| LlmReasoningDeltaEvent | merge | ChatTurnEventEnvelope / ChatTurnEventType | canonical turn events replace provider-shaped stream events | generated types; SSE parser tests; migration docs |
| LlmStreamEvent | merge | ChatTurnEventEnvelope / ChatTurnEventType | canonical turn events replace provider-shaped stream events | generated types; SSE parser tests; migration docs |
| LlmStreamEventType | merge | ChatTurnEventEnvelope / ChatTurnEventType | canonical turn events replace provider-shaped stream events | generated types; SSE parser tests; migration docs |
| LlmTextDeltaEvent | merge | ChatTurnEventEnvelope / ChatTurnEventType | canonical turn events replace provider-shaped stream events | generated types; SSE parser tests; migration docs |
| LlmToolCallEvent | merge | ChatTurnEventEnvelope / ChatTurnEventType | canonical turn events replace provider-shaped stream events | generated types; SSE parser tests; migration docs |
| LlmToolResultEvent | merge | ChatTurnEventEnvelope / ChatTurnEventType | canonical turn events replace provider-shaped stream events | generated types; SSE parser tests; migration docs |
| LoginRequest | keep | LoginRequest | still maps to product resource/value object or request/response shape | generated types |
| NoteAnnotation | keep | NoteAnnotation | still maps to product resource/value object or request/response shape | generated types |
| PageMeta | keep | PageMeta | still maps to product resource/value object or request/response shape | generated types |
| Problem | keep | Problem | still maps to product resource/value object or request/response shape | generated types |
| Project | keep | Project | still maps to product resource/value object or request/response shape | generated types |
| ProjectList | keep | ProjectList | still maps to product resource/value object or request/response shape | generated types |
| PublishChapterRequest | keep | PublishChapterRequest | still maps to product resource/value object or request/response shape | generated types |
| ReaderAnnotation | keep | ReaderAnnotation | still maps to product resource/value object or request/response shape | generated types |
| ReaderAnnotationBase | keep | ReaderAnnotationBase | still maps to product resource/value object or request/response shape | generated types |
| ReaderAnnotationKind | keep | ReaderAnnotationKind | still maps to product resource/value object or request/response shape | generated types |
| ReaderAnnotationList | keep | ReaderAnnotationList | still maps to product resource/value object or request/response shape | generated types |
| ReaderAnnotationStatus | keep | ReaderAnnotationStatus | still maps to product resource/value object or request/response shape | generated types |
| ReaderLocator | keep | ReaderLocator | still maps to product resource/value object or request/response shape | generated types |
| ReaderReference | keep | ReaderReference | still maps to product resource/value object or request/response shape | generated types |
| ReaderReferenceLocator | keep | ReaderReferenceLocator | still maps to product resource/value object or request/response shape | generated types |
| ReaderReferencesChatTrigger | merge | ReaderReferencesChatMessageReference | canonical message references replace text trigger marker schemas | generated types; mock repository; chat API adapter tests |
| RegisterRequest | keep | RegisterRequest | still maps to product resource/value object or request/response shape | generated types |
| RequestAgentSuggestionRequest | merge | AgentRunRequest | synchronous suggestion request merges into durable agent run command | generated types; manuscript/chat API adapters; tests |
| SearchResponse | keep | SearchResponse | still maps to product resource/value object or request/response shape | generated types |
| SearchResult | keep | SearchResult | still maps to product resource/value object or request/response shape | generated types |
| SearchScope | keep | SearchScope | still maps to product resource/value object or request/response shape | generated types |
| TextRange | keep | TextRange | still maps to product resource/value object or request/response shape | generated types |
| UpdateBookRequest | keep | UpdateBookRequest | still maps to product resource/value object or request/response shape | generated types |
| UpdateBookmarkAnnotationRequest | keep | UpdateBookmarkAnnotationRequest | still maps to product resource/value object or request/response shape | generated types |
| UpdateChapterRequest | keep | UpdateChapterRequest | still maps to product resource/value object or request/response shape | generated types |
| UpdateChatSessionRequest | keep | UpdateChatSessionRequest | still maps to product resource/value object or request/response shape | generated types |
| UpdateHighlightAnnotationRequest | keep | UpdateHighlightAnnotationRequest | still maps to product resource/value object or request/response shape | generated types |
| UpdateNoteAnnotationRequest | keep | UpdateNoteAnnotationRequest | still maps to product resource/value object or request/response shape | generated types |
| UpdateProjectRequest | keep | UpdateProjectRequest | still maps to product resource/value object or request/response shape | generated types |
| UpdateReaderAnnotationRequest | keep | UpdateReaderAnnotationRequest | still maps to product resource/value object or request/response shape | generated types |
| User | keep | User | still maps to product resource/value object or request/response shape | generated types |
| ValidationError | merge | ValidationIssue | old path/message validation detail merges into Problem.errors ValidationIssue JSON Pointer shape | generated types; problem response tests |

## Final Schema Inventory

| schema/component | status | rationale |
| --- | --- | --- |
| AgentDiffLocator | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| AgentOptions | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| AgentRunJobResult | added | new explicit backend-first contract schema with generated type coverage |
| AgentRunRequest | canonical replacement | new shared backend-first schema replacing an old typed stream/job/suggestion shape |
| AgentRunStartResponse | canonical replacement | new shared backend-first schema replacing an old typed stream/job/suggestion shape |
| AgentSuggestion | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| AgentSuggestionActionResult | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| AgentSuggestionKind | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| AgentSuggestionList | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| AgentSuggestionsChatMessageReference | canonical replacement | new shared backend-first schema replacing an old typed stream/job/suggestion shape |
| AgentSuggestionStatus | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| AgentTask | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ApproveAgentSuggestionRequest | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| AuthSession | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| Book | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| BookList | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| BookmarkAnnotation | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| BookStatus | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| Chapter | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ChapterList | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ChapterNavigation | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ChapterNavigationItem | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ChapterParagraph | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ChapterParagraphInput | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ChapterStatus | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ChapterSummary | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ChapterContentVariant | renamed replacement | ChapterViewMode renamed to backend-neutral published/draft content variant |
| ChatArtifact | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ChatArtifactKind | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ChatArtifactStatus | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ChatMessage | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ChatMessageList | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ChatMessagePart | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ChatMessagePartStatus | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ChatMessagePartType | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ChatMessageReference | canonical replacement | new shared backend-first schema replacing an old typed stream/job/suggestion shape |
| ChatMessageReferenceKind | canonical replacement | new shared backend-first schema replacing an old typed stream/job/suggestion shape |
| ChatRole | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ChatSession | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ChatSessionList | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ChatTurnEventEnvelope | canonical replacement | new shared backend-first schema replacing an old typed stream/job/suggestion shape |
| ChatTurnEventType | canonical replacement | new shared backend-first schema replacing an old typed stream/job/suggestion shape |
| ChatTurnJobResult | added | new explicit backend-first contract schema with generated type coverage |
| ChatTurnSnapshot | canonical replacement | new shared backend-first schema replacing an old typed stream/job/suggestion shape |
| ChatTurnStartRequest | canonical replacement | new shared backend-first schema replacing an old typed stream/job/suggestion shape |
| ChatTurnStartResponse | canonical replacement | new shared backend-first schema replacing an old typed stream/job/suggestion shape |
| CreateBookmarkAnnotationRequest | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| CreateBookRequest | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| CreateChapterRequest | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| CreateChatSessionRequest | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| CreateExportRequest | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| CreateHighlightAnnotationRequest | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| CreateNoteAnnotationRequest | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| CreateProjectInvitationRequest | added | new explicit backend-first contract schema with generated type coverage |
| CreateProjectRequest | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| CreateReaderAnnotationRequest | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| CsrfTokenResponse | added | new explicit backend-first contract schema with generated type coverage |
| DateTime | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| DiffHunk | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ExportFormat | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ExportJobResult | added | new explicit backend-first contract schema with generated type coverage |
| HighlightAnnotation | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| Id | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ImportBookRequest | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ImportConstraints | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| IndexingStatus | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| IndexingSummary | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| Job | canonical replacement | new shared backend-first schema replacing an old typed stream/job/suggestion shape |
| JobKind | canonical replacement | new shared backend-first schema replacing an old typed stream/job/suggestion shape |
| JobList | canonical replacement | new shared backend-first schema replacing an old typed stream/job/suggestion shape |
| JobProgressResult | added | new explicit backend-first contract schema with generated type coverage |
| JobResult | added | new explicit backend-first contract schema with generated type coverage |
| JobStartResponse | canonical replacement | new shared backend-first schema replacing an old typed stream/job/suggestion shape |
| JobStatus | canonical replacement | new shared backend-first schema replacing an old typed stream/job/suggestion shape |
| LoginRequest | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| NoteAnnotation | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| PageMeta | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| Problem | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| Project | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ProjectInvitation | added | new explicit backend-first contract schema with generated type coverage |
| ProjectInvitationInviterContext | added | new explicit backend-first contract schema with generated type coverage |
| ProjectInvitationList | added | new explicit backend-first contract schema with generated type coverage |
| ProjectInvitationProjectContext | added | new explicit backend-first contract schema with generated type coverage |
| ProjectInvitationStatus | added | new explicit backend-first contract schema with generated type coverage |
| ProjectList | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ProjectMembership | added | new explicit backend-first contract schema with generated type coverage |
| ProjectMembershipList | added | new explicit backend-first contract schema with generated type coverage |
| ProjectRole | added | new explicit backend-first contract schema with generated type coverage |
| PublishChapterRequest | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ReaderAnnotation | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ReaderAnnotationBase | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ReaderAnnotationKind | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ReaderAnnotationList | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ReaderAnnotationStatus | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ReaderLocator | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ReaderReference | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ReaderReferenceLocator | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ReaderReferencesChatMessageReference | canonical replacement | new shared backend-first schema replacing an old typed stream/job/suggestion shape |
| RegisterRequest | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| RejectAgentSuggestionRequest | canonical replacement | new shared backend-first schema replacing an old typed stream/job/suggestion shape |
| SearchProjectFilters | added | new explicit backend-first contract schema with generated type coverage |
| SearchProjectRequest | added | new explicit backend-first contract schema with generated type coverage |
| SearchResponse | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| SearchResult | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| SearchResultKind | added | new explicit backend-first contract schema with generated type coverage |
| SearchScope | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| TextRange | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| UpdateBookmarkAnnotationRequest | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| UpdateBookRequest | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| UpdateChapterRequest | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| UpdateChatSessionRequest | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| UpdateHighlightAnnotationRequest | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| UpdateNoteAnnotationRequest | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| UpdateProjectMemberRoleRequest | added | new explicit backend-first contract schema with generated type coverage |
| UpdateProjectRequest | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| UpdateReaderAnnotationRequest | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| User | preserved | present in pinned baseline inventory and still part of the backend-first public contract |
| ValidationIssue | added | new explicit backend-first contract schema with generated type coverage |

## Policy Matrix

| operationId | method/path | purpose | backend-first reason | overlap explanation | ui_only |
| --- | --- | --- | --- | --- | --- |
| acceptProjectInvitation | POST /project-invitations/{invitationId}/accept | resource/command | invitation command binds authenticated verified email to a pending project invite | none | 0 |
| approveAgentSuggestion | POST /agent-suggestions/{suggestionId}/approve | resource/command | agent suggestion approval is a revision-guarded manuscript mutation command | none | 0 |
| cancelJob | POST /jobs/{jobId}/cancel | command/job | shared job cancel command preserves terminal state immutability across job kinds | none | 0 |
| cancelProjectInvitation | POST /project-invitations/{invitationId}/cancel | resource/command | invitation cancel command hides token material and records access-control outcome | none | 0 |
| createBook | POST /projects/{projectId}/books | resource/command | book creation is a project-scoped manuscript resource command | none | 0 |
| createBookExport | POST /books/{bookId}/exports | command/job | export start is an owner-admin full-manuscript job command with short-lived result links | none | 0 |
| createChapter | POST /books/{bookId}/chapters | resource/command | chapter creation is a book-scoped manuscript resource command | none | 0 |
| createChapterAnnotation | POST /chapters/{chapterId}/annotations | resource/command | annotation creation is a chapter-scoped reader note command with locator payload | none | 0 |
| createChatSession | POST /projects/{projectId}/chats | resource/command | chat creation starts a project-scoped conversation resource | none | 0 |
| createChatTurn | POST /chats/{chatId}/turns | command/job | chat turn command persists user input before asynchronous assistant work starts | none | 0 |
| createProject | POST /projects | resource/command | project creation establishes the tenant boundary and initial owner | none | 0 |
| createProjectInvitation | POST /projects/{projectId}/invitations | resource/command | invitation creation is an owner-admin access-control command with hashed token semantics | none | 0 |
| deleteBook | DELETE /books/{bookId} | resource/command | book deletion hides manuscript resources through the owning project boundary | none | 0 |
| deleteChapter | DELETE /chapters/{chapterId} | resource/command | chapter deletion cascades chapter-local annotations and suggestions | none | 0 |
| deleteChatSession | DELETE /chats/{chatId} | resource/command | chat deletion hides project conversation resources without deleting unrelated manuscript data | none | 0 |
| deleteProject | DELETE /projects/{projectId} | resource/command | project deletion is the tenant-level removal command and purge trigger | none | 0 |
| deleteReaderAnnotation | DELETE /annotations/{annotationId} | resource/command | annotation deletion removes a direct-ID reader note through owning project membership | none | 0 |
| getAgentSuggestion | GET /agent-suggestions/{suggestionId} | resource/query | agent suggestion read resolves direct suggestion id through chapter and project ownership | none | 0 |
| getBook | GET /books/{bookId} | resource/query | book read resolves direct book id through project membership | none | 0 |
| getChapter | GET /chapters/{chapterId} | resource/query | chapter read resolves direct chapter id through book and project ownership | none | 0 |
| getChatArtifact | GET /chat-artifacts/{artifactId} | resource/query | artifact read resolves chat provenance before exposing generated reader references | none | 0 |
| getChatSession | GET /chats/{chatId} | resource/query | chat read resolves direct chat id through project membership | none | 0 |
| getChatTurn | GET /chat-turns/{turnId} | resource/query | turn snapshot read exposes recovery state for a persisted async chat job | none | 0 |
| getCsrfToken | GET /auth/csrf | resource/query | CSRF bootstrap is a no-store auth utility outside tenant resources | none | 0 |
| getCurrentUser | GET /auth/session | resource/query | session read returns the authenticated principal envelope without project lookup | none | 0 |
| getImportConstraints | GET /projects/{projectId}/import-constraints | resource/query | import constraints are a project-scoped capability query before upload | none | 0 |
| getJob | GET /jobs/{jobId} | resource/query | job read unifies import indexing export chat and agent lifecycle under one direct-ID resource | none | 0 |
| getProject | GET /projects/{projectId} | resource/query | project read is the canonical tenant resource lookup | none | 0 |
| importBookFile | POST /projects/{projectId}/imports | command/job | multipart import is a direct upload job command with file abuse controls | none | 0 |
| listAgentSuggestions | GET /chapters/{chapterId}/agent-suggestions | resource/query | suggestion list is chapter-scoped and cursor paginated for editor review queues | none | 0 |
| listBooks | GET /projects/{projectId}/books | resource/query | book list is a cursor-paginated project manuscript collection | none | 0 |
| listChapterAnnotations | GET /chapters/{chapterId}/annotations | resource/query | annotation list is chapter-scoped and cursor paginated for reader notes | none | 0 |
| listChapters | GET /books/{bookId}/chapters | resource/query | chapter list is a cursor-paginated book table of contents resource | none | 0 |
| listChatMessages | GET /chats/{chatId}/messages | resource/query | message list is a cursor-paginated chat transcript resource | none | 0 |
| listChatSessions | GET /projects/{projectId}/chats | resource/query | chat session list is a cursor-paginated project conversation collection | none | 0 |
| listMyProjectInvitations | GET /project-invitations | resource/query | verified-email invitation discovery lists opaque invitation ids with project title and inviter context for the authenticated invitee before accept | none | 0 |
| listProjectInvitations | GET /projects/{projectId}/invitations | resource/query | invitation list is owner-admin project access-control inventory | none | 0 |
| listProjectJobs | GET /projects/{projectId}/jobs | resource/query | job list is a cursor-paginated project work queue across async job kinds | none | 0 |
| listProjectMembers | GET /projects/{projectId}/members | resource/query | member list is owner-admin project access-control inventory | none | 0 |
| listProjects | GET /projects | resource/query | project list is the authenticated user tenant index | none | 0 |
| loginUser | POST /auth/login | resource/command | login creates a no-store server session without exposing credentials | none | 0 |
| logoutUser | POST /auth/logout | resource/command | logout invalidates the current session cookie and audit trail | none | 0 |
| publishChapter | POST /chapters/{chapterId}/publish | resource/command | publish command moves a draft revision into the readable manuscript state | none | 0 |
| registerUser | POST /auth/register | resource/command | registration creates an account and initial no-store session envelope | none | 0 |
| rejectAgentSuggestion | POST /agent-suggestions/{suggestionId}/reject | resource/command | agent suggestion rejection is a revision-guarded command that records editor intent without mutating chapter text | none | 0 |
| removeProjectMember | DELETE /projects/{projectId}/members/{memberId} | resource/command | member removal immediately revokes project access through owner-admin policy | none | 0 |
| renameChatSession | PATCH /chats/{chatId} | resource/command | chat rename is a project conversation metadata mutation with viewer denial | none | 0 |
| rotateSession | POST /auth/session/rotate | resource/command | session rotation renews authentication material with CSRF and no-store response | none | 0 |
| searchProject | POST /projects/{projectId}/search | query | private search uses POST body plus cursor fingerprint so query text stays out of URLs | none | 0 |
| startAgentRun | POST /chapters/{chapterId}/agent-runs | resource/command | agent run command starts a shared job and persists resulting suggestions separately | none | 0 |
| startProjectIndexing | POST /projects/{projectId}/indexing-runs | resource/command | indexing start command queues project corpus work under the shared Job envelope | none | 0 |
| streamChatTurnEvents | GET /chat-turns/{turnId}/events | stream | SSE event stream resumes a persisted chat turn without mixing command and stream | none | 0 |
| updateBook | PATCH /books/{bookId} | resource/command | book update is a direct-ID manuscript metadata mutation through owning project membership | none | 0 |
| updateChapter | PATCH /chapters/{chapterId} | resource/command | chapter update is a revision-guarded direct-ID draft mutation | none | 0 |
| updateProject | PATCH /projects/{projectId} | resource/command | project update mutates tenant metadata under editor-admin-owner policy | none | 0 |
| updateProjectMemberRole | PATCH /projects/{projectId}/members/{memberId} | resource/command | member role update is owner-admin access-control mutation | none | 0 |
| updateReaderAnnotation | PATCH /annotations/{annotationId} | resource/command | annotation update is a direct-ID reader note mutation through owning project membership | none | 0 |

## Staged Allowance Inventory

| allowance_id | scope | status | owner | closure_evidence |
| --- | --- | --- | --- | --- |
