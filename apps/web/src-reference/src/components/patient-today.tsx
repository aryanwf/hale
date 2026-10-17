"use client";

import Link from "next/link";
import { ArrowRight, CalendarDays, Sparkles, Sun } from "lucide-react";
import { dateLabel, localDate } from "@hale/contracts/time";
import { useWorkspace } from "./providers";
import { RecorderCard } from "./recorder";
import { ConversationList, EmptyState, MemoryCard, SectionHeading } from "./ui";

export function PatientToday() {
  const { space, today } = useWorkspace();
  const memories = space.memories.filter((memory) => memory.localDate === today);
  const conversations = space.conversations.filter((conversation) => localDate(conversation.startedAt, space.timezone) === today);

  return <>
    <header className="patient-greeting">
      <p className="eyebrow icon-label"><Sun size={16} />{dateLabel(today)}</p>
      <h1>Welcome,<br /><span>{space.name.split(" ")[0]}.</span></h1>
      <p>Your recordings and memories for today.</p>
    </header>
    <RecorderCard />
    <Link href="/patient/ask" className="patient-ask-card">
      <span className="ask-orb"><Sparkles size={23} /></span>
      <div><h2>Looking for a memory?</h2><p>Ask about what’s been recorded.</p></div>
      <ArrowRight size={21} />
    </Link>
    <section className="patient-section">
      <SectionHeading title="Memories from today" href={`/patient/memories?date=${today}`} link="View day" />
      {memories.length ? <div className="patient-memories">{memories.slice(0, 2).map((memory) => <MemoryCard memory={memory} base="/patient" key={memory.id} />)}</div> : <EmptyState title="No saved memories yet" description="Memories appear after a recording is processed. An empty day doesn’t mean nothing happened." />}
    </section>
    <section className="patient-section">
      <SectionHeading title="Today’s conversations" />
      <ConversationList base="/patient" conversations={conversations} compact />
    </section>
    <Link href="/patient/care" className="patient-care-link">
      <CalendarDays size={22} />
      <div><h3>Care and everyday tasks</h3><p>Connected services are not available in this build.</p></div>
      <ArrowRight size={19} />
    </Link>
  </>;
}
