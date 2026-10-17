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
  return <Page eyebrow={dateLabel(today)} title={`Good to see you,\n${space.name.split(" ")[0]}.`} description="Your day, a little easier to come back to.">
    <RecordingCard />
    <View style={[styles.card, styles.cream]}><Text style={styles.heading}>A question on your mind?</Text><Text style={styles.small}>Let’s find a memory together.</Text><Button title="Ask Hale  ↗" tone="secondary" onPress={ask} /></View>
    <Text style={styles.heading}>A little of today</Text>
    {todaysMemories.length ? todaysMemories.slice(0, 2).map((memory) => <MemoryCard key={memory.id} memory={memory} open={open} />) : <Empty title="A new day, a little space." description="Memories appear after processing. An empty page doesn’t mean nothing happened." />}
    <Button title="Explore your memories →" tone="secondary" onPress={memories} />
    <Text style={styles.heading}>Recent conversations</Text>
    {conversations.length ? conversations.slice(0, 3).map((conversation) => <ConversationCard key={conversation.id} conversation={conversation} open={open} />) : <Empty title="Room for a conversation." description="Start with a consented recording. Uploaded audio appears as queued until an audio worker is connected." />}
    <Button title="Rides, appointments & medication records" tone="secondary" onPress={care} />
  </Page>;
}
