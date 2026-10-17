"use client";

import { useState } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { ArrowRight, Check, Clock3, Mail, ShieldCheck } from "lucide-react";
import { dateLabel } from "@hale/contracts/time";
import { familySummaryApi, type FamilySummaryCard } from "@/lib/family-summary-api";
import { useWorkspace } from "./providers";
import { EmptyState, PageIntro, PrivacyNote } from "./ui";
import styles from "./family-summaries.module.css";

function deliveryLabel(state: FamilySummaryCard["deliveryState"]) {
  if (state === "sent") return "Email delivered";
  if (state === "queued" || state === "sending") return "Email queued";
  if (state === "failed") return "Email needs attention";
  if (state === "skipped") return "Email not sent";
  return "No email delivery";
}

export function FamilySummaries() {
  const { mode, space } = useWorkspace();
  const patientId = mode === "live" ? space.id : "";
  const data = useQuery(familySummaryApi.read, mode === "live" ? { patientId } : "skip");
  const savePreferences = useMutation(familySummaryApi.setPreferences);
  const sendTestEmail = useAction(familySummaryApi.sendTestEmail);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  async function updatePreference(kind: "nightly" | "weekly", checked: boolean) {
    if (!data) return;
    const preferences = { ...data.preferences, [kind]: checked };
    setBusy(true);
    setFeedback("");
    setError("");
    try {
      await savePreferences({ patientId, ...preferences });
      setFeedback("Notification preferences saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Preferences could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function requestTestEmail() {
    setBusy(true);
    setFeedback("");
    setError("");
    try {
      await sendTestEmail({ patientId });
      setFeedback("A synthetic test email was sent to the test inbox configured for this deployment. It contained no patient data.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The isolated test email could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  return <div className={styles.page}>
    <PageIntro
      eyebrow="FAMILY SUMMARIES"
      title="A quiet look back"
      description="Nightly notes and a separate Sunday-weekly recap, built only from processed conversation sources."
      aside={<span className="private-label"><ShieldCheck size={15} /> Shared with authorized family</span>}
    />

    {mode === "demo" ? <div className={styles.notice}>
      <ShieldCheck size={18} /><p>Summaries are not generated in demo mode. Connect a live family space to see source-linked summaries and notification controls.</p>
    </div> : !data ? <div className={styles.loading} role="status">Loading family summaries…</div> : <>
      {!data.enabled && <div className={styles.notice} role="status"><ShieldCheck size={18} /><p>Family summaries are turned off on this server. No summaries are generated, scheduled, or delivered.</p></div>}

      <section className={styles.preferences} aria-labelledby="summary-preferences-title">
        <div className={styles.sectionHeading}>
          <div><p className="eyebrow">EMAIL PREFERENCES</p><h2 id="summary-preferences-title">Choose what reaches your inbox</h2></div>
          <Mail size={19} aria-hidden="true" />
        </div>
        <p className={styles.helper}>Email is optional and starts off. Messages go only to the verified email on your signed-in family account.</p>
        <label className={styles.preference}>
          <span><strong>Nightly summary</strong><small>One concise update each evening.</small></span>
          <input type="checkbox" checked={data.preferences.nightly} disabled={busy || (!data.verifiedEmailAvailable && !data.preferences.nightly) || (!data.notificationDeliveryConfigured && !data.preferences.nightly)} onChange={(event) => void updatePreference("nightly", event.target.checked)} />
        </label>
        <label className={styles.preference}>
          <span><strong>Weekly summary</strong><small>A separate recap every Sunday night, after that night’s summary.</small></span>
          <input type="checkbox" checked={data.preferences.weekly} disabled={busy || (!data.verifiedEmailAvailable && !data.preferences.weekly) || (!data.notificationDeliveryConfigured && !data.preferences.weekly)} onChange={(event) => void updatePreference("weekly", event.target.checked)} />
        </label>
        {!data.verifiedEmailAvailable && <p className={styles.helper}>A verified email claim is not available from your sign-in token, so email notifications can’t be enabled.</p>}
        {data.enabled && !data.notificationDeliveryConfigured && !data.testEmailAvailable && <p className={styles.helper}>Family email delivery is not configured on this server.</p>}
        {data.testEmailAvailable && <div className={styles.testEmail}>
          <div><strong>Isolated test email</strong><small>Sends a fixed synthetic message to this deployment’s configured test inbox—never to family addresses.</small></div>
          <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void requestTestEmail()}><Mail size={15} />Send test email</button>
        </div>}
        {feedback && <p className={styles.feedback} role="status"><Check size={15} />{feedback}</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
      </section>

      <PrivacyNote>These summaries quote processed transcript excerpts and link back to their source conversations. They are not a medical interpretation. Deleted or unavailable source conversations are omitted.</PrivacyNote>

      <section className={styles.archive} aria-labelledby="summary-archive-title">
        <div className={styles.sectionHeading}>
          <div><p className="eyebrow">SOURCE-LINKED RECAPS</p><h2 id="summary-archive-title">Recent summaries</h2></div>
        </div>
        {!data.enabled ? <EmptyState title="Summaries are paused" description="When the server-side feature flag is enabled, new nightly summaries and Sunday recaps will appear here." /> : !data.summaries.length ? <EmptyState title="No summaries yet" description="A nightly summary appears after 9pm in this patient’s timezone, once processed transcript sources are available." /> : <div className={styles.summaryList}>
          {data.summaries.map((summary) => <article className={styles.summary} key={summary.id}>
            <header className={styles.summaryHeader}>
              <div><p className="eyebrow">{summary.kind === "nightly" ? "NIGHTLY SUMMARY" : "WEEKLY SUMMARY"}</p>
                <h3>{summary.kind === "nightly" ? dateLabel(summary.periodEnd, { weekday: "long", month: "long", day: "numeric" }) : `${dateLabel(summary.periodStart, { month: "short", day: "numeric" })} – ${dateLabel(summary.periodEnd, { month: "short", day: "numeric", year: "numeric" })}`}</h3></div>
              <span className={styles.delivery}><Clock3 size={14} />{deliveryLabel(summary.deliveryState)}</span>
            </header>
            <p className={styles.summaryIntro}>{summary.intro}</p>
            {summary.entries.length ? <ul className={styles.entries}>{summary.entries.map((entry) => <li key={entry.turnId}>
              <Link href={`/family/conversations/${entry.conversationId}#${entry.turnId}`}>
                <span className={styles.entryDate}>{dateLabel(entry.date, { weekday: "short", month: "short", day: "numeric" })}</span>
                <q>{entry.excerpt}{entry.truncated ? "…" : ""}</q><ArrowRight size={15} aria-hidden="true" />
              </Link>
            </li>)}</ul> : <p className={styles.emptyExcerpt}>No source excerpts remain available for this summary.</p>}
          </article>)}
        </div>}
      </section>
    </>}
  </div>;
}
