# Web-to-lead handover

2026-10-23. The Settings lead-forms page creates and disables forms, selects a default team owner, and copies public links and iframe snippets. The public form accepts name, company, email, phone and message, with a honeypot and ordinary server-action form submission for browsers without JavaScript.

## Implementation

- `supabase/migrations/20261024100000_lead_forms.sql` adds forced-RLS lead forms/submissions and a service-role-only `submit_lead_form` SECURITY DEFINER transaction. Its token determines every org ID. A form row lock serializes the five-per-IP and fifty-per-form limits over ten minutes. An org/email advisory lock serializes contact reuse across forms.
- `lib/lead-forms/` owns Zod boundaries, scoped database types, cryptographic tokens and hashes, and unit tests. Client reuse follows `contacts.email`, compared case-insensitively inside the token's workspace. Existing customer details are preserved. New deals use the existing `source` field with `Web form`, stage `lead`, and the form owner. External messages are clearly marked in `record_notes`; its required author is the default owner. Audit entries identify the form ID without storing its token or a raw IP.
- `app/f/[token]/` owns public rendering and submission. Invalid/disabled forms render a friendly 200/noindex response because an observed Next 16 `notFound()` response was blank in Chromium with JavaScript disabled. Successful posts redirect to a GET success state.
- `app/(app)/settings/lead-forms/` owns capability-gated creation/disabling and share controls. The Settings page has one additive link. The approved middleware edit matches exactly one segment below `/f/`; finance and similar prefixes remain protected.
- `supabase/tests/lead_forms.sql` contains 40 pgTAP assertions for RLS, token scoping, honeypots, limits/windows, source/owner/note/audit, client reuse and transaction rollback. Nullable tenant-qualified audit references preserve existing client/deal deletion while retaining rate-limit history.
- `e2e/web-to-lead.spec.ts` checks invalid forms without JavaScript, creates a form through Settings, submits as an unauthenticated browser without JavaScript, finds the new deal in Lead, verifies source/history, and disables the form.

## Deployment settings

Use the existing server-only `SUPABASE_SERVICE_ROLE_KEY` and configure `NEXT_PUBLIC_APP_URL` to the public app origin before copying links or embed HTML. Optionally set a dedicated `LEAD_FORM_IP_SECRET`; otherwise the service-role key is used for keyed HMAC-SHA256 hashing scoped to each form.

On Vercel, the action uses the platform's `x-vercel-forwarded-for` header. This choice follows [Vercel request-header documentation](https://vercel.com/docs/headers/request-headers), checked 2026-10-23. On other deployments set `LEAD_FORM_TRUST_PROXY=true` only when the trusted edge overwrites client-supplied `x-forwarded-for` and direct access to the app is blocked. Without a trusted address, requests share a conservative per-form unknown-address bucket, so at most five submissions per ten minutes are accepted there. Raw addresses are never persisted.

Removing the default owner's membership clears the owner and makes the form unavailable. Create a replacement form with a current owner. Disabling is supported; token rotation, form editing, spam challenges, and automatic audit-retention jobs are outside this track.

## Verification

Independent read-only source review approved the patch with no actionable findings; the reviewer did not run the gates. No Docker or Supabase instance was started. The worktree initially had no `.env.local` or `.local-stack/isolation.json`, so SQL and the full database-backed Playwright flow were not run here. The coordinator explicitly confirmed it will apply the migration and run both suites on the integration stack after worker handoff. A real production-server Chromium smoke uses JavaScript disabled and synthetic local configuration to check the unavailable view and protected-route redirects; it does not claim a successful lead insert.

Final required gates, all exit code 0. Output excerpts from the final runs follow.

`pnpm lint`

```text
$ eslint
```

`pnpm typecheck`

```text
$ tsc --noEmit
```

`pnpm test`

```text
Test Files  95 passed (95)
      Tests  677 passed (677)
   Start at  02:27:48
   Duration  9.97s (transform 17.36s, setup 0ms, import 123.35s, tests 3.41s, environment 11ms)
```

`pnpm build`

```text
ƒ Proxy (Middleware)

ƒ  (Dynamic)  server-rendered on demand
```

Real Chromium smoke, JavaScript disabled, exit code 0.

```text
PASS real Chromium with JavaScript disabled: invalid public token renders Form unavailable, without a login redirect.
PASS protected route redirects to login: /finance
PASS protected route redirects to login: /finance/invoices/x
PASS protected route redirects to login: /foo
```

Open integration checks are `supabase/tests/lead_forms.sql` and `pnpm exec playwright test e2e/web-to-lead.spec.ts` against the migrated isolated stack. No remaining source-review findings. No dependency changes, push, merge, Docker startup, or Supabase startup.
