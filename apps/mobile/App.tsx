import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { BackHandler, KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
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
  { id: "today", label: "Today", symbol: "☼" }, { id: "memories", label: "Memories", symbol: "▦" },
  { id: "ask", label: "Ask Hale", symbol: "✧" }, { id: "care", label: "Care", symbol: "+" },
  { id: "more", label: "Your space", symbol: "○" },
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
    <View style={[styles.between, { paddingHorizontal: 24, paddingVertical: 12, borderBottomWidth: 1, borderColor: colors.border }]}><Text accessibilityLabel="Hale" style={styles.wordmark}>hale.</Text><View style={{ alignItems: "flex-end" }}><Text style={styles.small}>{space.name}</Text><Text style={styles.eyebrow}>{mode === "demo" ? "FICTIONAL DEMO" : "YOUR PRIVATE SPACE"}</Text></View></View>
    {phase === "recording" && (tab !== "today" || detail) && <View style={[styles.row, { paddingHorizontal: 24, paddingVertical: 10, backgroundColor: colors.blush }]}><Text accessibilityLiveRegion="polite" style={[styles.small, styles.grow]}>◉ Recording · {Math.floor(seconds / 60)} min</Text><Button title="Recording controls" tone="secondary" onPress={() => { setTab("today"); setDetail(undefined); }} /></View>}
    {detail && <View style={{ paddingHorizontal: 24, paddingTop: 8 }}><Button title="← Back to dashboard" tone="secondary" onPress={() => setDetail(undefined)} /></View>}
    <KeyboardAvoidingView style={styles.grow} behavior={Platform.OS === "ios" ? "padding" : undefined}><View style={[styles.grow, detail && { display: "none" }]}>{screen}</View>{detail && <ConversationScreen key={detail.id} {...detail} back={() => setDetail(undefined)} />}</KeyboardAvoidingView>
    <View accessibilityRole="tablist" style={styles.tabs}>{tabs.map((item) => <Pressable key={item.id} accessibilityRole="tab" accessibilityLabel={item.label} accessibilityState={{ selected: !detail && tab === item.id }} onPress={() => { setDetail(undefined); setTab(item.id); }} style={styles.tab}><Text style={[styles.tabIcon, tab === item.id && styles.tabActive]}>{item.symbol}</Text><Text style={[styles.tabText, tab === item.id && styles.tabActive]}>{item.label}</Text></Pressable>)}</View>
  </View>;
}

function PatientApp() {
  const { space, owner } = useWorkspace();
  return <CaptureProvider key={`${owner}:${space.id}`}><Dashboard /></CaptureProvider>;
}
export default function App() {
  const [loaded, error] = useFonts({ Geist: Geist_400Regular, GeistMedium: Geist_500Medium, LibreBaskerville: LibreBaskerville_400Regular, IBMPlexMono: IBMPlexMono_400Regular });
  return <SafeAreaProvider><SafeAreaView style={styles.screen}><StatusBar style="dark" />{error ? <Text style={{ padding: 32, color: colors.ink }}>The display fonts could not load. Restart Hale to try again.</Text> : !loaded ? <Loading /> : <ErrorBoundary><WorkspaceProvider><PatientApp /></WorkspaceProvider></ErrorBoundary>}</SafeAreaView></SafeAreaProvider>;
}
