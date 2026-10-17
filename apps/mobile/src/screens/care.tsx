import { useState } from "react";
import { Alert, Linking, Text, View } from "react-native";
import { Button, Empty, Notice, Page, SegmentedControl } from "../components/ui";
import { useWorkspace } from "../providers/workspace";
import { styles } from "../theme";

type CareTab = "rides" | "appointments" | "medications";
type Report = "taken" | "skipped" | "unknown";
const reportLabels: Record<Report, string> = { taken: "I took it", skipped: "I skipped it", unknown: "I don’t remember" };

export function CareScreen() {
  const { mode, space } = useWorkspace();
  const [tab, setTab] = useState<CareTab>("rides");
  const [quotes, setQuotes] = useState(false);
  const [report, setReport] = useState<Report>();
  const sections = [{ value: "rides", label: "Rides" }, { value: "appointments", label: "Appointments" }, { value: "medications", label: "Medication" }] as const;
  function confirmReport(value: Report) {
    Alert.alert("Save report?", `Example medication · ${reportLabels[value]}.`, [{ text: "Cancel", style: "cancel" }, { text: "Confirm", onPress: () => setReport(value) }]);
  }
  return <Page eyebrow="CARE AND EVERYDAY TASKS" title="Care" description="Optional tools for rides, appointments, and medication records.">
    <SegmentedControl<CareTab> value={tab} options={sections} onChange={setTab} label="Care sections" />
    {tab === "rides" && <>
      <Text style={styles.heading}>A way to get there.</Text>
      {mode === "demo" && space.capabilities.includes("rides:prepare") ? <>
        <View style={styles.card}><Text style={styles.eyebrow}>FICTIONAL ROUTE</Text><Text style={styles.body}>Home → Garden café</Text><Button title="Preview demo ride options" onPress={() => setQuotes(true)} /></View>
        {quotes && <View style={styles.card}><Text style={styles.eyebrow}>SAMPLE ESTIMATES · USD</Text><Text style={styles.body}>UberX · $14.80 · Example ETA 5 min</Text><Text style={styles.body}>Comfort · $21.40 · Example ETA 8 min</Text><Button title="Open Uber ↗" onPress={() => { void Linking.openURL("https://m.uber.com/").catch(() => Alert.alert("Couldn’t open Uber", "Try opening Uber directly.")); }} /></View>}
      </> : <Empty title="Rides unavailable." />}
    </>}
    {tab === "appointments" && <Empty title="Appointments unavailable." />}
    {tab === "medications" && <>{mode === "demo" ? <View style={styles.card}><Text style={styles.eyebrow}>EXAMPLE</Text><Text style={styles.heading}>Medication</Text><Text style={styles.body}>1 tablet in the morning</Text><Text style={styles.small}>08:00 · {space.timezone}</Text><Text style={styles.small}>{report ? `You said: ${reportLabels[report]}.` : "No report yet."}</Text>{space.capabilities.includes("medications:record") && (Object.keys(reportLabels) as Report[]).map((value) => <Button key={value} title={reportLabels[value]} tone="secondary" onPress={() => confirmReport(value)} />)}</View> : <Empty title="No medication records yet." />}<Notice>Not medical advice. For medication questions, ask your clinician or pharmacist.</Notice></>}
  </Page>;
}
