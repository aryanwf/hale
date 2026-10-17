import { Pressable, Text, View } from "react-native";
import { groupConversationsBySession, memoryLabels, type Conversation, type Memory } from "@hale/contracts";
import { clockLabel, dateLabel, durationLabel, localDate } from "@hale/contracts/time";
import { useWorkspace } from "../providers/workspace";
import { styles } from "../theme";

export type OpenConversation = (id: string, timestamp?: number) => void;
export function MemoryCard({ memory, open }: { memory: Memory; open: OpenConversation }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${memory.title}. Open original conversation`} onPress={() => open(memory.conversationId)} style={styles.card}><Text style={styles.eyebrow}>{memoryLabels[memory.kind]}</Text><Text style={styles.heading}>{memory.title}</Text><Text style={styles.body}>{memory.text}</Text><Text style={styles.small}>Original conversation ↗</Text></Pressable>;
}
export function ConversationCard({ conversation, open, clipNumber, showDate = false }: { conversation: Conversation; open: OpenConversation; clipNumber?: number; showDate?: boolean }) {
  const { space } = useWorkspace();
  const status = conversation.synthetic ? "Fictional" : { queued: "Queued", processing: "Processing", ready: "Ready", failed: "Could not process" }[conversation.state];
  const date = showDate ? `${dateLabel(localDate(conversation.startedAt, space.timezone))} · ` : "";
  return <Pressable accessibilityRole="button" accessibilityLabel={`${clipNumber === undefined ? "" : `Clip ${clipNumber}. `}${conversation.title}. ${status}. Open conversation`} onPress={() => open(conversation.id)} style={styles.conversationRow}>
    <View style={styles.between}><Text style={styles.eyebrow}>{date}{clockLabel(conversation.startedAt, space.timezone)} · {durationLabel(conversation.duration)}</Text><Text style={styles.small}>{status}</Text></View>
    {clipNumber !== undefined && <Text style={styles.clipLabel}>Clip {clipNumber}</Text>}
    <View style={styles.between}><Text style={[styles.title, styles.grow]}>{conversation.title}</Text><Text style={styles.textLink}>→</Text></View>
    <Text numberOfLines={2} style={styles.small}>{conversation.summary}</Text>
  </Pressable>;
}

export function ConversationGroupList({ conversations, open, limit, showDate = false }: { conversations: Conversation[]; open: OpenConversation; limit?: number; showDate?: boolean }) {
  const groups = groupConversationsBySession(conversations);
  const visibleGroups = [];
  let count = 0;
  for (const group of groups) {
    if (limit !== undefined && count >= limit) break;
    visibleGroups.push(group);
    count += group.conversations.length;
  }

  return <>{visibleGroups.map((group) => {
    const isMultiClipSession = Boolean(group.recordingSessionId && group.conversations.length > 1);
    const countLabel = `${group.conversations.length} ${group.conversations.length === 1 ? "clip" : "clips"} shown`;
    return <View key={group.key} style={styles.conversationGroup}>
      {isMultiClipSession && <View style={styles.sessionHeader}><Text style={styles.sessionLabel}>Recording session</Text><Text style={styles.sessionCount}>{countLabel}</Text></View>}
      <View style={styles.stack}>{group.conversations.map((conversation, index) => <ConversationCard
        key={conversation.id}
        conversation={conversation}
        open={open}
        showDate={showDate}
        clipNumber={isMultiClipSession ? (conversation.sequence ?? index) + 1 : undefined}
      />)}</View>
    </View>;
  })}</>;
}
