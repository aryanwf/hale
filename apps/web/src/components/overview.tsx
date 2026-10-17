"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, CarFront, ChevronLeft, ChevronRight, CircleAlert, Clock3, MessageCircle, Mic, Users } from "lucide-react";
import { memoryLabels, type Memory } from "@hale/contracts";
import { clockLabel, dateLabel, localDate, shiftDate } from "@hale/contracts/time";
import { useWorkspace } from "./providers";
import { EmptyState, StatusPill } from "./ui";

function memorySourceHref(memory: Memory) {
  const turn = memory.turnIds[0];
  return `/family/conversations/${memory.conversationId}${turn ? `#${turn}` : ""}`;
}

export function Overview() {
  const { space, today } = useWorkspace();
  const [calendarMonth, setCalendarMonth] = useState(today.slice(0, 7));
  const conversations = space.conversations.filter((conversation) => localDate(conversation.startedAt, space.timezone) === today);
  const memories = space.memories.filter((memory) => memory.localDate === today);
  const recent = [...space.conversations].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 4);
  const queued = conversations.filter((conversation) => conversation.state === "queued").length;
  const processing = conversations.filter((conversation) => conversation.state === "processing").length;
  const pending = queued + processing;
  const failed = conversations.filter((conversation) => conversation.state === "failed").length;
  const calendarMonthStart = `${calendarMonth}-01`;
  const firstWeekday = new Date(`${calendarMonthStart}T12:00:00Z`).getUTCDay();
  const calendarStart = shiftDate(calendarMonthStart, -((firstWeekday + 6) % 7));
  const calendarDates = Array.from({ length: 42 }, (_, index) => shiftDate(calendarStart, index));
  const recordedDays = new Set(space.conversations.map((conversation) => localDate(conversation.startedAt, space.timezone)));

  function changeCalendarMonth(offset: number) {
    const instant = new Date(`${calendarMonthStart}T12:00:00Z`);
    instant.setUTCMonth(instant.getUTCMonth() + offset);
    setCalendarMonth(instant.toISOString().slice(0, 7));
  }

  return <>
    <header className="overview-header">
      <div>
        <h1>Family dashboard</h1>
        <p className="overview-subtitle">{space.name} <span aria-hidden="true">·</span> {dateLabel(today, { weekday: "long", month: "long", day: "numeric" })}</p>
      </div>
      <Link className="btn btn-primary overview-ask-button" href={`/family/calendar?date=${today}`}><CalendarDays size={17} />View today<ArrowRight size={15} /></Link>
    </header>

    <nav className="overview-stat-grid" aria-label="Family dashboard summary">
      <Link className="overview-stat" href={`/family/calendar?date=${today}`}><span>Recordings today</span><strong>{conversations.length}</strong></Link>
      <Link className="overview-stat" href={`/family/calendar?date=${today}`}><span>Memories today</span><strong>{memories.length}</strong></Link>
      <Link className="overview-stat" href="/family/people"><span>People profiles</span><strong>{space.people.length}</strong></Link>
      <Link className="overview-stat" href="/family/conversations"><span>Pending</span><strong>{pending}</strong></Link>
    </nav>

    {failed > 0 && <div className="overview-attention" role="status">
      <CircleAlert size={18} /><p><strong>{failed} {failed === 1 ? "recording needs" : "recordings need"} review.</strong> Check its processing status in Conversations.</p>
      <Link href="/family/conversations">Review recordings<ArrowRight size={14} /></Link>
    </div>}

    <div className="overview-support-grid">
      <section className="overview-section overview-calendar" aria-labelledby="overview-calendar-title">
        <div className="overview-section-heading">
          <div><h2 id="overview-calendar-title">Calendar</h2><p>Choose a date to explore its timeline</p></div>
          <Link href={`/family/calendar?date=${today}`}>Open calendar<ArrowRight size={14} /></Link>
        </div>
        <div className="overview-calendar-panel">
          <div className="overview-calendar-month-heading">
            <h3>{dateLabel(calendarMonthStart, { weekday: undefined, month: "long", day: undefined, year: "numeric" })}</h3>
            <div className="overview-calendar-month-controls">
              <button type="button" className="overview-calendar-nav-button" aria-label="Previous month" onClick={() => changeCalendarMonth(-1)}><ChevronLeft size={16} /></button>
              <button type="button" className="overview-calendar-nav-button" aria-label="Next month" onClick={() => changeCalendarMonth(1)}><ChevronRight size={16} /></button>
            </div>
          </div>
          <div className="overview-calendar-weekdays" aria-hidden="true">
            {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => <span key={index}>{day}</span>)}
          </div>
          <div className="overview-calendar-grid" role="group" aria-label={`Choose a date in ${dateLabel(calendarMonthStart, { month: "long", year: "numeric" })}`}>
            {calendarDates.map((date) => {
              const hasRecordings = recordedDays.has(date);
              return <Link
                key={date}
                href={`/family/calendar?date=${date}`}
                className={`overview-calendar-day${date.slice(0, 7) !== today.slice(0, 7) ? " outside-month" : ""}${date === today ? " today-day" : ""}`}
                aria-current={date === today ? "date" : undefined}
                aria-label={`${dateLabel(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}${hasRecordings ? ", has recordings" : ", no recordings"}`}
              >
                <span>{Number(date.slice(-2))}</span>
                {hasRecordings && <i aria-hidden="true" />}
              </Link>;
            })}
          </div>
          <p className="overview-calendar-legend"><i aria-hidden="true" />Days with recordings</p>
        </div>
      </section>

      <aside className="overview-section overview-quick-access" aria-labelledby="overview-quick-access-title">
        <div className="overview-section-heading"><h2 id="overview-quick-access-title">Quick access</h2></div>
        <nav aria-label="Main features">
          <Link href={`/family/ask?date=${today}`}><MessageCircle size={18} /><span>Ask Hale</span><ChevronRight size={15} /></Link>
          <Link href={`/family/calendar?date=${today}`}><CalendarDays size={18} /><span>Calendar</span><ChevronRight size={15} /></Link>
          <Link href="/family/people"><Users size={18} /><span>People</span><ChevronRight size={15} /></Link>
          <Link href="/family/care"><CarFront size={18} /><span>Care and tasks</span><ChevronRight size={15} /></Link>
          <Link href="/patient/today"><Mic size={18} /><span>Recording view</span><ChevronRight size={15} /></Link>
        </nav>
      </aside>
    </div>

    <div className="overview-feature-grid">
      <section className="overview-section overview-feature" aria-labelledby="overview-memories-title">
        <div className="overview-section-heading">
          <div><h2 id="overview-memories-title">Memories today</h2><p>Source-linked notes from today’s recordings</p></div>
          <Link href={`/family/calendar?date=${today}`} aria-label="View today's memories">View day<ArrowRight size={14} /></Link>
        </div>
        {memories.length ? <ul className="overview-memory-list">
          {memories.slice(0, 3).map((memory) => {
            const source = space.conversations.find((item) => item.id === memory.conversationId);
            return <li key={memory.id}><Link className="overview-memory-row" href={memorySourceHref(memory)}>
              <span className={`overview-memory-kind ${memory.kind === "plan" ? "is-plan" : ""}`}>{memoryLabels[memory.kind]}</span>
              <span className="overview-memory-copy"><strong>{memory.title}</strong><span>{memory.text}</span>
                {memory.kind === "plan" && <small className="overview-memory-caveat">Plan, not confirmed event</small>}
                <small className="overview-memory-source"><Clock3 size={13} />{source ? clockLabel(source.startedAt, space.timezone) : "Source unavailable"} · Open source</small>
              </span>
              <ChevronRight size={17} />
            </Link></li>;
          })}
        </ul> : <EmptyState title="No memories saved today" description={conversations.length ? "You can still review each recording and its status." : "Available notes will appear here after a conversation is recorded and processed."}>
          {!conversations.length && <Link className="text-link" href="/patient/today"><Mic size={15} />Open recording view</Link>}
        </EmptyState>}
      </section>

      <section className="overview-section overview-feature" aria-labelledby="overview-conversations-title">
        <div className="overview-section-heading">
          <div><h2 id="overview-conversations-title">Recent conversations</h2><p>Transcripts and processing status</p></div>
          <Link href="/family/conversations">View all<ArrowRight size={14} /></Link>
        </div>
        {recent.length ? <ul className="overview-conversation-list">
          {recent.map((conversation) => {
            const day = localDate(conversation.startedAt, space.timezone);
            return <li key={conversation.id}><Link className="overview-conversation-row" href={`/family/conversations/${conversation.id}`}>
              <span className="overview-conversation-date">{day === today ? "Today" : dateLabel(day, { weekday: "short", month: "short", day: "numeric" })}<small>{clockLabel(conversation.startedAt, space.timezone)} · {Math.max(1, Math.round(conversation.duration / 60))} min</small></span>
              <span className="overview-conversation-copy"><strong>{conversation.title}</strong><small>{conversation.summary}</small></span>
              <StatusPill state={conversation.state} />
              <ChevronRight className="overview-row-chevron" size={17} />
            </Link></li>;
          })}
        </ul> : <EmptyState title="No conversations yet" description="There are no recordings available in this family space."><Link className="text-link" href="/patient/today"><Mic size={15} />Open recording view</Link></EmptyState>}
      </section>
    </div>

  </>;
}
