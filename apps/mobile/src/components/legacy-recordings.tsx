import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { useWorkspace } from "../providers/workspace";
import { useCapture } from "../providers/capture";
import { createCaptureStore } from "../lib/native-store";
import { measureMediaDuration } from "../lib/media-duration";
import { uploadableRecording, type LocalRecording } from "../lib/capture";
import { styles } from "../theme";
import { Button } from "./ui";

export function LegacyRecordings() {
  const workspace = useWorkspace();
  const { hasActiveRecording } = useCapture();
  const [store] = useState(createCaptureStore);
  const [recordings, setRecordings] = useState(() => store.load().filter((item) => item.owner === workspace.owner && item.patientId === workspace.space.id));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (!recordings.length) return null;

  function remove(recording: LocalRecording) {
    store.save(store.load().filter((item) => item.id !== recording.id));
    store.removeFile(recording.uri);
    setRecordings((current) => current.filter((item) => item.id !== recording.id));
  }
  async function retry() {
    setBusy(true);
    try {
      for (const recording of recordings) {
        const durationMs = await measureMediaDuration(recording.uri);
        const clip = { ...recording, durationMs, endedAt: recording.capturedAt + durationMs };
        if (!uploadableRecording(clip, store.fileSize(clip.uri))) throw new Error("An earlier clip is incomplete. Its audio is kept here until you discard it.");
        await workspace.upload(clip);
        await workspace.endSession(clip.sessionId);
        remove(recording);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Upload failed. Your earlier audio is still here."); }
    finally { setBusy(false); }
  }
  return <View style={styles.card}>
    <Text style={styles.eyebrow}>EARLIER SAVED CLIPS</Text>
    <Text style={styles.small}>{recordings.length} clip(s) from the previous recording system are still on this device. They have not been discarded or merged into your new live session.</Text>
    <Button title={busy ? "Uploading…" : "Upload earlier clips"} disabled={busy || hasActiveRecording || workspace.mode !== "live"} onPress={() => void retry()} />
    <Button title="Discard earlier unsent clips" tone="secondary" disabled={busy || hasActiveRecording} onPress={() => Alert.alert("Discard earlier audio?", "This deletes only these unsent local files. Already uploaded conversations are unchanged.", [{ text: "Keep", style: "cancel" }, { text: "Discard", style: "destructive", onPress: () => {
      try { recordings.forEach(remove); }
      catch { setMessage("Couldn’t discard an earlier clip. Try again."); }
    } }])} />
    {!!message && <Text style={styles.small}>{message}</Text>}
  </View>;
}
