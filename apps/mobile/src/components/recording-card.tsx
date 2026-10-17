import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { durationLabel } from "@hale/contracts/time";
import { useCapture } from "../providers/capture";
import { useWorkspace } from "../providers/workspace";
import { styles } from "../theme";
import { Button, Check } from "./ui";

export function RecordingCard() {
  const { space, mode } = useWorkspace();
  const { controller, phase, hasActiveRecording, seconds, pending, uploading, message } = useCapture();
  const [consent, setConsent] = useState(false);
  const [expectedPeople, setExpectedPeople] = useState<string[]>([]);
  const matchablePeople = space.people.filter((person) => person.voiceMatchingAvailable);
  const recording = phase === "recording";
  const busy = phase === "starting" || phase === "saving" || uploading;
  if (!space.capabilities.includes("recordings:create")) return <View style={styles.card}><Text style={styles.small}>This account does not have recording permission in this patient space.</Text></View>;
  return <View style={[styles.card, styles.blush]}>
    <View style={styles.between}><Text style={styles.eyebrow}>{recording ? "RECORDING" : "RECORD A CONVERSATION"}</Text><Text style={styles.mono}>{durationLabel(seconds)}</Text></View>
    <Text style={styles.heading}>{recording ? "Recording in progress" : phase === "paused" ? "Recording paused" : "Transcribe a conversation"}</Text>
    <Text style={styles.small}>{recording ? "Capture continues with the screen locked. Pause or stop whenever you like." : "Audio is temporary processing input. Hale keeps the transcript, not a playable recording."}</Text>
    {!recording && !busy && <Check checked={consent} onChange={() => setConsent(!consent)}>Everyone taking part agrees to be recorded, including while Hale is in the background.</Check>}
    {!recording && !busy && matchablePeople.map((person) => <Check key={person.id} checked={expectedPeople.includes(person.id)} onChange={() => setExpectedPeople((current) => current.includes(person.id) ? current.filter((id) => id !== person.id) : [...current, person.id])}>Expect {person.name} · {person.relationship} to be here</Check>)}
    {!recording && !busy && !matchablePeople.length && <Text style={styles.small}>No linked person currently has an enrolled voice profile and active matching consent. Speakers will remain unknown.</Text>}
    {recording ? <View style={styles.row}><View style={styles.grow}><Button title="Pause" tone="secondary" onPress={() => void controller.pause()} /></View><View style={styles.grow}><Button title="Stop recording" onPress={() => void controller.stop()} /></View></View> : <Button title={phase === "starting" ? "Opening microphone…" : phase === "saving" ? "Finalizing audio…" : phase === "paused" ? "Resume in a new segment" : "Start a conversation"} disabled={!consent || busy} onPress={() => void controller.start(consent, expectedPeople)} />}
    {phase === "interrupted" && <Button title="Finish recording / retry stop" tone="secondary" onPress={() => void controller.stop()} />}
    {!!message && <Text accessibilityLiveRegion="polite" style={styles.small}>{message}</Text>}
    <Text style={styles.small}>Recordings stop after 1 hour. Pausing starts a new segment. Calls, force-stop, or device restrictions may interrupt capture. Hale will not restart automatically.</Text>
    {mode === "demo" && <Text style={styles.small}>Demo audio stays on this device. It is never uploaded or transcribed.</Text>}
    {pending.length > 0 && <View style={styles.stack}>
      <View style={styles.divider} /><Text style={styles.eyebrow}>{pending.length} TEMPORARY LOCAL CLIP{pending.length === 1 ? "" : "S"}</Text>
      {pending.map((item, index) => <View key={item.id} style={styles.stack}><Text style={styles.small}>Segment {index + 1} · {durationLabel(item.durationMs / 1000)}</Text><Button title={`Discard temporary clip ${index + 1}`} tone="secondary" disabled={hasActiveRecording || busy} onPress={() => Alert.alert("Discard this temporary audio?", "This cannot be undone. Previously uploaded transcript text is not deleted here.", [{ text: "Keep it", style: "cancel" }, { text: "Discard", style: "destructive", onPress: () => controller.discard(item.id) }])} /></View>)}
      {mode === "live" && <Button title={uploading ? "Uploading for transcription…" : "Upload for transcription / retry"} disabled={recording || busy} onPress={() => void controller.retry()} />}
      <Text style={styles.small}>A temporary local copy is kept only until upload succeeds or you discard it, so an interrupted connection can be retried. Hale deletes its server copy after transcription and any selected speaker matching; Android app backup is disabled.</Text>
    </View>}
  </View>;
}
