"use client";

import { useDeferredValue, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import {
  ArrowRight,
  AudioLines,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  Hourglass,
  MessageSquareText,
  Search,
  X,
} from "lucide-react";
import type { Conversation, Person } from "@hale/contracts";
import { clockLabel, dateLabel, localDate } from "@hale/contracts/time";
import { useWorkspace } from "./providers";
import { api } from "@/lib/api";
import styles from "./conversations-mockup.module.css";

export function ConversationsMockupView() {
  const { space, today, mode } = useWorkspace();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [person, setPerson] = useState("");
  const [range, setRange] = useState("all");
  const searchTerm = query.trim().toLowerCase();
  const hasFilters = Boolean(searchTerm || person || range !== "all");
  const filtered = [...space.conversations]
    .filter((conversation) =>
      (!person || conversation.people.includes(person)) &&
      (range !== "today" || localDate(conversation.startedAt, space.timezone) === today) &&
      (!searchTerm || `${conversation.title} ${conversation.summary} ${conversation.turns.map((turn) => turn.text).join(" ")}`.toLowerCase().includes(searchTerm)),
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  function clearFilters() {
    setQuery("");
    setPerson("");
    setRange("all");
  }

  return (
    <div className={styles.conversationsMockup}>
      <header className={styles.pageHeader}>
        <div className={styles.intro}>
          <h1>Conversations, <span>made easy to find.</span></h1>
        </div>

        <div className={styles.overview} role="group" aria-label="Conversation archive overview">
          <div className={styles.overviewIcon}><MessageSquareText size={20} /></div>
          <div className={styles.overviewStat}>
            <strong>{space.conversations.length}</strong>
            <span>{space.conversations.length === 1 ? "conversation saved" : "conversations saved"}</span>
          </div>
          <span className={styles.overviewDivider} />
          <div className={styles.overviewPeople}>
            <span className={styles.overviewLabel}>YOUR CIRCLE</span>
            <strong>{space.people.length} {space.people.length === 1 ? "person" : "people"}</strong>
          </div>
        </div>
      </header>

      <section className={styles.archive} aria-labelledby="archive-heading">
        <div className={styles.archiveHeading}>
          <div>
            <h2 id="archive-heading">Recorded conversations</h2>
          </div>
          {hasFilters && <button className={styles.clearButton} type="button" onClick={clearFilters}><X size={14} />Clear filters</button>}
        </div>

        <div className={styles.toolbar}>
          <div className={styles.searchBox}>
            <Search size={18} aria-hidden="true" />
            <input
              id="conversation-search"
              type="search"
              aria-label="Search conversations"
              placeholder="Search words, people, or moments…"
              maxLength={200}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && <button type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={15} /></button>}
          </div>

          <div className={styles.selectFilters}>
            <label className={styles.selectControl}>
              <span className="sr-only">Filter by person</span>
              <select aria-label="Filter by person" value={person} onChange={(event) => setPerson(event.target.value)}>
                <option value="">All people</option>
                {space.people.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label className={styles.selectControl}>
              <span className="sr-only">Filter by date</span>
              <select aria-label="Filter by date" value={range} onChange={(event) => setRange(event.target.value)}>
                <option value="all">All available dates</option>
                <option value="today">Today</option>
              </select>
            </label>
          </div>
        </div>

        {mode === "live" ? (
          <LiveResults
            patientId={space.id}
            text={query}
            day={range === "today" ? today : undefined}
            personId={person || undefined}
            people={space.people}
            timezone={space.timezone}
            today={today}
            hasFilters={hasFilters}
            onClear={clearFilters}
          />
        ) : (
          <ConversationResults
            conversations={filtered}
            people={space.people}
            timezone={space.timezone}
            today={today}
            hasFilters={hasFilters}
            onClear={clearFilters}
          />
        )}
      </section>

    </div>
  );
}

function LiveResults({
  patientId,
  text,
  day,
  personId,
  people,
  timezone,
  today,
  hasFilters,
  onClear,
}: {
  patientId: string;
  text: string;
  day?: string;
  personId?: string;
  people: Person[];
  timezone: string;
  today: string;
  hasFilters: boolean;
  onClear: () => void;
}) {
  const term = useDeferredValue(text.trim());
  const result = useQuery(api.searchConversations, { patientId, text: term, day, personId });

  if (!result) return <p className={styles.loadingState} role="status">Searching your conversations…</p>;

  return <ConversationResults
    conversations={result.conversations}
    people={people}
    timezone={timezone}
    today={today}
    hasFilters={hasFilters}
    onClear={onClear}
    limited={result.limited}
  />;
}

function ConversationResults({
  conversations,
  people,
  timezone,
  today,
  hasFilters,
  onClear,
  limited = false,
}: {
  conversations: Conversation[];
  people: Person[];
  timezone: string;
  today: string;
  hasFilters: boolean;
  onClear: () => void;
  limited?: boolean;
}) {
  return <>
    <div className={styles.resultsMeta} role="status" aria-live="polite">
      <span>{conversations.length} {conversations.length === 1 ? "conversation" : "conversations"}{hasFilters ? " found" : ""}</span>
      {limited && <span className={styles.limitedNotice}>Limited results · refine your search</span>}
    </div>

    {conversations.length ? (
      <div className={styles.conversationList}>
        {conversations.map((conversation) => <ConversationCard
          key={conversation.id}
          conversation={conversation}
          people={people}
          timezone={timezone}
          today={today}
        />)}
      </div>
    ) : (
      <div className={styles.emptyState}>
        <span className={styles.emptyIcon}>{hasFilters ? <Search size={19} /> : <AudioLines size={20} />}</span>
        <h3>{hasFilters ? "No conversations found" : "Your archive is ready for its first story."}</h3>
        <p>{hasFilters
          ? "Try a different search or adjust your filters to find what you’re looking for."
          : "When a conversation is recorded, you’ll find the original words and people here."}</p>
        {hasFilters ? (
          <button type="button" onClick={onClear}>Clear search and filters</button>
        ) : (
          <Link href="/patient/today" className={styles.emptyLink}>Open recording view<ArrowRight size={15} /></Link>
        )}
      </div>
    )}
  </>;
}

function ConversationCard({
  conversation,
  people,
  timezone,
  today,
}: {
  conversation: Conversation;
  people: Person[];
  timezone: string;
  today: string;
}) {
  const day = localDate(conversation.startedAt, timezone);
  const participants = people.filter((person) => conversation.people.includes(person.id));
  const status = {
    ready: { label: "Ready to explore", icon: CircleCheck, className: styles.ready },
    queued: { label: "Queued", icon: Hourglass, className: styles.pending },
    processing: { label: "Processing", icon: Hourglass, className: styles.pending },
    failed: { label: "Needs attention", icon: CircleAlert, className: styles.failed },
  }[conversation.state];
  const StatusIcon = status.icon;

  return (
    <Link className={styles.conversationCard} href={`/family/conversations/${conversation.id}`}>
      <div className={styles.when}>
        <span className={styles.date}>{day === today ? "Today" : dateLabel(day, { weekday: "short", month: "short", day: "numeric" })}</span>
        <span className={styles.time}><Clock3 size={13} />{clockLabel(conversation.startedAt, timezone)}</span>
        <span className={styles.duration}>{Math.max(1, Math.round(conversation.duration / 60))} min</span>
      </div>

      <span className={styles.cardDivider} aria-hidden="true" />

      <div className={styles.conversationCopy}>
        <h3>{conversation.title}</h3>
        <p>{conversation.summary}</p>
        <div className={styles.participants}>
          {participants.length ? (
            <>
              <span className={styles.avatarStack} aria-hidden="true">
                {participants.slice(0, 3).map((participant) => <span key={participant.id} className={`avatar avatar-${participant.color} ${styles.avatar}`}>{participant.initials}</span>)}
              </span>
              <span>{participants.map((participant) => participant.name.split(" ")[0]).join(" · ")}</span>
            </>
          ) : <span>People not yet identified</span>}
        </div>
      </div>

      <div className={styles.cardAside}>
        <span className={`${styles.status} ${status.className}`}><StatusIcon size={14} />{status.label}</span>
        <ChevronRight className={styles.chevron} size={18} aria-hidden="true" />
      </div>
    </Link>
  );
}
