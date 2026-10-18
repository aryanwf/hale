import { Alert, Linking, Text, View } from "react-native";
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@hale/contracts/api";
import { Button, Check, Empty, Notice, Page } from "../components/ui";
import { useCapture } from "../providers/capture";
import { useWorkspace } from "../providers/workspace";
import { config } from "../lib/config";
import { styles } from "../theme";
import { FamilyLink } from "../components/family-link";

export function MoreScreen() {
  const { space, mode, patients, selectPatient, signOut } = useWorkspace();
  const { phase, hasActiveRecording, pendingCount, uploading, needsFinalization } = useCapture();
  const busy = hasActiveRecording || ["starting", "saving"].includes(phase) || uploading;

  function openVoiceProfile() {
    if (!config.webUrl) {
      Alert.alert("Web dashboard unavailable", "Set EXPO_PUBLIC_WEB_URL to manage your voice profile.");
      return;
    }
    void Linking.openURL(new URL("/signup/voice", config.webUrl).toString())
      .catch(() => Alert.alert("Couldn’t open the dashboard", "Try opening Hale in your browser."));
  }
  function openAccountDeletion() {
    if (!config.webUrl) { Alert.alert("Account settings unavailable", "Open the Hale website to delete your account."); return; }
    void Linking.openURL(new URL("/account/delete", config.webUrl).toString()).catch(() => Alert.alert("Couldn’t open account settings", "Open the Hale website and go to Delete account in settings."));
  }
  function openPrivacyCenter() {
    if (!config.webUrl) { Alert.alert("Privacy center unavailable", "Set EXPO_PUBLIC_WEB_URL to manage privacy and security settings."); return; }
    void Linking.openURL(new URL("/privacy", config.webUrl).toString()).catch(() => Alert.alert("Couldn’t open Privacy & Security", "Open the Hale website and choose Privacy & security in Settings."));
  }
  return <Page eyebrow="SETTINGS" title="Your space" description="People, privacy, recordings, and account settings.">
    <View style={styles.card}><Text style={styles.eyebrow}>PRIVACY &amp; SECURITY</Text><Text style={styles.heading}>Your privacy controls</Text><Text style={styles.small}>Manage recording consent, external AI processing, family access, data retention, access history and exports.</Text><Button title="Open Privacy & Security Center ↗" tone="secondary" disabled={busy} onPress={openPrivacyCenter} /></View>
    {mode === "live" && <FamilyLink patientId={space.id} disabled={busy} />}
    <View style={styles.stack}>
      <Text style={styles.heading}>People</Text>
      {space.people.length ? space.people.map((person) => <View key={person.id} style={styles.card}>
        <View style={styles.row}><View style={styles.avatar}><Text style={styles.title}>{person.initials}</Text></View><View style={styles.grow}><Text style={styles.title}>{person.name}</Text><Text style={styles.small}>{person.relationship}</Text></View></View>
        <Text style={styles.small}>{mode === "demo" ? "Demo profile · no real voiceprint" : person.enrollment === "enrolled" ? "Voice enrolled with consent" : person.enrollment === "revoked" ? "Voice enrollment revoked" : "Voice not enrolled"}</Text>
        {mode === "live" && person.isMe && <SelfVoiceMatchingConsent patientId={space.id} enabled={person.voiceMatchingConsent} />}
        <Text style={styles.small}>{space.conversations.filter((item) => item.people.includes(person.id)).length} linked conversations</Text>
      </View>) : <Empty title="No people added yet" description="People will appear here when patient-space profiles are available." />}
      <Notice>People profiles do not grant account access or prove who was physically present. In live mode, only selected, consented profiles are checked; uncertain speakers remain unknown.</Notice>
      <Button title="Manage my voice profile on the web" tone="secondary" onPress={openVoiceProfile} />
    </View>

    <View style={styles.card}>
      <Text style={styles.eyebrow}>ACCESS</Text>
      <Text style={styles.heading}>Patient space</Text>
      <Text style={styles.body}>{space.name}</Text>
      <Text style={styles.small}>Timezone · {space.timezone}</Text>
      <Text style={styles.small}>{mode === "demo" ? "Fictional demo data only" : "Access is checked by the server"}</Text>
      <Text style={styles.small}>Family sharing requires your approval. Voice enrollment does not grant access.</Text>
    </View>

    <View style={styles.card}>
      <Text style={styles.eyebrow}>DATA AND PRIVACY</Text>
      <Text style={styles.heading}>What Hale stores</Text>
       <Text style={styles.small}>Uploaded audio · external processing is off until you enable it; when enabled, audio is temporary for transcription and selected speaker matching, then deleted. Stalled processing expires in about 24 hours.</Text>
       <Text style={styles.small}>Transcripts and memories · until you delete the conversation</Text>
        <Text style={styles.small}>Unsent temporary audio · up to five minutes on this device until upload or discard. Recording stops if this queue fills.</Text>
      <View style={styles.divider} />
      <Text style={styles.small}>{pendingCount} segments saved locally for this account and patient space.{needsFinalization ? " Finishing the previous session." : ""}</Text>
      <Text style={styles.small}>Local audio is not app-encrypted. Uninstalling Hale or clearing app data removes unsent files. An interrupted file may be incomplete.</Text>
        <Text style={styles.small}>Cloud processing is not end-to-end encrypted. If you enable external AI processing, providers receive audio for transcription and optional speaker matching; their independent retention is governed by their terms.</Text>
    </View>

    <View style={styles.card}>
      <Text style={styles.eyebrow}>RECORDING</Text>
      <Text style={styles.heading}>The microphone stays in your control</Text>
      <Text style={styles.small}>Start while Hale is open and everyone agrees. A microphone indicator stays visible during capture.</Text>
      <Text style={styles.small}>Switch recording on once to keep listening, even with the screen locked. Switch it off here or in the Android notification. Calls, force-stop, or battery policies can interrupt capture; Hale never restarts it automatically.</Text>
      <Text style={styles.small}>Audio is sent to Sarvam in ten-second segments. Dialogue appears after processing, not word by word. If you select eligible people before recording, their consented voice profiles are checked separately by pyannote; other and uncertain voices remain unknown. Continuous capture uses battery, mobile data, and provider quota.</Text>
    </View>

    {patients.length > 1 && <View style={styles.card}>
      <Text style={styles.heading}>Switch patient space</Text>
      {patients.map((patient) => <Button key={patient.id} title={`${patient.id === space.id ? "Current · " : ""}${patient.name}`} tone="secondary" disabled={busy} onPress={() => selectPatient(patient.id)} />)}
      <Text style={styles.small}>Finish recording before switching spaces.</Text>
    </View>}

    <Button title={mode === "demo" ? "Reset demo" : "Sign out"} tone="secondary" disabled={busy} onPress={() => Alert.alert(mode === "demo" ? "Reset demo data?" : "Sign out?", "Unsent recordings stay on this device. Discard local files first if this device is shared.", [{ text: "Cancel", style: "cancel" }, { text: "Continue", onPress: () => { void signOut().catch(() => Alert.alert("Couldn’t sign out", "Please try again.")); } }])} />
    <Notice>Use fictional names and consented test audio only. Live audio is transcribed and temporary files are deleted after processing. Memory extraction and summaries are still under development.</Notice>
    {mode === "live" && <View style={styles.card}><Text style={styles.heading}>Delete account</Text><Text style={styles.small}>Permanently delete your Hale data and sign-in account. Continue in the browser, sign in to this same account, and review the confirmation. Discard any unsent local recordings separately before deleting.</Text><Button title="Delete account ↗" tone="secondary" disabled={busy} onPress={openAccountDeletion} /></View>}
  </Page>;
}

function SelfVoiceMatchingConsent({ patientId, enabled }: { patientId: string; enabled: boolean }) {
  const updateConsent = useMutation(api.setVoiceMatchingConsent);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  function toggle() {
    setBusy(true);
    setMessage("");
    void updateConsent({ patientId, enabled: !enabled })
      .catch(() => setMessage("Couldn’t update speaker-matching consent. Please try again."))
      .finally(() => setBusy(false));
  }
  return <View style={styles.stack}>
    <Check checked={enabled} onChange={toggle} disabled={busy}>I consent to my enrolled voice profile being checked by pyannote for speaker labels in this space. I can withdraw consent here; I still need to be selected before any recording is checked.</Check>
    {busy && <Text style={styles.small}>Updating consent…</Text>}
    {!!message && <Text accessibilityRole="alert" style={styles.small}>{message}</Text>}
  </View>;
}
