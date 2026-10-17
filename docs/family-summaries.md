# Family summaries: operations and removal

## Scope and safety

The feature is isolated to the web family dashboard and Convex. It adds a **Summaries** page at `/family/summaries`, three additive Convex tables, and one guarded 15-minute scheduler tick. No mobile files or production deployment settings are changed by this feature branch.

Summaries are deterministic, source-grounded excerpts from ready transcript turns. They are not an LLM paraphrase, diagnosis, or care recommendation. The stored summary document contains source turn IDs rather than copied transcript text; the web view and email worker resolve the text from the current, same-patient source records and omit deleted/unavailable sources.

The feature is off unless the server-side Convex variable `FAMILY_SUMMARIES_ENABLED` is exactly `true`. An unset value and every other value are off. Each worker and delivery action checks it before performing work. While off, the recurring cron exits without creating per-patient work, existing scheduled actions no-op, and no email is sent. Existing summaries and delivery records are retained.

## Schedule and delivery

- The recurring tick checks each patient's IANA timezone. A local 9pm cutoff creates that local day's nightly summary. The 15-minute cadence means generation can be up to 15 minutes after 9pm.
- A weekly summary covers Monday through Sunday and is created on Sunday after the nightly summary. On Sundays, the weekly email is held until all nightly deliveries have reached a terminal state; then it is queued separately.
- Unique patient/type/period and summary/recipient indexes make generation and delivery idempotent. Backlog generation advances one missed date per tick.
- Email preferences default off and are per family member and patient. Recipients must be active `family` members with `memories:read`, an enabled preference, and a verified email claim in their authenticated Convex identity. Access and preference are checked again before send.
- Email uses Resend with a stable provider idempotency key. Transient provider errors retry with capped exponential delay (up to four attempts); delivery state and timestamps are visible on the summary card.
- Ordinary family email requires both the main feature flag and `FAMILY_SUMMARIES_EMAIL_MODE=live`, along with `RESEND_API_KEY` and a plain `FAMILY_SUMMARIES_FROM_EMAIL` address. The default mode is not live.
- `FAMILY_SUMMARIES_EMAIL_MODE=test` disables ordinary family deliveries. If `FAMILY_SUMMARIES_TEST_EMAIL`, sender, and API key are configured, the UI exposes an isolated test action. It sends a fixed synthetic message only to that server-configured inbox, never to a family address and never with patient data. The recipient is not provided by the browser.

Do not set test or live mail variables on production as part of development. Local tests use synthetic records and mocked `fetch`; they do not contact Resend. No deployment was used or changed while implementing this branch.

## Safe test-deployment workflow

1. Before any manual deployment work, select and independently verify a **test/dev Convex deployment** in the Convex dashboard. Confirm its deployment name and environment; do not rely on a locally cached deployment selection.
2. Use only synthetic patient, transcript, and family accounts in that deployment. Never use a production deployment or real family email addresses for this workflow.
3. Keep `FAMILY_SUMMARIES_EMAIL_MODE=test`, set `FAMILY_SUMMARIES_TEST_EMAIL` to a controlled test inbox, and use a test sender/API key. This mode blocks normal family deliveries; the test button sends only its fixed sample.
4. Set `FAMILY_SUMMARIES_ENABLED=true` only on that verified test deployment to exercise scheduling. Reset it to `false` after the test. Do not configure `live` mode without separate release approval.

The branch tests cover weekdays, Sunday sequencing, timezone and DST date selection, deduplication, retry tracking, recipient isolation, permission revocation, source deletion, flag-off/reenable behavior, and the static test-email path.

## Disable immediately

In the Convex dashboard, explicitly select the intended deployment, verify it is not production, then set:

```text
FAMILY_SUMMARIES_ENABLED=false
```

This is the runtime kill switch. It stops new generation and per-patient scheduling, makes already-scheduled work no-op, and prevents subsequent deliveries. It does not remove summaries, preferences, or delivery history. If the feature is later re-enabled, queued work can be reconsidered by the scheduler; already-sent deliveries remain idempotently sent.

## Revert the code

Keep the rollback on `feature/family-summaries`; do not merge or switch changes onto `main` as part of rollback.

1. Disable the feature as above before reverting code.
2. Inspect commits introduced on the feature branch with `git log --oneline main..feature/family-summaries`.
3. Revert only the family-summary commits, newest first, using `git revert --no-edit <commit-sha>` for each commit. Resolve conflicts by preserving unrelated work, run the regression checks, and review the result before any merge.
4. Do not delete summary data as part of code rollback. The new tables are additive and can remain dormant in the schema.

## Remove the runtime feature

After disabling the flag, remove the feature code as a unit: the `familySummaries` Convex module and pure helper/tests, its cron registration, the family summary tables/preferences/delivery schemas, the account-deletion cleanup additions, the web route/component/API/CSS module, and the `Summaries` navigation entry. Remove the summary environment declarations from `convex/convex.config.ts` and generated server environment types at the same time. Run tests, lint, typecheck, and build afterward.

The three added tables may contain personal preferences and delivery history. To honor data-retention and no-unapproved-deletion requirements, leave their schema declarations in place if they contain records; remove those declarations only after an independently authorized retention/export decision confirms the tables are empty or their data has been handled. Runtime removal does not require deleting those records.
