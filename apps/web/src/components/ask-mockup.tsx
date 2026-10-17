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
  "Who did I speak with yesterday?",
  "Where did I leave my keys?",
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
  const input = useRef<HTMLTextAreaElement>(null);

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

  function grow(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 120)}px`;
  }

  return <div className={styles.askMockup}>
    <header className={styles.intro}>
      <p className={styles.eyebrow}><Sparkles size={15} /> A LITTLE HELP REMEMBERING</p>
      <h1>Find <span>a memory.</span></h1>
      <p className={styles.introDescription}>Ask about what’s been recorded.</p>
    </header>

    <div className={styles.content}>
      <div className={styles.workspace}>
        <section className={styles.chatPanel} aria-label="Ask Hale">
        <header className={styles.toolbar}>
          <div className={styles.assistantIdentity}>
            <span className={styles.assistantIcon}><Sparkles size={17} /></span>
            <span className={styles.assistantCopy}><strong>Ask Hale</strong><span>Answers from your recorded conversations</span></span>
          </div>
          <span className={styles.scopePill}>
            <CalendarDays size={15} />
            {day ? dateLabel(day, { weekday: undefined, month: "short" }) : "All available memories"}
            {day && <Link href="/family/ask" aria-label="Clear selected day" className={styles.clearScope}><X size={14} /></Link>}
          </span>
        </header>

        {!exchanges.length && <div className={styles.welcome}>
          <div className={styles.welcomeCopy}>
            <span className={styles.welcomeOrb}><Sparkles size={22} strokeWidth={1.5} /></span>
            <p className={styles.welcomeEyebrow}>START WITH A QUESTION</p>
            <h2>A familiar moment is closer than you think.</h2>
            <p className={styles.welcomeDescription}>Try a prompt, or type a question of your own below.</p>
          </div>
          <div className={styles.suggestions} aria-label="Suggested questions">
            {suggestions.map((text) => <button key={text} type="button" onClick={() => ask(text)}>
              <span>{text}</span><ArrowRight size={16} />
            </button>)}
          </div>
        </div>}

        <div className={styles.exchanges} aria-live="polite">
          {exchanges.map((exchange) => <article className={styles.exchange} id={`ask-mockup-${exchange.id}`} key={exchange.id}>
            <div className={styles.userMessage}>
              <span className={styles.messageLabel}>YOU ASKED</span>
              <p>{exchange.question}</p>
            </div>
            <div className={styles.assistantMessage}>
              <span className={styles.responseIcon}><Sparkles size={15} /></span>
              <div className={styles.responseContent}>
                <span className={styles.messageLabel}>HALE · EXTRACTIVE RECALL</span>
                {exchange.day && <p className={styles.resolvedScope}>Looking at {dateLabel(exchange.day, { year: "numeric" })}</p>}
                {mode === "live" ? <LiveAnswer patientId={space.id} exchange={exchange} /> : exchange.answer && <AnswerBody answer={exchange.answer} checkLoadedSources />}
              </div>
            </div>
          </article>)}
        </div>

        <form className={styles.askForm} onSubmit={(event) => { event.preventDefault(); ask(question); }}>
          <label className="sr-only" htmlFor="ask-mockup-question">Your question</label>
          <textarea
            id="ask-mockup-question"
            ref={input}
            value={question}
            maxLength={1000}
            rows={1}
            placeholder="What would you like to remember?"
            onChange={(event) => { setQuestion(event.target.value); grow(event.target); }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                ask(question);
              }
            }}
          />
          <button className={styles.sendButton} type="submit" aria-label="Ask Hale" disabled={!question.trim()}><ArrowUp size={19} /></button>
        </form>
        <div className={styles.chatFootnote}>
          <span>Press Enter to ask <i>·</i> Shift + Enter for a new line</span>
          <span>Answers are not saved as memories</span>
        </div>
        </section>

        <aside className={styles.explorePanel} aria-label="Memory tools">
          <header className={styles.sideHeading}>
            <p className={styles.sideEyebrow}>QUICK ACCESS</p>
            <h2>Your memory tools</h2>
          </header>
          <nav className={styles.resourceLinks} aria-label="Explore your memories">
            <Link href="/family/calendar">
              <span className={styles.resourceIcon}><CalendarDays size={17} /></span>
              <span className={styles.resourceCopy}><strong>Explore a day</strong><span>Browse recorded moments</span></span>
              <ArrowRight size={15} />
            </Link>
            <Link href="/family/conversations">
              <span className={styles.resourceIcon}><MessageCircle size={17} /></span>
              <span className={styles.resourceCopy}><strong>Conversations</strong><span>Read the original words</span></span>
              <ArrowRight size={15} />
            </Link>
            <Link href="/family/care">
              <span className={styles.resourceIcon}><ShieldCheck size={17} /></span>
              <span className={styles.resourceCopy}><strong>Care &amp; tasks</strong><span>Plans and everyday support</span></span>
              <ArrowRight size={15} />
            </Link>
          </nav>
        </aside>
      </div>

      <footer className={styles.groundingNote}>
        <ShieldCheck size={19} />
        <div className={styles.groundingCopy}>
          <h2>Grounded in your words.</h2>
          <p>Hale is honest about the gaps. Chats stay separate from your evidence, and a plan is not proof that something happened.</p>
        </div>
      </footer>
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
