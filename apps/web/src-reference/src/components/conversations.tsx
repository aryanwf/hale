"use client";

import { useDeferredValue, useState } from "react";
import { useQuery } from "convex/react";
import { Search, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { localDate } from "@hale/contracts/time";
import { useWorkspace } from "./providers";
import { ConversationList, PageIntro, PrivacyNote } from "./ui";
import { api } from "@/lib/api";

export function ConversationsView() {
  const { space, today, mode } = useWorkspace();
  const searchParams = useSearchParams();
  const searchText = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(searchText);
  const [person, setPerson] = useState("");
  const [range, setRange] = useState("all");
  const filtered = [...space.conversations].filter((conversation) =>
    (!person || conversation.people.includes(person)) &&
    (range !== "today" || localDate(conversation.startedAt, space.timezone) === today) &&
    (!query || `${conversation.title} ${conversation.summary} ${conversation.turns.map((turn) => turn.text).join(" ")}`.toLowerCase().includes(query.toLowerCase())),
  ).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return <>
    <PageIntro eyebrow="YOUR RECORDINGS" title="Conversations" description="Search recordings and open a conversation to review its source." />
    <div className="filter-bar"><label className="search-input"><Search size={18} /><input id="conversation-search" type="search" aria-label="Search conversations" placeholder="Search words or titles" maxLength={200} value={query} onChange={(event) => setQuery(event.target.value)} /></label><select aria-label="Filter by person" value={person} onChange={(event) => setPerson(event.target.value)}><option value="">All people</option>{space.people.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select aria-label="Filter date range" value={range} onChange={(event) => setRange(event.target.value)}><option value="all">Any date</option><option value="today">Today</option></select>{(query || person || range !== "all") && <button className="btn btn-text" onClick={() => { setQuery(""); setPerson(""); setRange("all"); }}><X size={15} />Clear filters</button>}</div>
    {mode === "live" ? <LiveResults patientId={space.id} text={query} day={range === "today" ? today : undefined} personId={person || undefined} /> : <><div className="results-label eyebrow" role="status">{filtered.length} {filtered.length === 1 ? "CONVERSATION" : "CONVERSATIONS"}{query && ` MATCHING “${query}”`}</div><ConversationList conversations={filtered} /></>}
    <div className="bottom-callout"><PrivacyNote>{mode === "live" ? "Search looks through authorized recordings, transcripts, and memories. Results may be limited; add a date or person to narrow them." : "Search covers fictional records only."} A recording does not prove that an event happened.</PrivacyNote></div>
  </>;
}

function LiveResults({ patientId, text, day, personId }: { patientId: string; text: string; day?: string; personId?: string }) {
  const term = useDeferredValue(text.trim());
  const result = useQuery(api.searchConversations, { patientId, text: term, day, personId });
  if (!result) return <p className="results-label muted" role="status">Searching…</p>;
  return <div aria-busy={term !== text.trim()}><p className="results-label eyebrow" role="status">{result.conversations.length} {result.conversations.length === 1 ? "CONVERSATION" : "CONVERSATIONS"}{result.limited && " · LIMITED RESULTS"}</p><ConversationList conversations={result.conversations} /></div>;
}
