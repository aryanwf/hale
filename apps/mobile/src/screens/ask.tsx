import { useState } from "react";
import { Text, View } from "react-native";
import { useQuery } from "convex/react";
import { api } from "@hale/contracts/api";
import type { RecallAnswer } from "@hale/contracts";
import { recallDemo } from "@hale/contracts/recall";
import { dateLabel, durationLabel, resolveDayQuestion } from "@hale/contracts/time";
import { Button, Field, Notice, Page } from "../components/ui";
import type { OpenConversation } from "../components/evidence";
import { useWorkspace } from "../providers/workspace";
import { styles } from "../theme";

interface Exchange { id: number; question: string; day?: string }
function Answer({ answer, open }: { answer: RecallAnswer; open: OpenConversation }) {
  return <View style={styles.stack}><Text style={styles.body}>{answer.text}</Text>{answer.citations.map((citation, index) => <View key={`${citation.turnId}-${index}`} style={[styles.card, styles.quiet]}><Text style={styles.small}>{citation.label} · {durationLabel(citation.timestamp)}</Text><Text style={styles.body}>“{citation.excerpt}”</Text><Button title="Read original words ↗" tone="secondary" onPress={() => open(citation.conversationId, citation.timestamp)} /></View>)}</View>;
}
function LiveAnswer({ exchange, open }: { exchange: Exchange; open: OpenConversation }) {
  const { space } = useWorkspace();
  const answer = useQuery(api.recall, { patientId: space.id, question: exchange.question, ...(exchange.day ? { day: exchange.day } : {}) });
  return answer ? <Answer answer={answer} open={open} /> : <Text style={styles.small}>Looking through your recorded words…</Text>;
}
function DemoAnswer({ exchange, open }: { exchange: Exchange; open: OpenConversation }) {
  const { space, today } = useWorkspace();
  return <Answer answer={recallDemo(space, exchange.question, today, exchange.day)} open={open} />;
}

export function AskScreen({ day, open, care }: { day?: string; open: OpenConversation; care(): void }) {
  const { mode, today } = useWorkspace();
  const [question, setQuestion] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  function ask(value: string) {
    const text = value.trim();
    if (!text || text.length > 1000) return;
    setExchanges((current) => [...current.slice(-19), { id: Date.now(), question: text, day: resolveDayQuestion(text, today, day) }]);
    setQuestion("");
  }
  return <Page eyebrow="A LITTLE HELP REMEMBERING" title="Let’s find\nthat memory." description="Ask in your own words. We’ll start with what’s been recorded.">
    <Text style={styles.eyebrow}>{day ? `LOOKING AT ${dateLabel(day)}` : "ALL AVAILABLE MEMORIES"}</Text>
    {!exchanges.length && <View style={[styles.card, styles.cream]}><Text style={styles.heading}>A familiar moment is\na question away.</Text>{["What did I do today?", "What did Grace say about Sunday?", "Who did I speak with yesterday?", "Where did I leave my keys?"].map((value) => <Button key={value} title={value} tone="secondary" onPress={() => ask(value)} />)}</View>}
    {exchanges.map((exchange) => <View key={exchange.id} style={styles.stack}><View style={[styles.card, styles.blush]}><Text style={styles.eyebrow}>YOU ASKED</Text><Text style={styles.body}>{exchange.question}</Text></View><View style={styles.card}><Text style={styles.eyebrow}>HALE · SOURCE-BOUND RECALL</Text>{exchange.day && <Text style={styles.small}>{dateLabel(exchange.day)}</Text>}{mode === "live" ? <LiveAnswer exchange={exchange} open={open} /> : <DemoAnswer exchange={exchange} open={open} />}</View></View>)}
    <Field label="Your question" placeholder="What would you like to remember?" value={question} onChangeText={setQuestion} maxLength={1000} multiline />
    <Button title="Ask Hale →" disabled={!question.trim()} onPress={() => ask(question)} />
    <Notice>Source-bound text recall, not AI-generated advice or semantic search. The latest 20 questions stay on this screen only and are not saved as memories. When evidence is missing, we’ll say so.</Notice>
    <Button title="Rides, appointments & medication records" tone="secondary" onPress={care} />
  </Page>;
}
