import { Component, useState, type ReactNode } from "react";
import { Alert, Text, View } from "react-native";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@hale/contracts/api";
import type { Conversation, Memory, TranscriptTurn } from "@hale/contracts";
import { durationLabel } from "@hale/contracts/time";
import { Button, Empty, Loading, Notice, Page } from "../components/ui";
import { useWorkspace } from "../providers/workspace";
import { useCapture } from "../providers/capture";
import { styles } from "../theme";

interface Detail { patientId: string; conversation: Conversation; memories: Memory[]; turns: TranscriptTurn[] }
class SourceBoundary extends Component<{ children: ReactNode; back(): void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <Page eyebrow="SOURCE UNAVAILABLE" title="Conversation unavailable."><Notice>Please try again later.</Notice><Button title="Go back" onPress={this.props.back} /></Page> : this.props.children;
  }
}
function DetailBody({ detail, timestamp, back, more }: { detail: Detail; timestamp: number; back(): void; more?: ReactNode }) {
  const workspace = useWorkspace();
  const { conversation, turns } = detail;
  const [busy, setBusy] = useState(false);
  const { phase, pendingCount, uploading } = useCapture();
  const processingLabel = { queued: "Queued", processing: "Processing", ready: "Ready", failed: "Could not process" }[conversation.state];
  function confirmDelete() {
    Alert.alert("Delete this conversation?", "Audio, transcript, and memories will be deleted. This can’t be undone.", [{ text: "Keep it", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => {
      setBusy(true);
      void workspace.removeConversation(conversation.id).then(back).catch(() => { setBusy(false); Alert.alert("Couldn’t delete", "Please try again."); });
    } }]);
  }
  return <Page eyebrow="THE ORIGINAL WORDS" title={conversation.title} description={conversation.summary}>
    <Text style={styles.eyebrow}>{conversation.synthetic ? "FICTIONAL DEMO" : processingLabel} · {durationLabel(conversation.duration)}</Text>
    <Notice>{conversation.synthetic ? "No real audio is attached to fictional conversations." : "Hale deletes temporary audio after transcription and any selected speaker matching. Only transcript text remains until you delete it; processing providers receive audio to perform these tasks."}</Notice>
    <Text style={styles.heading}>Conversation transcript</Text>
    {turns.length ? turns.map((turn) => <View key={turn.id} style={[styles.transcriptTurn, timestamp >= turn.start && timestamp < turn.end && styles.cream]}><Text style={styles.eyebrow}>{durationLabel(turn.start)} · {turn.uncertain ? "Unknown speaker" : turn.speaker}</Text><Text selectable style={styles.body}>{turn.text}</Text></View>) : <Empty title={conversation.state === "queued" ? "Transcript queued" : conversation.state === "processing" ? "Listening for the next words" : conversation.state === "failed" ? "Transcript unavailable" : "No speech transcribed"} description={conversation.state === "processing" ? "New dialogue appears automatically as each audio segment is processed. Silence creates no dialogue." : "Only words returned by transcription appear here. No dialogue is invented."} />}
    {more}
    <Notice>Recorded statements are not verified events. A plan does not establish that something happened, and a speaker label is not proof of someone’s presence.</Notice>
    {workspace.space.capabilities.includes("evidence:delete") && <Button title={busy ? "Deleting…" : "Delete conversation & linked memories"} disabled={busy || uploading || pendingCount > 0 || ["recording", "starting", "saving"].includes(phase)} tone="secondary" onPress={confirmDelete} />}
    <Button title="← Back" tone="secondary" onPress={back} />
  </Page>;
}
function LiveConversation({ id, timestamp, back }: { id: string; timestamp: number; back(): void }) {
  const { space } = useWorkspace();
  const detail = useQuery(api.detail, { conversationId: id, includeTurns: false });
  const transcript = usePaginatedQuery(api.transcriptPage, { conversationId: id }, { initialNumItems: 80 });
  if (detail && detail.patientId !== space.id) return <Page eyebrow="SOURCE UNAVAILABLE" title="Choose the original patient space."><Button title="Go back" onPress={back} /></Page>;
  return detail ? <DetailBody detail={{ ...detail, turns: transcript.results }} timestamp={timestamp} back={back} more={transcript.status !== "Exhausted" && <Button title={transcript.isLoading ? "Loading dialogue…" : "Load more dialogue"} disabled={transcript.isLoading} tone="secondary" onPress={() => transcript.loadMore(80)} />} /> : <Loading />;
}
function ConversationContents({ id, timestamp = 0, back }: { id: string; timestamp?: number; back(): void }) {
  const { mode, space } = useWorkspace();
  if (mode === "live") return <LiveConversation id={id} timestamp={timestamp} back={back} />;
  const conversation = space.conversations.find((item) => item.id === id);
  if (!conversation) return <Page eyebrow="SOURCE UNAVAILABLE" title="This memory has changed."><Notice>The original conversation may have been deleted. Ask again to use the remaining evidence.</Notice><Button title="Go back" onPress={back} /></Page>;
  return <DetailBody detail={{ patientId: space.id, conversation, turns: conversation.turns, memories: [] }} timestamp={timestamp} back={back} />;
}

export function ConversationScreen(props: { id: string; timestamp?: number; back(): void }) {
  return <SourceBoundary key={props.id} back={props.back}><ConversationContents {...props} /></SourceBoundary>;
}
