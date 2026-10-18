# Family summaries

## Scope and behavior

The feature adds source-linked nightly summaries and a separate Sunday recap to the web family dashboard at `/family/summaries`. Summaries are deterministic excerpts from ready transcript turns, not an LLM paraphrase, diagnosis, or care recommendation. Stored summaries reference source turn IDs rather than copying transcript text; unavailable or deleted sources are omitted when the dashboard reads a summary.

The feature is off unless the server-side Convex variable `FAMILY_SUMMARIES_ENABLED` is exactly `true`. Each worker checks the flag before generating work. While off, the recurring cron exits without scheduling patient work. Existing summaries are retained.

Summaries are shown only in the authenticated family dashboard. **Family-summary email delivery and its test-email workflow have been removed.** No summary preferences or delivery actions are exposed by the app or backend.

## Schedule

- A 15-minute scheduler tick checks each patient's IANA timezone. A local 9pm cutoff creates that local day's nightly summary; generation can be up to 15 minutes after 9pm.
- A weekly summary covers Monday through Sunday and is created on Sunday after the nightly summary.
- Unique patient/type/period indexes make generation idempotent. Backlog generation advances one missed date per tick.

## Retained historical records

The schema keeps the former `familySummaryPreferences` and `familySummaryDeliveries` tables, including their historical fields, so existing records remain valid and account deletion can continue cleaning them up. Current summary code does not read or write either table. Do not remove those schema declarations or purge their data without first checking retention needs and explicitly authorizing the data change.

## Safe test-deployment workflow

1. Verify a test/dev Convex deployment and its name in the Convex dashboard before manual deployment work.
2. Use synthetic patient, transcript, and family-account data only.
3. Set `FAMILY_SUMMARIES_ENABLED=true` only on that verified test deployment to exercise scheduling. Set it to `false` after the test if summaries should stop generating.

## Disable summaries

On the intended non-production deployment, set:

```text
FAMILY_SUMMARIES_ENABLED=false
```

This stops new generation and scheduling. It does not delete summaries or historical notification records.
