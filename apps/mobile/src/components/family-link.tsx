import { useState } from "react";
import { Alert, Modal, Text, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@hale/contracts/api";
import { normalizeFamilyCode } from "@hale/contracts/family-link";
import { Button, Field } from "./ui";
import { FamilyScanner } from "./family-scanner";
import { styles } from "../theme";

export function FamilyLink({ patientId, disabled, onConnected }: { patientId: string; disabled: boolean; onConnected?(): void }) {
  const link = useMutation(api.linkFamily);
  const unlink = useMutation(api.unlinkFamily);
  const setCareAccess = useMutation(api.setFamilyCareAccess);
  const people = useQuery(api.linkedPeople, { patientId });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  async function connect(familyCode: string) {
    setBusy(true);
    try { await link({ patientId, code: familyCode }); setCode(""); onConnected?.(); Alert.alert("Family connected", "Their family dashboard can now read your conversations and memories. Care controls stay off until you allow them separately."); }
    catch (error) { Alert.alert("Couldn’t connect family", error instanceof ConvexError ? String(error.data) : "Check your connection and try again."); }
    finally { setBusy(false); }
  }
  function confirmConnection(familyCode: string) {
    const normalized = normalizeFamilyCode(familyCode);
    if (!normalized || busy || disabled) return;
    Alert.alert("Share with this family member?", "Only use a code from someone you trust. They will be able to read your saved conversations, transcripts, and memories. Care controls are a separate choice. You can remove access in More → Connect family.", [
      { text: "Cancel", style: "cancel" }, { text: "Share my memories", onPress: () => void connect(normalized) },
    ]);
  }
  function changeCareAccess(personId: string, name: string, enabled: boolean) {
    const title = enabled ? "Allow Care controls?" : "Turn off Care controls?";
    const message = enabled
      ? "This family member can review AI care suggestions, manage emergency email contacts, and acknowledge alerts. They still cannot record or delete shared conversations. Browser push notifications require their own opt-in."
      : "This family member will no longer be able to confirm suggestions, manage alert contacts, or acknowledge alerts. Shared-memory access and existing email contacts or push subscriptions remain; remove family access to revoke the whole connection.";
    Alert.alert(title, `${name}\n\n${message}`, [
      { text: "Cancel", style: "cancel" },
      { text: enabled ? "Allow Care controls" : "Turn off Care controls", onPress: () => {
        setBusy(true);
        void setCareAccess({ patientId, personId, enabled })
          .catch((error) => Alert.alert("Couldn’t update Care access", error instanceof ConvexError ? String(error.data) : "Please try again."))
          .finally(() => setBusy(false));
      } },
    ]);
  }
  function remove(personId: string) {
    Alert.alert("Remove family access?", "Their dashboard will no longer have access to your shared memories or Care controls.", [
      { text: "Cancel", style: "cancel" }, { text: "Remove access", style: "destructive", onPress: () => {
        setBusy(true);
        void unlink({ patientId, personId }).catch(() => Alert.alert("Couldn’t remove access", "Please try again.")).finally(() => setBusy(false));
      } },
    ]);
  }
  return <View style={styles.card}><Text style={styles.heading}>Connect family</Text><Text style={styles.small}>Ask your family member to open their Hale family dashboard. Scan their QR code or enter the family code shown beside it.</Text>
    <Button title="Scan family QR code" tone="secondary" disabled={busy || disabled} onPress={() => setScannerOpen(true)} />
    <Field label="Family code" value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} maxLength={40} editable={!busy && !disabled} placeholder="Paste or enter their family code" />
    <Button title={busy ? "Connecting…" : "Connect family dashboard"} disabled={busy || disabled || !normalizeFamilyCode(code)} onPress={() => confirmConnection(code)} />
    {people?.filter((person) => person.linked && !person.isPatient).map((person) => <View key={person.id} style={styles.stack}>
      <Text style={styles.title}>{person.name} · Family connected · Care controls {person.careAccess ? "on" : "off"}</Text>
      <Button title={person.careAccess ? "Turn off Care controls" : "Allow Care controls"} tone="secondary" disabled={busy || disabled} onPress={() => changeCareAccess(person.id, person.name, !person.careAccess)} />
      <Button title="Remove access" tone="secondary" disabled={busy || disabled} onPress={() => remove(person.id)} />
    </View>)}
    <Modal visible={scannerOpen} animationType="slide" onRequestClose={() => setScannerOpen(false)}>{scannerOpen && <FamilyScanner onClose={() => setScannerOpen(false)} onScan={(scannedCode) => { setScannerOpen(false); setCode(scannedCode); confirmConnection(scannedCode); }} />}</Modal>
  </View>;
}
