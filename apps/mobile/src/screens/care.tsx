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
  const [handoff, setHandoff] = useState(false);
  const sections = [{ value: "rides", label: "Rides" }, { value: "appointments", label: "Appointments" }, { value: "medications", label: "Medication" }] as const;
  function confirmReport(value: Report) {
    Alert.alert("Record this fictional self-report?", `Example medication A · ${reportLabels[value]}. This records your statement, not verified ingestion. It does not change a prescription.`, [{ text: "Go back", style: "cancel" }, { text: "Confirm demo report", onPress: () => setReport(value) }]);
  }
  return <Page eyebrow="CARE AND EVERYDAY TASKS" title="Care" description="Optional tools for rides, appointments, and medication records.">
    <SegmentedControl<CareTab> value={tab} options={sections} onChange={setTab} label="Care sections" />
    {tab === "rides" && <>
      <Text style={styles.heading}>A way to get there.</Text>
      {mode === "demo" && space.capabilities.includes("rides:prepare") ? <>
        <Notice>Synthetic quotes, not live fares. No Uber account is linked and no ride can be requested here.</Notice>
        <View style={styles.card}><Text style={styles.eyebrow}>FICTIONAL ROUTE</Text><Text style={styles.body}>Home → Garden café</Text><Button title="Preview demo ride options" onPress={() => setQuotes(true)} /></View>
        {quotes && <View style={styles.card}><Text style={styles.eyebrow}>SYNTHETIC ESTIMATES · USD</Text><Text style={styles.body}>UberX · $14.80 · Example ETA 5 min</Text><Text style={styles.body}>Comfort · $21.40 · Example ETA 8 min</Text><Text style={styles.small}>Verify real availability, price, route, and accessibility in Uber.</Text><Button title="Open Uber to choose a real route ↗" onPress={() => { void Linking.openURL("https://m.uber.com/").then(() => setHandoff(true)).catch(() => Alert.alert("Couldn’t open Uber", "Try opening Uber directly.")); }} />{handoff && <Text style={styles.small}>Handoff opened. No ride or booking is confirmed.</Text>}</View>}
      </> : <Empty title="Your ride connection starts here." description="The Uber connector is not configured. There are no live quotes or linked account details to show." />}
    </>}
    {tab === "appointments" && <><Text style={styles.heading}>A little room in the calendar.</Text><Empty title="No appointment calendar is connected." description="Cal.com booking and the approval gate are not enabled. There are no real clinic slots or bookings to show." /><Notice>A test-calendar booking is not a medical appointment. Hale never claims attendance from a booking receipt.</Notice></>}
    {tab === "medications" && <><Text style={styles.heading}>Your recorded instructions.</Text><Text style={styles.body}>Records and self-reports. Not medication advice.</Text>{mode === "demo" ? <View style={styles.card}><Text style={styles.eyebrow}>FICTIONAL, UNVERIFIED SOURCE</Text><Text style={styles.heading}>Example medication A</Text><Text style={styles.body}>Example recorded instruction: 1 tablet in the morning.</Text><Text style={styles.small}>08:00 · {space.timezone}</Text><Notice>Not a prescription. Never use this example for treatment or dosing decisions.</Notice><Text style={styles.small}>{report ? `Demo self-report: ${reportLabels[report]}. Not verified ingestion.` : "No self-report recorded. This does not tell us whether a dose was taken."}</Text>{space.capabilities.includes("medications:record") && (Object.keys(reportLabels) as Report[]).map((value) => <Button key={value} title={reportLabels[value]} tone="secondary" onPress={() => confirmReport(value)} />)}</View> : <Empty title="No medication schedule is recorded." description="Verified prescription-source records and server-confirmed self-reports are not connected. No dose is inferred from a conversation." />}<Notice>Demo reports stay on this screen only. Missing or conflicting logs never mean you should take another dose. Ask your pharmacist or clinician about personal medication questions.</Notice></>}
    <Notice>Hale supports remembering, not diagnosis, treatment, or emergency monitoring. External actions need exact, server-verified approval; bookings are disabled in this build.</Notice>
  </Page>;
}
