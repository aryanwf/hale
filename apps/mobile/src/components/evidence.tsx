import { Pressable, Text, View } from "react-native";
import { memoryLabels, type Conversation, type Memory } from "@hale/contracts";
import { clockLabel, durationLabel } from "@hale/contracts/time";
import { useWorkspace } from "../providers/workspace";
import { styles } from "../theme";

export type OpenConversation = (id: string, timestamp?: number) => void;
export function MemoryCard({ memory, open }: { memory: Memory; open: OpenConversation }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${memory.title}. Open original conversation`} onPress={() => open(memory.conversationId)} style={styles.card}><Text style={styles.eyebrow}>{memoryLabels[memory.kind]}</Text><Text style={styles.heading}>{memory.title}</Text><Text style={styles.body}>{memory.text}</Text><Text style={styles.small}>Original conversation ↗</Text></Pressable>;
}
export function ConversationCard({ conversation, open }: { conversation: Conversation; open: OpenConversation }) {
  const { space } = useWorkspace();
  const status = conversation.synthetic ? "Fictional" : { queued: "Queued", processing: "Processing", ready: "Ready", failed: "Could not process" }[conversation.state];
  return <Pressable accessibilityRole="button" accessibilityLabel={`${conversation.title}. ${status}. Open conversation`} onPress={() => open(conversation.id)} style={styles.conversationRow}><View style={styles.between}><Text style={styles.eyebrow}>{clockLabel(conversation.startedAt, space.timezone)} · {durationLabel(conversation.duration)}</Text><Text style={styles.small}>{status}</Text></View><View style={styles.between}><Text style={[styles.title, styles.grow]}>{conversation.title}</Text><Text style={styles.textLink}>→</Text></View><Text numberOfLines={2} style={styles.small}>{conversation.summary}</Text></Pressable>;
}
