import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Conversation } from "@hale/contracts";
import { dateLabel, localDate } from "@hale/contracts/time";
import { ConversationCard, MemoryCard, type OpenConversation } from "../components/evidence";
import { Button, Empty, Field, Notice, Page } from "../components/ui";
import { useWorkspace } from "../providers/workspace";
import { styles } from "../theme";
import { calendarDays, shiftMonth } from "../lib/calendar";

export function MemoriesScreen({ open, ask }: { open: OpenConversation; ask(day?: string): void }) {
  const workspace = useWorkspace();
  const { space, today } = workspace;
  const [day, setDay] = useState(today);
  const [text, setText] = useState("");
  const [allDays, setAllDays] = useState(false);
  const [results, setResults] = useState<{ conversations: Conversation[]; limited: boolean }>();
  const [error, setError] = useState("");
  const recordedDays = new Set(space.conversations.map((item) => localDate(item.startedAt, space.timezone)));

  useEffect(() => {
    let current = true;
    setResults(undefined);
    setError("");
    const timer = setTimeout(() => {
      void workspace.search(text.trim(), allDays ? undefined : day)
        .then((value) => { if (current) setResults(value); })
        .catch(() => { if (current) setError("Search is unavailable. Check your connection and try again."); });
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [text, day, allDays, space, workspace.search]);

  const visible = space.memories.filter((item) => (allDays || item.localDate === day) && `${item.title} ${item.text}`.toLowerCase().includes(text.toLowerCase()));
  const monthStart = `${day.slice(0, 7)}-01`;

  return <Page eyebrow="YOUR RECORDINGS AND NOTES" title="Memories" description="Choose a day or search for a word to find a conversation.">
    <Field label="Search memories and conversations" placeholder="Search words or titles" value={text} onChangeText={setText} maxLength={200} />
    <View style={styles.card}>
      <View style={styles.between}>
        <Button accessibilityLabel="Previous month" title="‹" tone="secondary" onPress={() => { setDay(shiftMonth(day, -1)); setAllDays(false); }} />
        <Text style={styles.title}>{dateLabel(monthStart, { weekday: undefined, day: undefined, month: "long", year: "numeric" })}</Text>
        <Button accessibilityLabel="Next month" title="›" tone="secondary" onPress={() => { setDay(shiftMonth(day, 1)); setAllDays(false); }} />
      </View>
      <View style={styles.calendarGrid}>
        {["S", "M", "T", "W", "T", "F", "S"].map((label, index) => <Text key={`${label}-${index}`} style={styles.calendarWeekday}>{label}</Text>)}
        {calendarDays(day).map((date, index) => {
          const selected = date === day && !allDays;
          return <Pressable key={date ?? `blank-${index}`} accessibilityRole="button" accessibilityLabel={date ? `${dateLabel(date)}${recordedDays.has(date) ? ", recordings available" : ""}` : "Empty calendar cell"} accessibilityState={{ selected, disabled: !date }} disabled={!date} onPress={() => { if (date) { setDay(date); setAllDays(false); } }} style={[styles.calendarCell, selected && styles.calendarCellSelected]}>
            <Text style={[styles.small, selected && styles.calendarSelectedText]}>{date ? Number(date.slice(-2)) : ""}</Text>
            {date && recordedDays.has(date) && <View style={[styles.calendarDot, selected && styles.calendarDotSelected]} />}
          </Pressable>;
        })}
      </View>
      <Text style={styles.small}>{allDays ? "All available dates" : dateLabel(day, { weekday: "long", month: "long", day: "numeric" })}</Text>
      <View style={styles.row}>
        <View style={styles.grow}><Button title={allDays ? "Selected day" : "All dates"} tone="secondary" onPress={() => setAllDays(!allDays)} /></View>
      </View>
      <Button title={allDays ? "Ask about all dates" : "Ask about this day"} onPress={() => ask(allDays ? undefined : day)} />
    </View>

    <Text style={styles.heading}>Saved memories</Text>
    {visible.length ? visible.map((memory) => <MemoryCard key={memory.id} memory={memory} open={open} />) : <Empty title="No saved memories" description="No saved memories match this date or search." />}
    <Text style={styles.heading}>Conversations</Text>
    {!!error && <Notice>{error}</Notice>}
    {!error && !results && <Text accessibilityLiveRegion="polite" style={styles.small}>Searching…</Text>}
    {results?.conversations.map((item) => <View key={item.id} style={styles.stack}><Text style={styles.eyebrow}>{dateLabel(localDate(item.startedAt, space.timezone))}</Text><ConversationCard conversation={item} open={open} /></View>)}
    {results && !results.conversations.length && <Empty title="No matching conversations" description="Try another search or date." />}
    {results?.limited && <Notice>Showing a limited set of results. Choose a date or add a search word to narrow them.</Notice>}
  </Page>;
}
