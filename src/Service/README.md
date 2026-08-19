# Backend service boundary

Controllers under `src/Controller` are the HTTP boundary. New business rules
should be placed in services grouped by capability (`Auth`, `Company`,
`Contact`, `Task`, `User`, `Audit`) and called by controllers. Database access
belongs in `src/Database`; request/response normalization belongs in the
controller or a dedicated DTO. This keeps transport concerns separate from
business rules while preserving the existing endpoints.
