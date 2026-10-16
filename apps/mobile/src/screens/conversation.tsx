import { Component, useEffect, useState, type ReactNode } from "react";
import { Alert, Text, View } from "react-native";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useQuery } from "convex/react";
import { api } from "@hale/contracts/api";
import type { Conversation, Memory, TranscriptTurn } from "@hale/contracts";
import { durationLabel } from "@hale/contracts/time";
import { Button, Empty, Loading, Notice, Page } from "../components/ui";
import { useWorkspace } from "../providers/workspace";
import { useCapture } from "../providers/capture";
import { styles } from "../theme";

interface Detail { patientId: string; conversation: Conversation; memories: Memory[]; turns: TranscriptTurn[]; audioUrl: string | null }
class SourceBoundary extends Component<{ children: ReactNode; back(): void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <Page eyebrow="SOURCE UNAVAILABLE" title="This memory has changed."><Notice>The source was deleted, your access changed, or your connection needs attention. No replacement evidence has been invented.</Notice><Button title="Go back" onPress={this.props.back} /></Page> : this.props.children;
  }
}
function AudioPlayback({ url, timestamp }: { url: string; timestamp: number }) {
  const { phase } = useCapture();
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);
  const capturing = ["starting", "recording", "saving"].includes(phase);
  useEffect(() => { if (capturing) player.pause(); }, [capturing, player]);
  return <View style={styles.stack}><Text style={styles.mono}>{durationLabel(status.currentTime)} / {durationLabel(status.duration)}</Text><Button title={status.playing ? "Pause audio" : timestamp > 0 ? `Play from ${durationLabel(timestamp)}` : "Play original audio"} disabled={capturing || !status.isLoaded} onPress={() => {
    if (status.playing) { player.pause(); return; }
    void player.seekTo(timestamp).then(() => player.play()).catch(() => Alert.alert("Audio unavailable", "The audio may have expired. Reopen the conversation to refresh its link."));
  }} />{capturing && <Text style={styles.small}>Stop microphone capture before playing audio.</Text>}</View>;
}
function DetailBody({ detail, timestamp, back }: { detail: Detail; timestamp: number; back(): void }) {
  const workspace = useWorkspace();
  const { conversation, turns, audioUrl } = detail;
  const [busy, setBusy] = useState(false);
  const { phase, pending, uploading } = useCapture();
  function confirmDelete() {
    Alert.alert("Delete this conversation?", "Its audio, transcript, and linked memories will be removed. This cannot be undone. Any unsent local copy is separate; discard it in Today.", [{ text: "Keep it", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => {
      setBusy(true);
      void workspace.removeConversation(conversation.id).then(back).catch(() => { setBusy(false); Alert.alert("Couldn’t delete", "Check your connection and permissions, then try again."); });
    } }]);
  }
  return <Page eyebrow="THE ORIGINAL WORDS" title={conversation.title} description={conversation.summary}>
    <Text style={styles.eyebrow}>{conversation.synthetic ? "FICTIONAL DEMO" : conversation.state} · {durationLabel(conversation.duration)}</Text>
    {audioUrl ? <AudioPlayback url={audioUrl} timestamp={timestamp} /> : <Notice>{conversation.synthetic ? "No real audio is attached to fictional conversations." : "Audio playback is unavailable or has expired. Cloud audio is retained for up to 7 days."}</Notice>}
    <Text style={styles.heading}>Conversation transcript</Text>
    {turns.length ? turns.map((turn) => <View key={turn.id} style={[styles.card, timestamp >= turn.start && timestamp < turn.end && styles.cream]}><Text style={styles.eyebrow}>{durationLabel(turn.start)} · {turn.uncertain ? "Uncertain speaker" : turn.speaker}</Text><Text style={styles.body}>{turn.text}</Text></View>) : <Empty title="The words aren’t ready yet." description="Your audio is queued. No transcript, memory, or speaker identity has been invented. An audio worker is not connected in this build." />}
    <Notice>Recorded statements are not verified events. A plan does not establish that something happened, and a speaker label is not proof of someone’s presence.</Notice>
    {workspace.space.capabilities.includes("evidence:delete") && <Button title={busy ? "Deleting…" : "Delete conversation & linked memories"} disabled={busy || uploading || pending.length > 0 || ["recording", "starting", "saving"].includes(phase)} tone="secondary" onPress={confirmDelete} />}
    {pending.length > 0 && <Text style={styles.small}>Upload or discard pending local audio before deleting evidence, so a queued copy cannot be retried after deletion.</Text>}
    <Button title="← Back" tone="secondary" onPress={back} />
  </Page>;
}
function LiveConversation({ id, timestamp, back }: { id: string; timestamp: number; back(): void }) {
  const { space } = useWorkspace();
  const detail = useQuery(api.detail, { conversationId: id });
  if (detail && detail.patientId !== space.id) return <Page eyebrow="SOURCE UNAVAILABLE" title="Choose the original patient space."><Button title="Go back" onPress={back} /></Page>;
  return detail ? <DetailBody detail={detail} timestamp={timestamp} back={back} /> : <Loading />;
}
function ConversationContents({ id, timestamp = 0, back }: { id: string; timestamp?: number; back(): void }) {
  const { mode, space } = useWorkspace();
  if (mode === "live") return <LiveConversation id={id} timestamp={timestamp} back={back} />;
  const conversation = space.conversations.find((item) => item.id === id);
  if (!conversation) return <Page eyebrow="SOURCE UNAVAILABLE" title="This memory has changed."><Notice>The original conversation may have been deleted. Ask again to use the remaining evidence.</Notice><Button title="Go back" onPress={back} /></Page>;
  return <DetailBody detail={{ patientId: space.id, conversation, turns: conversation.turns, memories: [], audioUrl: null }} timestamp={timestamp} back={back} />;
}

export function ConversationScreen(props: { id: string; timestamp?: number; back(): void }) {
  return <SourceBoundary key={props.id} back={props.back}><ConversationContents {...props} /></SourceBoundary>;
}
