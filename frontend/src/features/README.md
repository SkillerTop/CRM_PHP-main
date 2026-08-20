# Frontend feature boundaries

The application shell remains in `CRMApp.tsx` until each feature can be
extracted with its complete state and API contract. New UI code should be
placed in one of these areas:

- `auth` — login, registration, password recovery and reset
- `dashboard` — summary cards and activity overview
- `companies` — company list, pipeline and company details
- `contacts` — contact list and contact details
- `activity` — tasks, comments, attachments and reminders
- `users` — invitations, roles and user profile management
- `audit` — audit filters, export and event details
- `settings` — preferences and lookup administration

Feature modules may depend on `src/shared/components`, `src/shared/hooks`,
`src/shared/utils` and `src/shared/api`, but should not import another feature
directly. Cross-feature orchestration belongs in the application shell.
