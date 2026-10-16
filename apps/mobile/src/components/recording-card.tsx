import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { durationLabel } from "@hale/contracts/time";
import { useCapture } from "../providers/capture";
import { useWorkspace } from "../providers/workspace";
import { styles } from "../theme";
import { Button, Check } from "./ui";

function LocalPlayback({ uri }: { uri: string }) {
  const { hasActiveRecording } = useCapture();
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  return <Button title={status.playing ? "Pause preview" : "Review saved audio"} tone="secondary" disabled={hasActiveRecording || !status.isLoaded} onPress={() => status.playing ? player.pause() : player.play()} />;
}

export function RecordingCard() {
  const { space, mode } = useWorkspace();
  const { controller, phase, hasActiveRecording, seconds, pending, uploading, message } = useCapture();
  const [consent, setConsent] = useState(false);
  const recording = phase === "recording";
  const busy = phase === "starting" || phase === "saving" || uploading;
  if (!space.capabilities.includes("recordings:create")) return <View style={styles.card}><Text style={styles.small}>This account does not have recording permission in this patient space.</Text></View>;
  return <View style={[styles.card, styles.blush]}>
    <View style={styles.between}><Text style={styles.eyebrow}>◉  {recording ? "MICROPHONE ON" : "A MOMENT WORTH KEEPING"}</Text><Text style={styles.mono}>{durationLabel(seconds)}</Text></View>
    <Text style={styles.heading}>{recording ? "Here, even when\nyour screen rests." : phase === "paused" ? "A little pause." : "Keep a little of\nthis moment."}</Text>
    <Text style={styles.small}>{recording ? "Recording continues with the screen locked. Pause or stop whenever you like." : "Record a conversation with everyone’s permission. Your microphone is off until you tap start."}</Text>
    {!recording && !busy && <Check checked={consent} onChange={() => setConsent(!consent)}>Everyone taking part agrees to be recorded, including while Hale is in the background.</Check>}
    {recording ? <View style={styles.row}><View style={styles.grow}><Button title="Pause" tone="secondary" onPress={() => void controller.pause()} /></View><View style={styles.grow}><Button title="Stop & save" onPress={() => void controller.stop()} /></View></View> : <Button title={phase === "starting" ? "Opening microphone…" : phase === "saving" ? "Saving your audio…" : phase === "paused" ? "Resume in a new segment" : "Start a conversation"} disabled={!consent || busy} onPress={() => void controller.start(consent)} />}
    {phase === "interrupted" && <Button title="Finish saving / retry stop" tone="secondary" onPress={() => void controller.stop()} />}
    {!!message && <Text accessibilityLiveRegion="polite" style={styles.small}>{message}</Text>}
    <Text style={styles.small}>Up to 1 hour per recording; it stops automatically. Pausing ends a segment. Calls, device restrictions, or force-quitting may interrupt capture. No automatic restart.</Text>
    {mode === "demo" && <Text style={styles.small}>Demo: consented test audio stays on this device. It is never uploaded or transcribed.</Text>}
    {pending.length > 0 && <View style={styles.stack}>
      <View style={styles.divider} /><Text style={styles.eyebrow}>{pending.length} SAVED ON THIS DEVICE</Text>
      {pending.map((item, index) => <View key={item.id} style={styles.stack}><Text style={styles.small}>Segment {index + 1} · {durationLabel(item.durationMs / 1000)}</Text>{!hasActiveRecording && <LocalPlayback uri={item.uri} />}<Button title={`Discard local segment ${index + 1}`} tone="secondary" disabled={hasActiveRecording || busy} onPress={() => Alert.alert("Discard this local audio?", "This cannot be undone. Previously uploaded evidence is not deleted here.", [{ text: "Keep it", style: "cancel" }, { text: "Discard", style: "destructive", onPress: () => controller.discard(item.id) }])} /></View>)}
      {mode === "live" && <Button title={uploading ? "Uploading…" : "Upload saved audio / retry"} disabled={recording || busy} onPress={() => void controller.retry()} />}
      <Text style={styles.small}>A maximum of 3 files are kept in the app’s private storage until uploaded or discarded. Device backups may include local files on iOS. Uninstalling or clearing app data removes unsent audio.</Text>
    </View>}
  </View>;
}
