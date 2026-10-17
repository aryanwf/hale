"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import {
  ArrowRight,
  ArrowUp,
  AudioLines,
  CalendarDays,
  MessageCircle,
  Plus,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import type { RecallAnswer } from "@hale/contracts";
import { recallDemo } from "@hale/contracts/recall";
import { dateLabel, durationLabel, isLocalDate, resolveDayQuestion } from "@hale/contracts/time";
import { useWorkspace } from "./providers";
import { api } from "@/lib/api";
import styles from "./ask-mockup.module.css";

interface Exchange { id: string; question: string; answer?: RecallAnswer; day?: string }

const suggestions = [
  "What did I do today?",
  "What did Grace say about Sunday?",
];

export function AskMockupView() {
  const params = useSearchParams();
  const rawDate = params.get("date");
  const day = isLocalDate(rawDate) ? rawDate : undefined;
  return <AskMockupThread key={day ?? "all"} day={day} />;
}

function AskMockupThread({ day }: { day?: string }) {
  const { space, mode, today } = useWorkspace();
  const [question, setQuestion] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [quickAccessOpen, setQuickAccessOpen] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const quickAccessRef = useRef<HTMLDivElement>(null);

  function ask(value: string) {
    const text = value.trim();
    if (!text || text.length > 1000) return;
    const answer = mode === "demo" ? recallDemo(space, text, today, day) : undefined;
    setExchanges((current) => [
      ...current.slice(-19),
      { id: crypto.randomUUID(), question: text, answer, day: resolveDayQuestion(text, today, day) },
    ]);
    setQuestion("");
    if (input.current) {
      input.current.focus();
      input.current.style.height = "";
    }
  }

  useEffect(() => {
    if (!exchanges.length) return;
    const latest = document.getElementById(`ask-mockup-${exchanges[exchanges.length - 1].id}`);
    latest?.scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "nearest",
    });
  }, [exchanges]);

  useEffect(() => {
    if (!quickAccessOpen) return;
    function closeOnOutsideClick(event: PointerEvent) {
      if (!quickAccessRef.current?.contains(event.target as Node)) setQuickAccessOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setQuickAccessOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [quickAccessOpen]);

  function grow(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 120)}px`;
  }

  return <div className={styles.askMockup}>
    <header className={styles.intro}>
      <h1>Find <span>a memory.</span></h1>
      <p className={styles.introDescription}>Ask about recorded conversations.</p>
    </header>

    <div className={styles.content}>
      <section className={styles.chatPanel} aria-label="Ask Hale">
        <header className={styles.toolbar}>
          <div className={styles.assistantIdentity}>
            <span className={styles.assistantIcon}><Sparkles size={17} /></span>
            <span className={styles.assistantCopy}><strong>Ask Hale</strong></span>
          </div>
          <div className={styles.toolbarActions}>
            <span className={styles.scopePill}>
              <CalendarDays size={15} />
              {day ? dateLabel(day, { weekday: undefined, month: "short" }) : "All memories"}
              {day && <Link href="/family/ask" aria-label="Clear selected day" className={styles.clearScope}><X size={14} /></Link>}
            </span>
            <div className={styles.quickAccess} ref={quickAccessRef}>
              <button
                type="button"
                className={styles.quickAccessToggle}
                aria-label="Toggle quick access"
                aria-expanded={quickAccessOpen}
                aria-controls="ask-quick-access-menu"
                onClick={() => setQuickAccessOpen((open) => !open)}
              >
                <span>Quick access</span>
                <span className={styles.quickAccessOrb}><Plus size={17} /></span>
              </button>
              <div
                id="ask-quick-access-menu"
                className={`${styles.quickMenu} ${quickAccessOpen ? styles.quickMenuOpen : ""}`}
                aria-hidden={!quickAccessOpen}
                inert={!quickAccessOpen}
              >
                <nav className={styles.quickMenuLinks} aria-label="Explore your memories">
                  <Link href="/family/calendar" tabIndex={quickAccessOpen ? 0 : -1}>
                    <span className={styles.quickMenuIcon}><CalendarDays size={17} /></span><span>Explore a day</span><ArrowRight size={15} />
                  </Link>
                  <Link href="/family/conversations" tabIndex={quickAccessOpen ? 0 : -1}>
                    <span className={styles.quickMenuIcon}><MessageCircle size={17} /></span><span>Conversations</span><ArrowRight size={15} />
                  </Link>
                  <Link href="/family/care" tabIndex={quickAccessOpen ? 0 : -1}>
                    <span className={styles.quickMenuIcon}><ShieldCheck size={17} /></span><span>Care &amp; tasks</span><ArrowRight size={15} />
                  </Link>
                </nav>
              </div>
            </div>
          </div>
        </header>

        <div className={styles.conversationBody}>
          {!exchanges.length && <div className={styles.welcome}>
            <div className={styles.welcomeMessage}>
              <span className={styles.responseIcon}><Sparkles size={20} /></span>
              <p className={styles.welcomeTitle}>What would you like to remember?</p>
              <p className={styles.welcomeDescription}>Ask Hale about a moment, a conversation, or a small detail.</p>
            </div>
          </div>}

          <div className={styles.exchanges} aria-live="polite">
            {exchanges.map((exchange) => <article className={styles.exchange} id={`ask-mockup-${exchange.id}`} key={exchange.id}>
              <div className={styles.userMessage}>
                <p>{exchange.question}</p>
              </div>
              <div className={styles.assistantMessage}>
                <span className={styles.responseIcon}><Sparkles size={15} /></span>
                <div className={styles.responseContent}>
                  <span className={styles.messageLabel}>HALE</span>
                  {exchange.day && <p className={styles.resolvedScope}>Looking at {dateLabel(exchange.day, { year: "numeric" })}</p>}
                  {mode === "live" ? <LiveAnswer patientId={space.id} exchange={exchange} /> : exchange.answer && <AnswerBody answer={exchange.answer} checkLoadedSources />}
                </div>
              </div>
            </article>)}
          </div>
        </div>

        <footer className={styles.composer}>
          {!exchanges.length && <div className={styles.suggestions} aria-label="Suggested questions">
            {suggestions.map((text) => <button key={text} type="button" onClick={() => ask(text)}>
              <span>{text}</span><ArrowRight size={15} />
            </button>)}
          </div>}
          <form className={styles.askForm} onSubmit={(event) => { event.preventDefault(); ask(question); }}>
            <label className="sr-only" htmlFor="ask-mockup-question">Your question</label>
            <textarea
              id="ask-mockup-question"
              ref={input}
              value={question}
              maxLength={1000}
              rows={1}
              placeholder="Write a message…"
              onChange={(event) => { setQuestion(event.target.value); grow(event.target); }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  ask(question);
                }
              }}
            />
            <button className={styles.sendButton} type="submit" aria-label="Send question" disabled={!question.trim()}><ArrowUp size={19} /></button>
          </form>
          <p className={styles.chatFootnote}>Questions stay here; answers aren’t saved.</p>
        </footer>
      </section>

    </div>
  </div>;
}

function LiveAnswer({ patientId, exchange }: { patientId: string; exchange: Exchange }) {
  const answer = useQuery(api.recall, { patientId, question: exchange.question, day: exchange.day });
  return answer ? <AnswerBody answer={answer} /> : <p className={styles.loadingAnswer} role="status">Looking through your recorded words…</p>;
}

function AnswerBody({ answer, checkLoadedSources = false }: { answer: RecallAnswer; checkLoadedSources?: boolean }) {
  const { space } = useWorkspace();
  const missing = checkLoadedSources && answer.citations.some((citation) =>
    !space.conversations.some((conversation) => conversation.id === citation.conversationId && conversation.turns.some((turn) => turn.id === citation.turnId)),
  );

  return <>
    <p className={styles.answerText}>{missing ? "A source for this answer has been deleted. Ask again to use only the remaining memories." : answer.text}</p>
    {!missing && answer.citations.length > 0 && <div className={styles.citationList}>
      {answer.citations.map((citation, index) => <Link
        key={`${citation.turnId}-${index}`}
        href={`/family/conversations/${citation.conversationId}#${citation.turnId}`}
        className={styles.citation}
      >
        <AudioLines size={16} />
        <span><strong>{citation.label}</strong><span>{durationLabel(citation.timestamp)} · “{citation.excerpt}”</span></span>
        <ArrowRight size={15} />
      </Link>)}
    </div>}
  </>;
}
