"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ArrowRight, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock3, Headphones, Mic, ShieldCheck, Sparkles, Users } from "lucide-react";
import type { Conversation, Memory } from "@hale/contracts";
import { memoryLabels } from "@hale/contracts";
import { clockLabel, dateLabel, durationLabel, isLocalDate, localDate, shiftDate } from "@hale/contracts/time";
import { useWorkspace } from "./providers";
import { Coverage, PeopleStack, PrivacyNote } from "./ui";

export function Overview() {
  const { space, today, mode } = useWorkspace();
  const router = useRouter();
  const params = useSearchParams();
  const rawDate = params.get("date");
  const selectedDate = isLocalDate(rawDate) ? rawDate : today;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const conversations = space.conversations
    .filter((conversation) => localDate(conversation.startedAt, space.timezone) === selectedDate)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const memories = space.memories.filter((memory) => memory.localDate === selectedDate);
  const people = space.people
    .filter((person) => person.relationship !== "You · patient")
    .map((person) => {
      const personConversations = conversations.filter((conversation) => conversation.people.includes(person.id));
      const latest = [...space.conversations]
        .filter((conversation) => conversation.people.includes(person.id))
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
      return { person, personConversations, latest };
    })
    .filter(({ personConversations }) => personConversations.length > 0);
  const unknownTurns = conversations.reduce((count, conversation) => count + conversation.turns.filter((turn) => turn.uncertain || !turn.personId).length, 0);
  const readyCount = conversations.filter((conversation) => conversation.state === "ready").length;
  const totalSeconds = conversations.reduce((total, conversation) => total + conversation.duration, 0);

  const activeExpandedId = conversations.some((conversation) => conversation.id === expandedId) ? expandedId : conversations[0]?.id;

  function selectDate(date: string) {
    router.push(`/family/overview?date=${date}`, { scroll: false });
  }

  const contextCopy = conversations.length
    ? memories.length
      ? `${conversations.length} recorded ${conversations.length === 1 ? "conversation" : "conversations"} and ${memories.length} saved ${memories.length === 1 ? "memory" : "memories"} are available for this day.`
      : `${conversations.length} recorded ${conversations.length === 1 ? "conversation is" : "conversations are"} available. Saved memories will appear after processing.`
    : selectedDate === today
      ? "Nothing has been recorded for today yet. Start a consented session when you’re ready."
      : `No recorded conversations are available for ${dateLabel(selectedDate, { weekday: "long", month: "long", day: "numeric" })}.`;

  return <div className="archive-page">
    <section className="archive-hero" aria-labelledby="archive-title">
      <div className="archive-hero-copy">
        <p className="archive-kicker"><span className="archive-live-dot" />{mode === "demo" ? "Demo archive · synthetic records" : "Private family archive"}</p>
        <h1 id="archive-title">A day<br /><em>in context.</em></h1>
        <p className="archive-hero-description">{contextCopy}</p>
        <div className="archive-hero-actions">
          <Link className="btn btn-primary" href={`/family/ask?date=${selectedDate}`}><Sparkles size={16} />Ask Hale</Link>
          <Link className="archive-secondary-action" href={`/family/calendar?date=${selectedDate}`}>Open the calendar<ArrowRight size={15} /></Link>
        </div>
        <p className="archive-evidence-note"><ShieldCheck size={15} />Only recorded words and saved memories appear here.</p>
      </div>
      <div className="archive-hero-art" aria-label={`Memory archive for ${space.name}`} role="img">
        <div className="archive-filmstrip" aria-hidden>{Array.from({ length: 7 }, (_, index) => <span key={index} />)}</div>
        <div className="archive-paper">
          <div className="archive-paper-top"><span>HALE / ARCHIVE</span><span>{selectedDate.slice(0, 4)}</span></div>
          <div className="archive-paper-middle"><div className="archive-portrait">{space.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</div><div className="archive-paper-copy"><span>ARCHIVE OWNER</span><strong>{space.name}</strong><span>{selectedDate === today ? "Today" : dateLabel(selectedDate, { month: "short", day: "numeric", year: "numeric" })}</span></div></div>
          <div className="archive-paper-rule" />
          <div className="archive-paper-bottom"><span>WORDS / MOMENTS / PEOPLE</span><span className="archive-paper-stamp">PRIVATE</span></div>
        </div>
        <p className="archive-art-caption">A living record, made from moments that were intentionally captured.</p>
      </div>
    </section>

    <div className="archive-datebar"><DateNavigator selectedDate={selectedDate} today={today} onSelect={selectDate} /><Link className="archive-calendar-link" href={`/family/calendar?date=${selectedDate}`}><CalendarDays size={15} />Full calendar<ArrowRight size={14} /></Link></div>

    <section className="archive-stats" aria-label={`Summary for ${dateLabel(selectedDate)}`}>
      <ArchiveStat index="01" value={conversations.length} label="recorded conversations" detail={conversations.length ? `${durationLabel(totalSeconds)} of available audio` : "Nothing captured on this date"} />
      <ArchiveStat index="02" value={people.length} label="familiar voices" detail={people.length ? "People linked to today’s recordings" : "Known speakers appear after identification"} />
      <ArchiveStat index="03" value={memories.length} label="saved memories" detail={memories.length ? "Sourced from the conversations below" : "Saved after processing and review"} />
    </section>

    <div className="archive-content-grid">
      <main className="archive-main-column">
        {conversations.length ? <section className="archive-timeline" aria-labelledby="timeline-title">
          <div className="archive-section-header"><div><p className="archive-section-kicker">THE DAY, AS RECORDED</p><h2 id="timeline-title">A thread of moments</h2></div><span className="archive-section-count">{conversations.length} {conversations.length === 1 ? "moment" : "moments"}</span></div>
          <p className="archive-section-intro">Open a moment to see its source, saved memories, and the people Hale could link to it.</p>
          <div className="archive-timeline-list">
            {conversations.map((conversation) => <TimelineEvent key={conversation.id} conversation={conversation} memories={memories.filter((memory) => memory.conversationId === conversation.id)} timezone={space.timezone} expanded={activeExpandedId === conversation.id} onToggle={() => setExpandedId((current) => current === conversation.id ? null : conversation.id)} />)}
          </div>
          <ArchiveQuestions selectedDate={selectedDate} />
        </section> : <ArchiveEmpty selectedDate={selectedDate} today={today} />}
      </main>
      <aside className="archive-side-column">
        <section className="archive-support-section"><div className="archive-section-header"><div><p className="archive-section-kicker">THE DAY, AT A GLANCE</p><h2>Coverage</h2></div><Clock3 size={18} aria-hidden /></div><Coverage conversations={conversations} base="/family" /></section>
        <FamiliarPeople people={people} unknownTurns={unknownTurns} timezone={space.timezone} />
        <section className="archive-insights"><p className="archive-section-kicker">FAMILY INSIGHT</p><div className="archive-insight-note"><span className="archive-insight-mark">{readyCount}</span><div><h2>{readyCount ? `${readyCount} ${readyCount === 1 ? "conversation is" : "conversations are"} ready to revisit.` : "The archive is still taking shape."}</h2><p>{conversations.length ? `${memories.length ? `${memories.length} sourced ${memories.length === 1 ? "memory is" : "memories are"} linked to this day. ` : "No saved memories have been extracted from this day yet. "}Plans remain plans; a recording is evidence of words, not proof that an activity happened.` : "Once a consented conversation is processed, its source and any saved memories will live here."}</p></div></div></section>
        <PrivacyNote>Hale keeps the gaps visible. An unrecorded period does not tell us what happened.</PrivacyNote>
      </aside>
    </div>
  </div>;
}

function DateNavigator({ selectedDate, today, onSelect }: { selectedDate: string; today: string; onSelect: (date: string) => void }) {
  const label = selectedDate === today ? "Today" : dateLabel(selectedDate, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  return <div className="archive-date-controls"><button className="archive-date-arrow" type="button" aria-label="Show the previous day" onClick={() => onSelect(shiftDate(selectedDate, -1))}><ChevronLeft size={17} /></button><Link className="archive-date-current" href={`/family/calendar?date=${selectedDate}`}><span>{label}</span><small>{selectedDate}</small></Link><button className="archive-date-arrow" type="button" aria-label="Show the next day" onClick={() => onSelect(shiftDate(selectedDate, 1))}><ChevronRight size={17} /></button>{selectedDate !== today && <button className="archive-today-button" type="button" onClick={() => onSelect(today)}>Today</button>}</div>;
}

function ArchiveStat({ index, value, label, detail }: { index: string; value: number; label: string; detail: string }) {
  return <div className={`archive-stat ${value === 0 ? "is-empty" : ""}`}><span className="archive-stat-index">{index}</span><strong>{value}</strong><span className="archive-stat-label">{label}</span><p>{detail}</p></div>;
}

function TimelineEvent({ conversation, memories, timezone, expanded, onToggle }: { conversation: Conversation; memories: Memory[]; timezone: string; expanded: boolean; onToggle: () => void }) {
  const firstTurn = conversation.turns.find((turn) => !turn.uncertain) ?? conversation.turns[0];
  const excerpt = firstTurn?.text ?? conversation.summary;
  const stateLabel = { ready: "Ready to revisit", queued: "Awaiting transcript", processing: "Still processing", failed: "Processing needs attention" }[conversation.state];
  return <article className={`archive-event ${expanded ? "is-expanded" : ""}`}>
    <div className="archive-event-time"><time dateTime={conversation.startedAt}>{clockLabel(conversation.startedAt, timezone)}</time><span>{durationLabel(conversation.duration)}</span></div>
    <div className="archive-event-main">
      <span className="archive-event-marker" aria-hidden />
      <button className="archive-event-trigger" type="button" aria-expanded={expanded} aria-controls={`archive-event-${conversation.id}`} onClick={onToggle}><span className="archive-event-heading">{conversation.title}</span><ChevronDown className="archive-event-chevron" size={18} aria-hidden /></button>
      <div className="archive-event-meta"><PeopleStack ids={conversation.people} names /><span className="archive-event-status"><span className={conversation.state === "ready" ? "archive-status-dot" : "archive-status-ring"} />{stateLabel}</span></div>
      <p className="archive-event-excerpt">“{excerpt}”</p>
      <div id={`archive-event-${conversation.id}`} className="archive-event-details" hidden={!expanded}>
        <div className="archive-event-source"><span>{firstTurn ? (firstTurn.uncertain ? "Transcript excerpt · speaker attribution uncertain" : "Transcript excerpt") : "Processing summary"}</span><span>{conversation.synthetic ? "Synthetic example" : "Recorded evidence"}</span></div>
        {conversation.audioAvailable && conversation.audioUrl ? <audio className="archive-audio" controls preload="metadata" src={conversation.audioUrl}>Your browser does not support audio playback.</audio> : conversation.audioAvailable ? <Link className="archive-audio-link" href={`/family/conversations/${conversation.id}`}><Headphones size={15} />Open the recording<ArrowRight size={14} /></Link> : null}
        {memories.length ? <div className="archive-memory-links"><p className="archive-detail-label">SAVED FROM THIS MOMENT</p>{memories.map((memory) => <Link key={memory.id} className="archive-memory-link" href={`/family/conversations/${memory.conversationId}#${memory.turnIds[0]}`}><span><small>{memoryLabels[memory.kind]}</small><strong>{memory.title}</strong><span>{memory.text}</span></span><ArrowRight size={15} /></Link>)}</div> : <p className="archive-no-memory">No saved memory is linked to this conversation yet.</p>}
        <div className="archive-event-actions"><Link className="text-link" href={`/family/conversations/${conversation.id}`}>Open full conversation<ArrowRight size={15} /></Link><Link className="text-link" href={`/family/ask?date=${localDate(conversation.startedAt, timezone)}`}><Sparkles size={14} />Ask Hale about it</Link></div>
      </div>
    </div>
  </article>;
}

function FamiliarPeople({ people, unknownTurns, timezone }: { people: Array<{ person: { id: string; name: string; relationship: string; initials: string; color: string }; personConversations: Conversation[]; latest?: Conversation }>; unknownTurns: number; timezone: string }) {
  return <section className="archive-people"><div className="archive-section-header"><div><p className="archive-section-kicker">FAMILIAR PEOPLE</p><h2>In the record</h2></div><Users size={18} aria-hidden /></div>{people.length ? <ul className="archive-people-list">{people.map(({ person, personConversations, latest }) => <li key={person.id}><Link href="/family/people" className="archive-person-row"><span className={`archive-person-avatar avatar-${person.color}`}>{person.initials}</span><span className="archive-person-copy"><strong>{person.name}</strong><span>{person.relationship} · {personConversations.length} {personConversations.length === 1 ? "conversation" : "conversations"}</span><small>{latest ? `Last recorded ${clockLabel(latest.startedAt, timezone)}` : "No recent recording"}</small></span><ArrowRight size={15} /></Link></li>)}</ul> : <p className="archive-side-empty">No familiar voices are linked to the selected day. Speaker identities appear only when the record supports them.</p>}{unknownTurns > 0 && <p className="archive-unknown"><span className="archive-unknown-dot" />{unknownTurns} {unknownTurns === 1 ? "turn remains" : "turns remain"} unknown or unverified.</p>}<Link className="archive-side-link" href="/family/people">Manage people<ArrowRight size={14} /></Link></section>;
}

function ArchiveQuestions({ selectedDate }: { selectedDate: string }) {
  return <section className="archive-ask-strip" aria-labelledby="archive-ask-title"><div><p className="archive-section-kicker">A QUESTION TO CARRY FORWARD</p><h2 id="archive-ask-title">Let Hale look a little closer.</h2><p>Ask from this day’s available records. Answers stay linked to their source.</p></div><div className="archive-question-links"><Link href={`/family/ask?date=${selectedDate}`}>What happened on this day?<ArrowRight size={14} /></Link><Link href={`/family/ask?date=${selectedDate}`}>Who did I speak with?<ArrowRight size={14} /></Link><Link href="/family/conversations">Find a conversation<ArrowRight size={14} /></Link></div></section>;
}

function ArchiveEmpty({ selectedDate, today }: { selectedDate: string; today: string }) {
  const date = dateLabel(selectedDate, { weekday: "long", month: "long", day: "numeric" });
  return <section className="archive-empty" aria-labelledby="archive-empty-title"><div className="archive-empty-mark" aria-hidden><span /><span /><span /><i /></div><div><p className="archive-section-kicker">NO RECORDED MOMENTS · {selectedDate === today ? "TODAY" : date.toUpperCase()}</p><h2 id="archive-empty-title">This page is waiting<br />for a moment.</h2><p>No conversations or saved memories are available for this date. That is a gap in the record, not a story about the day.</p><div className="archive-empty-actions"><Link className="btn btn-primary" href="/patient/today"><Mic size={16} />Start a consented recording</Link><Link className="archive-secondary-action" href={`/family/calendar?date=${selectedDate}`}>Explore the calendar<CalendarDays size={15} /></Link></div><p className="archive-empty-note"><ShieldCheck size={15} />After a conversation is processed, its source, participants, and any saved memories will appear here.</p></div></section>;
}
