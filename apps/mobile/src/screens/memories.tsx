import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Conversation } from "@hale/contracts";
import { dateLabel, isLocalDate, localDate, shiftDate } from "@hale/contracts/time";
import { ConversationCard, MemoryCard, type OpenConversation } from "../components/evidence";
import { Button, Empty, Field, Notice, Page } from "../components/ui";
import { useWorkspace } from "../providers/workspace";
import { colors, styles } from "../theme";
import { calendarDays, shiftMonth } from "../lib/calendar";

export function MemoriesScreen({ open, ask }: { open: OpenConversation; ask(day?: string): void }) {
  const workspace = useWorkspace();
  const { space, today } = workspace;
  const [day, setDay] = useState(today);
  const [text, setText] = useState("");
  const [allDays, setAllDays] = useState(false);
  const [results, setResults] = useState<{ conversations: Conversation[]; limited: boolean }>();
  const [error, setError] = useState("");
  const validDay = isLocalDate(day);
  const recordedDays = new Set(space.conversations.map((item) => localDate(item.startedAt, space.timezone)));
  useEffect(() => {
    if (!allDays && !isLocalDate(day)) return;
    let current = true;
    setResults(undefined); setError("");
    const timer = setTimeout(() => {
      void workspace.search(text.trim(), allDays ? undefined : day).then((value) => { if (current) setResults(value); }).catch(() => { if (current) setError("Search is unavailable. Check your connection and try again."); });
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [text, day, allDays, space, workspace.search]);
  const visible = space.memories.filter((item) => (allDays || item.localDate === day) && `${item.title} ${item.text}`.toLowerCase().includes(text.toLowerCase()));
  return <Page eyebrow="YOUR DAYS, WITHIN REACH" title="A little of what\nyou’ve shared." description="Explore a day, find a conversation, and return to the original words.">
    <Field label="Search conversations and memories" placeholder="A person, a place, a moment…" value={text} onChangeText={setText} maxLength={200} />
    <View style={[styles.card, styles.quiet]}>
      <View style={styles.between}><Button title="‹ Month" tone="secondary" disabled={!validDay} onPress={() => { setDay(shiftMonth(day, -1)); setAllDays(false); }} /><Text style={styles.small}>{validDay ? dateLabel(day, { weekday: undefined, day: undefined, month: "short", year: "numeric" }) : "Calendar"}</Text><Button title="Month ›" tone="secondary" disabled={!validDay} onPress={() => { setDay(shiftMonth(day, 1)); setAllDays(false); }} /></View>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>{["S", "M", "T", "W", "T", "F", "S"].map((label, index) => <Text key={index} style={[styles.eyebrow, { width: "14.2857%", textAlign: "center", paddingVertical: 8 }]}>{label}</Text>)}{calendarDays(day).map((date, index) => <Pressable key={date ?? `blank-${index}`} accessibilityRole="button" accessibilityLabel={date ? `${dateLabel(date)}${recordedDays.has(date) ? ", has recorded conversations" : ""}` : "Empty calendar cell"} accessibilityState={{ selected: date === day && !allDays, disabled: !date }} disabled={!date} onPress={() => { if (date) { setDay(date); setAllDays(false); } }} style={{ width: "14.2857%", minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: date === day && !allDays ? colors.burgundy : "transparent" }}><Text style={[styles.small, { color: date === day && !allDays ? colors.white : colors.ink }]}>{date ? Number(date.slice(-2)) : ""}</Text><Text style={{ color: date === day && !allDays ? colors.white : colors.burgundy, fontSize: 9 }}>{date && recordedDays.has(date) ? "•" : " "}</Text></Pressable>)}</View>
      <View style={styles.row}><View style={styles.grow}><Button title="← Previous" tone="secondary" disabled={!validDay} onPress={() => { setDay(shiftDate(day, -1)); setAllDays(false); }} /></View><View style={styles.grow}><Button title="Next →" tone="secondary" disabled={!validDay} onPress={() => { setDay(shiftDate(day, 1)); setAllDays(false); }} /></View></View>
      <Field label="Calendar day (YYYY-MM-DD)" value={day} onChangeText={(value) => { setDay(value); setAllDays(false); }} maxLength={10} keyboardType="numbers-and-punctuation" />
      {!validDay && <Text style={styles.small}>Choose a valid calendar day.</Text>}
      <Text style={styles.title}>{allDays ? "All available days" : validDay ? dateLabel(day) : "Select a day"}</Text>
      <Button title={allDays ? "Show today" : "Search all days"} tone="secondary" onPress={() => { if (allDays) setDay(today); setAllDays(!allDays); }} />
      <Button title="Ask Hale about this day ↗" disabled={!allDays && !validDay} onPress={() => ask(allDays ? undefined : day)} />
    </View>
    <Text style={styles.heading}>Memories</Text>
    {visible.length ? visible.map((memory) => <MemoryCard key={memory.id} memory={memory} open={open} />) : <Empty title="A little room to remember." description="No matching memory is recorded here. This does not mean nothing happened." />}
    <Text style={styles.heading}>Conversations</Text>
    {!!error && <Notice>{error}</Notice>}
    {!error && !results && <Text style={styles.small}>Looking through your conversations…</Text>}
    {results?.conversations.map((item) => <View key={item.id} style={styles.stack}><Text style={styles.eyebrow}>{dateLabel(localDate(item.startedAt, space.timezone))}</Text><ConversationCard conversation={item} open={open} /></View>)}
    {results && !results.conversations.length && <Empty title="No matching conversations." description="Try a different word or calendar day." />}
    {results?.limited && <Notice>These results are limited. Choose a day or a more specific search to find older evidence.</Notice>}
    <Notice>Dates use {space.timezone}. Future plans are not verified events, and missing evidence never proves absence.</Notice>
  </Page>;
}
