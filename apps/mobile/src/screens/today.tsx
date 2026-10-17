import { Pressable, ScrollView, Text, View } from "react-native";
import { ArrowRight, CalendarDays, Sparkles, Sun } from "lucide-react-native";
import { dateLabel, localDate } from "@hale/contracts/time";
import { useWorkspace } from "../providers/workspace";
import { colors, styles } from "../theme";
import { Empty } from "../components/ui";
import { RecordingCard } from "../components/recording-card";
import { ConversationGroupList, MemoryCard, type OpenConversation } from "../components/evidence";
import { LegacyRecordings } from "../components/legacy-recordings";

export function TodayScreen({ open, ask, care, memories }: { open: OpenConversation; ask(): void; care(): void; memories(): void }) {
  const { space, today } = useWorkspace();
  const todaysMemories = space.memories.filter((memory) => memory.localDate === today);
  const conversations = space.conversations.filter((item) => localDate(item.startedAt, space.timezone) === today);
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    <View style={styles.pageIntro}>
      <View style={styles.row}><Sun size={16} color={colors.muted} strokeWidth={1.7} /><Text style={styles.eyebrow}>{dateLabel(today)}</Text></View>
      <Text accessibilityRole="header" style={styles.headline}>Welcome,{"\n"}<Text style={styles.greetingName}>{space.name.split(" ")[0]}.</Text></Text>
    </View>
    <RecordingCard />
    <LegacyRecordings />
    <Pressable accessibilityRole="button" onPress={ask} style={[styles.card, styles.quiet, styles.row]}>
      <View style={styles.recordIcon}><Sparkles size={23} color={colors.burgundy} strokeWidth={1.7} /></View>
      <View style={styles.grow}><Text style={styles.title}>Ask about a memory</Text></View>
      <ArrowRight size={20} color={colors.burgundy} />
    </Pressable>
    <View style={styles.section}>
      <View style={styles.between}><Text style={styles.heading}>Memories from today</Text><Pressable accessibilityRole="button" onPress={memories} style={{ minHeight: 44, justifyContent: "center" }}><Text style={styles.textLink}>View day →</Text></Pressable></View>
      {todaysMemories.length ? todaysMemories.slice(0, 2).map((memory) => <MemoryCard key={memory.id} memory={memory} open={open} />) : <Empty title="No saved memories yet" />}
    </View>
    <View style={styles.section}>
      <Text style={styles.heading}>Today’s conversations</Text>
      <View style={{ borderTopWidth: 1, borderColor: colors.ink }}>
        {conversations.length ? <ConversationGroupList conversations={conversations} open={open} limit={5} /> : <Empty title="No conversations yet" />}
      </View>
    </View>
    <Pressable accessibilityRole="button" onPress={care} style={[styles.row, { borderTopWidth: 1, borderColor: colors.border, paddingVertical: 24, marginTop: 12 }]}>
      <CalendarDays size={22} color={colors.burgundy} strokeWidth={1.7} /><View style={styles.grow}><Text style={styles.title}>Care and everyday tasks</Text><Text style={styles.small}>Connected services are not available yet.</Text></View><ArrowRight size={18} color={colors.burgundy} />
    </Pressable>
  </ScrollView>;
}
