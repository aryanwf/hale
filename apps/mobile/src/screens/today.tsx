import { Text, View } from "react-native";
import { dateLabel, localDate } from "@hale/contracts/time";
import { useWorkspace } from "../providers/workspace";
import { styles } from "../theme";
import { Button, Empty, Page } from "../components/ui";
import { RecordingCard } from "../components/recording-card";
import { ConversationCard, MemoryCard, type OpenConversation } from "../components/evidence";

export function TodayScreen({ open, ask, care, memories }: { open: OpenConversation; ask(): void; care(): void; memories(): void }) {
  const { space, today } = useWorkspace();
  const todaysMemories = space.memories.filter((memory) => memory.localDate === today);
  const conversations = space.conversations.filter((item) => localDate(item.startedAt, space.timezone) === today);
  return <Page eyebrow={dateLabel(today)} title={`Welcome,\n${space.name.split(" ")[0]}.`} description="Your recordings and memories for today.">
    <RecordingCard />
    <View style={[styles.card, styles.cream]}><Text style={styles.heading}>Looking for a memory?</Text><Text style={styles.small}>Ask about what’s been recorded.</Text><Button title="Ask Hale" tone="secondary" onPress={ask} /></View>
    <Text style={styles.heading}>Memories from today</Text>
    {todaysMemories.length ? todaysMemories.slice(0, 2).map((memory) => <MemoryCard key={memory.id} memory={memory} open={open} />) : <Empty title="No saved memories yet" description="Memories appear after a recording is processed. An empty day doesn’t mean nothing happened." />}
    <Button title="View memories" tone="secondary" onPress={memories} />
    <Text style={styles.heading}>Today’s conversations</Text>
    {conversations.length ? conversations.slice(0, 3).map((conversation) => <ConversationCard key={conversation.id} conversation={conversation} open={open} />) : <Empty title="No recordings today" description="Start a recording only when everyone agrees. Uploaded audio stays queued until processing is connected." />}
    <Button title="Care and everyday tasks" tone="secondary" onPress={care} />
  </Page>;
}
