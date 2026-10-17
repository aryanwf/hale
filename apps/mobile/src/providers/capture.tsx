import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState, Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";
import Constants from "expo-constants";
import { AudioModule } from "expo-audio";
import { ContinuousCaptureController, type NativeCapture } from "../lib/continuous-capture";
import { requestAndroidRecordingPermissions } from "../lib/recording-permissions";
import { useWorkspace } from "./workspace";

const native = requireOptionalNativeModule<NativeCapture>("HaleCapture");
const Context = createContext<ContinuousCaptureController | null>(null);

export function useCapture() {
  const controller = useContext(Context);
  if (!controller) throw new Error("Capture provider is missing.");
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return { controller, ...snapshot };
}

export function CaptureProvider({ children }: { children: ReactNode }) {
  const workspace = useWorkspace();
  const latestWorkspace = useRef(workspace);
  latestWorkspace.current = workspace;
  const [controller] = useState(() => new ContinuousCaptureController({
    native: workspace.mode === "live" ? native : null,
    owner: workspace.owner, patientId: workspace.space.id,
    beginSession: () => latestWorkspace.current.beginContinuousSession(),
    endSession: (id) => latestWorkspace.current.endSession(id),
    uploadCredentials: () => latestWorkspace.current.uploadCredentials(),
    requestPermissions: async () => {
      if (Constants.appOwnership === "expo" || Platform.OS !== "android") throw new Error("Install the Hale Android build for continuous recording.");
      if (AppState.currentState !== "active") throw new Error("Open Hale before switching recording on.");
      await requestAndroidRecordingPermissions({
        apiLevel: Number(Platform.Version),
        requestMicrophone: () => AudioModule.requestRecordingPermissionsAsync(),
        requestNotifications: () => AudioModule.requestNotificationPermissionsAsync(),
      });
    },
  }));
  useEffect(() => {
    void controller.observe().then(() => controller.refreshCredentials());
    const statusInterval = setInterval(() => void controller.observe(), 1000);
    const authInterval = setInterval(() => {
      const snapshot = controller.getSnapshot();
      if (snapshot.hasActiveRecording || snapshot.pendingCount || snapshot.needsFinalization) void controller.refreshCredentials();
    }, 30_000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void controller.observe().then(() => controller.refreshCredentials());
    });
    return () => { clearInterval(statusInterval); clearInterval(authInterval); subscription.remove(); controller.dispose(); };
  }, [controller]);
  return <Context.Provider value={controller}>{children}</Context.Provider>;
}
