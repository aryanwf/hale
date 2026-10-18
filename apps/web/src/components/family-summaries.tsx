"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { dateLabel } from "@hale/contracts/time";
import { familySummaryApi } from "@/lib/family-summary-api";
import { useWorkspace } from "./providers";
import { EmptyState, PageIntro, PrivacyNote } from "./ui";
import styles from "./family-summaries.module.css";

export function FamilySummaries() {
  const { mode, space } = useWorkspace();
  const patientId = mode === "live" ? space.id : "";
  const data = useQuery(familySummaryApi.read, mode === "live" ? { patientId } : "skip");

  return <div className={styles.page}>
    <PageIntro
      eyebrow="FAMILY SUMMARIES"
      title="A quiet look back"
      description="Nightly notes and a separate Sunday-weekly recap, built only from processed conversation sources."
      aside={<span className="private-label"><ShieldCheck size={15} /> Shared with authorized family</span>}
    />

    {mode === "demo" ? <div className={styles.notice}>
      <ShieldCheck size={18} /><p>Summaries are not generated in demo mode. Connect a live family space to see source-linked summaries.</p>
    </div> : !data ? <div className={styles.loading} role="status">Loading family summaries…</div> : <>
      {!data.enabled && <div className={styles.notice} role="status"><ShieldCheck size={18} /><p>Family summaries are turned off on this server. No summaries are generated or scheduled.</p></div>}

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
