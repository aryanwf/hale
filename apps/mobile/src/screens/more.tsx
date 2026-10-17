import { Alert, Linking, Text, View } from "react-native";
import { Button, Empty, Notice, Page } from "../components/ui";
import { useCapture } from "../providers/capture";
import { useWorkspace } from "../providers/workspace";
import { config } from "../lib/config";
import { styles } from "../theme";

export function MoreScreen() {
  const { space, mode, patients, selectPatient, signOut } = useWorkspace();
  const { phase, hasActiveRecording, pending, uploading } = useCapture();
  const busy = hasActiveRecording || ["starting", "saving"].includes(phase) || uploading;

  function openVoiceProfile() {
    if (!config.webUrl) {
      Alert.alert("Web dashboard unavailable", "Set EXPO_PUBLIC_WEB_URL to manage your voice profile.");
      return;
    }
    void Linking.openURL(new URL("/signup/voice", config.webUrl).toString())
      .catch(() => Alert.alert("Couldn’t open the dashboard", "Try opening Hale in your browser."));
  }

  return <Page eyebrow="SETTINGS" title="Your space" description="People, privacy, recordings, and account settings.">
    <View style={styles.stack}>
      <Text style={styles.heading}>People</Text>
      {space.people.length ? space.people.map((person) => <View key={person.id} style={styles.card}>
        <View style={styles.row}><View style={styles.avatar}><Text style={styles.title}>{person.initials}</Text></View><View style={styles.grow}><Text style={styles.title}>{person.name}</Text><Text style={styles.small}>{person.relationship}</Text></View></View>
        <Text style={styles.small}>{mode === "demo" ? "Demo profile · no real voiceprint" : person.enrollment === "enrolled" ? "Voice enrolled with consent" : person.enrollment === "revoked" ? "Voice enrollment revoked" : "Voice not enrolled"}</Text>
        <Text style={styles.small}>{space.conversations.filter((item) => item.people.includes(person.id)).length} linked conversations</Text>
      </View>) : <Empty title="No people added yet" description="People will appear here when patient-space profiles are available." />}
      <Notice>People profiles do not grant account access or prove who was physically present. Voice matching is not connected yet.</Notice>
      <Button title="Manage my voice profile on the web" tone="secondary" onPress={openVoiceProfile} />
    </View>

    <View style={styles.card}>
      <Text style={styles.eyebrow}>ACCESS</Text>
      <Text style={styles.heading}>Patient space</Text>
      <Text style={styles.body}>{space.name}</Text>
      <Text style={styles.small}>Timezone · {space.timezone}</Text>
      <Text style={styles.small}>{mode === "demo" ? "Fictional demo data only" : "Access is checked by the server"}</Text>
      <Text style={styles.small}>Family invitations are not available yet. Voice enrollment does not grant access.</Text>
    </View>

    <View style={styles.card}>
      <Text style={styles.eyebrow}>DATA AND PRIVACY</Text>
      <Text style={styles.heading}>What Hale stores</Text>
      <Text style={styles.small}>Uploaded audio · up to 7 days</Text>
      <Text style={styles.small}>Transcripts and memories · until you delete the conversation</Text>
      <Text style={styles.small}>Unsent audio · up to 3 files on this device</Text>
      <View style={styles.divider} />
      <Text style={styles.small}>{pending.length} saved locally for this account and patient space.</Text>
      <Text style={styles.small}>Local audio is not app-encrypted. Uninstalling Hale or clearing app data removes unsent files. An interrupted file may be incomplete.</Text>
      <Text style={styles.small}>Cloud processing is not end-to-end encrypted. Deleting audio from Hale does not delete a provider’s independent records.</Text>
    </View>

    <View style={styles.card}>
      <Text style={styles.eyebrow}>RECORDING</Text>
      <Text style={styles.heading}>The microphone stays in your control</Text>
      <Text style={styles.small}>Start while Hale is open and everyone agrees. A microphone indicator stays visible during capture.</Text>
      <Text style={styles.small}>Calls, route changes, force-stop, or battery settings may interrupt recording. Hale does not restart automatically. Pausing starts a new segment.</Text>
      <Text style={styles.small}>Each recording stops after one hour. Background recording can use more battery.</Text>
    </View>

    {patients.length > 1 && <View style={styles.card}>
      <Text style={styles.heading}>Switch patient space</Text>
      {patients.map((patient) => <Button key={patient.id} title={`${patient.id === space.id ? "Current · " : ""}${patient.name}`} tone="secondary" disabled={busy} onPress={() => selectPatient(patient.id)} />)}
      <Text style={styles.small}>Finish recording before switching spaces.</Text>
    </View>}

    <Button title={mode === "demo" ? "Reset demo" : "Sign out"} tone="secondary" disabled={busy} onPress={() => Alert.alert(mode === "demo" ? "Reset demo data?" : "Sign out?", "Unsent recordings stay on this device. Discard local files first if this device is shared.", [{ text: "Cancel", style: "cancel" }, { text: "Continue", onPress: () => { void signOut().catch(() => Alert.alert("Couldn’t sign out", "Please try again.")); } }])} />
    <Notice>Use fictional names and consented test audio only. Transcription, memory extraction, speaker matching, and summaries are not connected yet.</Notice>
  </Page>;
}
