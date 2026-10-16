import { Pressable, Text, View } from "react-native";
import { memoryLabels, type Conversation, type Memory } from "@hale/contracts";
import { clockLabel, durationLabel } from "@hale/contracts/time";
import { useWorkspace } from "../providers/workspace";
import { styles } from "../theme";

export type OpenConversation = (id: string, timestamp?: number) => void;
export function MemoryCard({ memory, open }: { memory: Memory; open: OpenConversation }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${memory.title}. Open original conversation`} onPress={() => open(memory.conversationId)} style={styles.card}><Text style={styles.eyebrow}>{memoryLabels[memory.kind]}</Text><Text style={styles.heading}>{memory.title}</Text><Text style={styles.body}>{memory.text}</Text><Text style={styles.small}>Original conversation ↗</Text>{memory.kind === "plan" && <Text style={styles.small}>A plan is not confirmation that it happened.</Text>}</Pressable>;
}
export function ConversationCard({ conversation, open }: { conversation: Conversation; open: OpenConversation }) {
  const { space } = useWorkspace();
  return <Pressable accessibilityRole="button" onPress={() => open(conversation.id)} style={styles.card}><View style={styles.between}><Text style={styles.eyebrow}>{clockLabel(conversation.startedAt, space.timezone)} · {durationLabel(conversation.duration)}</Text><Text style={styles.small}>{conversation.synthetic ? "Fictional" : conversation.state}</Text></View><Text style={styles.title}>{conversation.title}</Text><Text numberOfLines={3} style={styles.small}>{conversation.summary}</Text><Text style={styles.mono}>Read conversation →</Text></Pressable>;
}
