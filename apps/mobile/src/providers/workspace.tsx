import { createContext, useContext, useState, type ReactNode } from "react";
import { Alert, Modal, Platform, View } from "react-native";
import { ClerkProvider, useAuth } from "@clerk/expo";
import { AuthView } from "@clerk/expo/native";
import { tokenCache } from "@clerk/expo/token-cache";
import { ConvexReactClient, useConvex, useConvexAuth, useMutation, useQuery } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import type { PatientSpace } from "@hale/contracts";
import { api, type PatientInfo } from "@hale/contracts/api";
import { demoSpace, DEMO_TODAY } from "@hale/contracts/demo";
import { localDate } from "@hale/contracts/time";
import { fetch } from "expo/fetch";
import { File } from "expo-file-system";
import { config } from "../lib/config";
import { usePatientDate } from "../lib/use-patient-date";
import type { LocalRecording } from "../lib/capture";
import { Button, Check, Field, Gate, Loading, Notice } from "../components/ui";
import { FamilySetup } from "../components/family-setup";

export interface Workspace {
  mode: "live" | "demo";
  owner: string;
  space: PatientSpace;
  today: string;
  patients: PatientInfo[];
  selectPatient(id: string): void;
  signOut(): Promise<void>;
  beginSession(): Promise<string>;
  endSession(sessionId: string): Promise<void>;
  upload(recording: LocalRecording): Promise<void>;
  removeConversation(id: string): Promise<void>;
  search(text: string, day?: string): Promise<{ conversations: PatientSpace["conversations"]; limited: boolean }>;
}
const Context = createContext<Workspace | null>(null);
export function useWorkspace() {
  const workspace = useContext(Context);
  if (!workspace) throw new Error("Patient workspace is missing.");
  return workspace;
}

function DemoWorkspace({ children }: { children: ReactNode }) {
  const [space, setSpace] = useState(demoSpace);
  return <Context.Provider value={{
    mode: "demo", owner: "demo", space, today: DEMO_TODAY,
    patients: [{ id: space.id, name: space.name, timezone: space.timezone, capabilities: space.capabilities }],
    selectPatient: () => {}, signOut: async () => { setSpace(demoSpace); },
    beginSession: async () => `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    endSession: async () => {},
    upload: async () => { throw new Error("Demo audio stays on this device. Configure live mode to upload."); },
    removeConversation: async (id) => setSpace((current) => ({ ...current, conversations: current.conversations.filter((item) => item.id !== id), memories: current.memories.filter((item) => item.conversationId !== id) })),
    search: async (text, day) => ({ conversations: space.conversations.filter((item) => (!day || localDate(item.startedAt, space.timezone) === day) && `${item.title} ${item.summary} ${item.turns.map((turn) => turn.text).join(" ")}`.toLowerCase().includes(text.toLowerCase())), limited: false }),
  }}>{children}</Context.Provider>;
}

function PatientWorkspace({ patientId, patients, selectPatient, children }: { patientId: string; patients: PatientInfo[]; selectPatient(id: string): void; children: ReactNode }) {
  const { getToken, userId, signOut } = useAuth();
  const convex = useConvex();
  const space = useQuery(api.space, { patientId });
  const today = usePatientDate(space?.timezone ?? "UTC");
  const begin = useMutation(api.startRecording);
  const state = useMutation(api.recordingState);
  const remove = useMutation(api.deleteConversation);
  if (!space || !userId) return <Loading />;
  return <Context.Provider value={{
    mode: "live", owner: userId, space, patients, selectPatient, today,
    signOut: async () => { await signOut(); },
    beginSession: () => begin({ patientId, participantsConsented: true, captureMode: "native" }),
    endSession: (sessionId) => state({ sessionId, state: "stopped" }).then(() => {}),
    upload: async (recording) => {
      if (recording.owner !== userId || recording.patientId !== patientId) throw new Error("This recording belongs to a different account or patient space.");
      const token = await getToken({ template: "convex" });
      if (!token) throw new Error("Sign in again before uploading. Audio remains on this device.");
      if (!config.siteUrl) throw new Error("Convex HTTP URL is not configured.");
      const url = new URL("/audio", config.siteUrl);
      for (const [key, value] of Object.entries({ sessionId: recording.sessionId, sequence: 0, capturedAt: recording.capturedAt, endedAt: recording.endedAt })) url.searchParams.set(key, String(value));
      const response = await fetch(url.toString(), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "audio/mp4" }, body: new File(recording.uri) });
      if (!response.ok) throw new Error(`Upload not accepted (${response.status}). Check your connection and permissions; audio remains on this device.`);
    },
    removeConversation: async (conversationId) => { await remove({ conversationId }); },
    search: (text, day) => convex.query(api.searchConversations, { patientId, text, ...(day ? { day } : {}) }),
  }}>{children}</Context.Provider>;
}

function Onboarding({ onCreated }: { onCreated(patientId: string): void }) {
  const create = useMutation(api.createPatient);
  const { signOut } = useAuth();
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try { const patientId = await create({ name: name.trim(), timezone, recordingConsent: consent }); onCreated(patientId); }
    catch { Alert.alert("Couldn’t create your space", "Check your name, timezone, and connection, then try again."); }
    finally { setBusy(false); }
  }
  return <Gate title="A little introduction." description="Create your own patient space. Use a fictional name and consented test audio in this prototype."><Field label="Your display name" value={name} onChangeText={setName} maxLength={100} /><Field label="Patient timezone" value={timezone} onChangeText={setTimezone} autoCapitalize="none" /><Notice>Audio expires after 7 days on the server. Transcripts remain until you delete the conversation. Cloud processing is not end-to-end encrypted. This is a memory aid, not a medical service.</Notice><Check checked={consent} onChange={() => setConsent(!consent)}>I understand the processing and consent to test recordings. Everyone in each conversation must also agree.</Check><Button title={busy ? "Creating…" : "Create my space"} disabled={busy || name.trim().length < 2 || !consent} onPress={() => void submit()} /><Button title="Sign out" tone="secondary" onPress={() => void signOut()} /></Gate>;
}

function LiveGate({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, signOut } = useAuth({ treatPendingAsSignedOut: false });
  const { isAuthenticated, isLoading } = useConvexAuth();
  const patients = useQuery(api.patients, isAuthenticated ? { role: "patient" } : "skip");
  const [selected, selectPatient] = useState<string>();
  const [authOpen, setAuthOpen] = useState(false);
  const [createdPatientId, setCreatedPatientId] = useState<string>();
  let content: ReactNode;
  if (!isLoaded) content = <Loading />;
  else if (!isSignedIn) content = <Gate title="Your memories.\nYour space." description="A familiar moment is never far away. Sign in with the same account you use on Hale."><Button title="Sign in or create an account" onPress={() => setAuthOpen(true)} /><Notice>Private memories are only available to accounts you authorize.</Notice></Gate>;
  else if (isLoading) content = <Loading message="Connecting securely…" />;
  else if (!isAuthenticated) content = <Gate title="Your connection needs attention." description="Check the Clerk convex JWT template and Convex issuer configuration."><Button title="Sign out and try again" onPress={() => void signOut()} /></Gate>;
  else if (!patients) content = <Loading />;
  else if (createdPatientId) content = <FamilySetup patientId={createdPatientId} onContinue={() => { selectPatient(createdPatientId); setCreatedPatientId(undefined); }} />;
  else if (!patients.length) content = <Onboarding onCreated={setCreatedPatientId} />;
  else {
    const patientId = patients.find((patient) => patient.id === selected)?.id ?? patients[0].id;
    content = <PatientWorkspace key={patientId} patientId={patientId} patients={patients} selectPatient={selectPatient}>{children}</PatientWorkspace>;
  }
  return <View style={{ flex: 1 }}>{content}<Modal visible={authOpen} animationType="slide" onRequestClose={() => setAuthOpen(false)}><AuthView onDismiss={() => setAuthOpen(false)} /></Modal></View>;
}

function configuredClient() {
  if (config.mode !== "live" || !config.convexUrl) return null;
  try { return new ConvexReactClient(config.convexUrl); }
  catch { return null; }
}
const client = configuredClient();
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  if (Platform.OS !== "android") return <Gate title="Hale’s Android companion." description="Install the Android development build for background microphone capture. Use apps/web for your browser dashboard." />;
  if (config.mode === "demo") return <DemoWorkspace>{children}</DemoWorkspace>;
  if (config.mode === "invalid") return <Gate title="Choose an app mode." description="EXPO_PUBLIC_APP_MODE must be demo or live." />;
  if (!client || !config.clerkKey || !config.siteUrl) return <Gate title="Connect your private space." description="Set the EXPO_PUBLIC Clerk and Convex values in apps/mobile/.env.local. Live mode never silently falls back to demo data." />;
  return <ClerkProvider publishableKey={config.clerkKey} tokenCache={tokenCache}><ConvexProviderWithClerk client={client} useAuth={useAuth}><LiveGate>{children}</LiveGate></ConvexProviderWithClerk></ClerkProvider>;
}
