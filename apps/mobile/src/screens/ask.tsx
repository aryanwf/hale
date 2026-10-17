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
  return <Page eyebrow="SEARCH YOUR RECORDED WORDS" title="Ask Hale" description="Ask a question to find matching words in available recordings.">
    <Text style={styles.eyebrow}>{day ? `DATE: ${dateLabel(day)}` : "ALL AVAILABLE DATES"}</Text>
    {!exchanges.length && <View style={[styles.card, styles.cream]}><Text style={styles.heading}>What would you like to find?</Text>{["What was recorded today?", "What was said about Sunday?", "Who spoke in a recording?"].map((value) => <Button key={value} title={value} tone="secondary" onPress={() => ask(value)} />)}</View>}
    {exchanges.map((exchange) => <View key={exchange.id} style={styles.stack}><View style={[styles.card, styles.blush]}><Text style={styles.eyebrow}>YOU ASKED</Text><Text style={styles.body}>{exchange.question}</Text></View><View style={styles.card}><Text style={styles.eyebrow}>HALE · FROM YOUR RECORDINGS</Text>{exchange.day && <Text style={styles.small}>{dateLabel(exchange.day)}</Text>}{mode === "live" ? <LiveAnswer exchange={exchange} open={open} /> : <DemoAnswer exchange={exchange} open={open} />}</View></View>)}
    <Field label="Your question" placeholder="Type a question" value={question} onChangeText={setQuestion} maxLength={1000} multiline />
    <Button title="Ask Hale →" disabled={!question.trim()} onPress={() => ask(question)} />
    <Notice>Answers link to recorded words and may be incomplete. Questions are not saved as memories. Hale does not give medical advice.</Notice>
    <Button title="Care and everyday tasks" tone="secondary" onPress={care} />
  </Page>;
}
