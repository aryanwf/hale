import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { BackHandler, Pressable, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { Geist_400Regular } from "@expo-google-fonts/geist/400Regular";
import { Geist_500Medium } from "@expo-google-fonts/geist/500Medium";
import { LibreBaskerville_400Regular } from "@expo-google-fonts/libre-baskerville/400Regular";
import { IBMPlexMono_400Regular } from "@expo-google-fonts/ibm-plex-mono/400Regular";
import { WorkspaceProvider, useWorkspace } from "./src/providers/workspace";
import { CaptureProvider, useCapture } from "./src/providers/capture";
import { TodayScreen } from "./src/screens/today";
import { MemoriesScreen } from "./src/screens/memories";
import { AskScreen } from "./src/screens/ask";
import { CareScreen } from "./src/screens/care";
import { MoreScreen } from "./src/screens/more";
import { ConversationScreen } from "./src/screens/conversation";
import { Button, Gate, Loading } from "./src/components/ui";
import { colors, styles } from "./src/theme";

type Tab = "today" | "memories" | "ask" | "care" | "more";
const tabs: { id: Tab; label: string; symbol: string }[] = [
  { id: "today", label: "Today", symbol: "⌂" }, { id: "memories", label: "Memories", symbol: "▤" },
  { id: "ask", label: "Ask", symbol: "?" }, { id: "care", label: "Care", symbol: "+" },
  { id: "more", label: "More", symbol: "···" },
];

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* Never log private query data or transcripts. */ }
  render() {
    if (this.state.failed) return <Gate title="Your space needs a moment." description="Your connection or access may have changed. Close and reopen Hale to reconnect. Any durable local audio remains on this device; do not clear app data."><Text style={styles.small}>No demo data has been substituted for your private records.</Text></Gate>;
    return this.props.children;
  }
}

function Dashboard() {
  const { mode, space } = useWorkspace();
  const { phase, seconds } = useCapture();
  const [tab, setTab] = useState<Tab>("today");
  const [day, setDay] = useState<string>();
  const [detail, setDetail] = useState<{ id: string; timestamp?: number }>();
  const open = (id: string, timestamp?: number) => setDetail({ id, timestamp });
  const ask = (selectedDay?: string) => { setDay(selectedDay); setTab("ask"); setDetail(undefined); };
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (detail) { setDetail(undefined); return true; }
      if (tab !== "today") { setTab("today"); return true; }
      return false;
    });
    return () => subscription.remove();
  }, [detail, tab]);
  let screen: ReactNode;
  if (tab === "today") screen = <TodayScreen open={open} ask={() => ask()} care={() => setTab("care")} memories={() => setTab("memories")} />;
  else if (tab === "memories") screen = <MemoriesScreen open={open} ask={ask} />;
  else if (tab === "ask") screen = <AskScreen key={day ?? "all"} day={day} open={open} care={() => setTab("care")} />;
  else if (tab === "care") screen = <CareScreen />;
  else screen = <MoreScreen />;
  return <View style={styles.screen}>
    <View style={styles.appHeader}><Text accessibilityLabel="Hale" style={styles.wordmark}>hale.</Text><View style={styles.headerMeta}><Text numberOfLines={1} style={styles.headerName}>{space.name}</Text><Text style={styles.headerLabel}>{mode === "demo" ? "Demo · fictional records" : "Patient space"}</Text></View></View>
    {phase === "recording" && (tab !== "today" || detail) && <View style={[styles.row, { paddingHorizontal: 20, paddingVertical: 9, backgroundColor: colors.blush }]}><Text accessibilityLiveRegion="polite" style={[styles.small, styles.grow]}>Recording · {Math.floor(seconds / 60)} min</Text><Button title="Open controls" tone="secondary" onPress={() => { setTab("today"); setDetail(undefined); }} /></View>}
    {detail && <View style={{ paddingHorizontal: 20, paddingTop: 8 }}><Button title="Back to conversations" tone="secondary" onPress={() => setDetail(undefined)} /></View>}
    <View style={styles.grow}><View style={[styles.grow, detail && { display: "none" }]}>{screen}</View>{detail && <ConversationScreen key={detail.id} {...detail} back={() => setDetail(undefined)} />}</View>
    <View accessibilityRole="tablist" style={styles.tabs}>{tabs.map((item) => { const selected = !detail && tab === item.id; return <Pressable key={item.id} accessibilityRole="tab" accessibilityLabel={item.label} accessibilityState={{ selected }} onPress={() => { setDetail(undefined); setTab(item.id); }} style={[styles.tab, selected && styles.tabSelected]}><Text style={[styles.tabIcon, selected && styles.tabActive]}>{item.symbol}</Text><Text style={[styles.tabText, selected && styles.tabActive]}>{item.label}</Text></Pressable>; })}</View>
  </View>;
}

function PatientApp() {
  const { space, owner } = useWorkspace();
  return <CaptureProvider key={`${owner}:${space.id}`}><Dashboard /></CaptureProvider>;
}
export default function App() {
  const [loaded, error] = useFonts({ Geist: Geist_400Regular, GeistMedium: Geist_500Medium, LibreBaskerville: LibreBaskerville_400Regular, IBMPlexMono: IBMPlexMono_400Regular });
  return <SafeAreaProvider><SafeAreaView style={styles.screen}><StatusBar style="dark" />{error ? <Text style={{ padding: 32, color: colors.ink }}>Hale could not load its fonts. Restart the app to try again.</Text> : !loaded ? <Loading /> : <ErrorBoundary><WorkspaceProvider><PatientApp /></WorkspaceProvider></ErrorBoundary>}</SafeAreaView></SafeAreaProvider>;
}
