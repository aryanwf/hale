import { useEffect } from "react";
import { Alert, Switch, Text, View } from "react-native";
import { useQuery } from "convex/react";
import { Mic, MicOff } from "lucide-react-native";
import { api } from "@hale/contracts/api";
import { useCapture } from "../providers/capture";
import { useWorkspace } from "../providers/workspace";
import { colors, styles } from "../theme";
import { Button } from "./ui";

export function RecordingCard({ compact = false }: { compact?: boolean }) {
  const { mode, space } = useWorkspace();
  if (mode === "live") return <LiveRecordingCard compact={compact} patientId={space.id} />;
  return <RecordingControls compact={compact} externalAIAllowed recordingAllowed privacyReady />;
}

function LiveRecordingCard({ compact, patientId }: { compact: boolean; patientId: string }) {
  const privacy = useQuery(api.privacy.center, { patientId });
  const { controller, hasActiveRecording } = useCapture();
  useEffect(() => {
    if (privacy && (!privacy.settings.externalAIEnabled || !privacy.settings.recordingEnabled) && hasActiveRecording) {
      void controller.stop();
    }
  }, [controller, hasActiveRecording, privacy]);
  return <RecordingControls compact={compact} externalAIAllowed={Boolean(privacy?.settings.externalAIEnabled)} recordingAllowed={Boolean(privacy?.settings.recordingEnabled)} privacyReady={Boolean(privacy)} />;
}

function RecordingControls({ compact, externalAIAllowed, recordingAllowed, privacyReady }: { compact: boolean; externalAIAllowed: boolean; recordingAllowed: boolean; privacyReady: boolean }) {
  const { space, mode } = useWorkspace();
  const { controller, phase, hasActiveRecording, pendingCount, uploading, message, sessionId, available, needsFinalization, blockedByAnotherSpace } = useCapture();
  const busy = phase === "starting" || phase === "saving";
  if (!space.capabilities.includes("recordings:create")) return null;
  if (compact && !hasActiveRecording && !pendingCount && !needsFinalization) return null;
  const Icon = hasActiveRecording ? Mic : MicOff;
  function toggle(on: boolean) {
    if (!on) { void controller.stop(); return; }
    if (mode === "live" && !externalAIAllowed) {
      Alert.alert("External AI processing is off", "Turn on external AI processing in the Privacy & Security Center before recording. Hale will not send audio to a transcription provider without your consent.");
      return;
    }
    if (mode === "live" && !recordingAllowed) {
      Alert.alert("Recording consent is off", "Turn on future recording consent in the Privacy & Security Center before starting a session.");
      return;
    }
    Alert.alert("Switch recording on?", "Everyone present must agree to ongoing recording, including while your screen is locked. Audio is sent to Sarvam about every 10 seconds; this uses battery, mobile data, and API quota. Speech becomes part of this patient space’s recorded conversation. Switch off here or in the Android notification at any time.", [
      { text: "Not now", style: "cancel" },
      { text: "Everyone agrees · switch on", onPress: () => void controller.start(true) },
    ]);
  }
  return <View style={[styles.card, styles.liveCard, hasActiveRecording && styles.liveCardActive]}>
    <View style={styles.between}>
      <View style={[styles.row, styles.grow]}>
        <View style={[styles.recordIcon, hasActiveRecording && { backgroundColor: colors.rescueMist }]}><Icon size={22} strokeWidth={1.7} color={hasActiveRecording ? colors.rescue : colors.burgundy} /></View>
        <View style={styles.grow}><Text style={styles.title}>{busy ? phase === "starting" ? "Opening microphone…" : "Switching off…" : hasActiveRecording ? "Recording is on" : "Live recording"}</Text><Text style={styles.small}>{hasActiveRecording ? "Listening, even with your screen locked" : "Your microphone is off"}</Text></View>
      </View>
      <Switch accessibilityLabel="Continuous conversation recording" accessibilityHint="Switch on only with everyone’s consent. Switch off to stop the microphone." value={hasActiveRecording} disabled={busy || !available || (!hasActiveRecording && (blockedByAnotherSpace || needsFinalization || pendingCount > 0 || (mode === "live" && (!privacyReady || !externalAIAllowed || !recordingAllowed))))} trackColor={{ false: colors.strongBorder, true: colors.burgundy }} thumbColor={colors.white} onValueChange={toggle} />
    </View>
    {(hasActiveRecording || sessionId) && <View style={styles.recordMeta}>
      <View style={styles.row}>{hasActiveRecording && <View style={styles.statusDot} />}<Text style={styles.eyebrow}>{hasActiveRecording ? "RECORDING" : needsFinalization ? "FINISHING UP" : "MICROPHONE OFF"}</Text></View>
    </View>}
    {!!message && <Text accessibilityLiveRegion="polite" style={styles.small}>{message}</Text>}
    {!available && <Text style={styles.small}>{mode === "demo" ? "Live recording is only available in a signed-in live space. Demo mode never sends audio." : "This build needs the new native recording service. Rebuild and install Hale for Android to enable the switch."}</Text>}
    {mode === "live" && privacyReady && !externalAIAllowed && !hasActiveRecording && <Text style={styles.small}>External AI processing is off, so new recordings cannot be transcribed. Enable it in the Privacy &amp; Security Center when you are ready.</Text>}
    {mode === "live" && privacyReady && !recordingAllowed && !hasActiveRecording && <Text style={styles.small}>Future recording consent is off. Enable it in the Privacy &amp; Security Center before starting a session.</Text>}
    {pendingCount > 0 && <View style={styles.recordMeta}>
      <Text style={styles.small}>{pendingCount} unsent segment{pendingCount === 1 ? "" : "s"} · {uploading ? "uploading" : "saved on this device"}. Retried automatically; recording stops if the five-minute offline queue fills.</Text>
      <Button title="Reconnect / retry uploads" tone="secondary" onPress={() => void controller.retry()} />
      {!hasActiveRecording && <Button title="Discard unsent audio" tone="secondary" disabled={uploading || busy} onPress={() => Alert.alert("Discard unsent audio?", "Words in these unsent segments cannot be recovered. Already uploaded dialogue stays in the recorded conversation.", [{ text: "Keep audio", style: "cancel" }, { text: "Discard", style: "destructive", onPress: () => void controller.discard() }])} />}
    </View>}
  </View>;
}
