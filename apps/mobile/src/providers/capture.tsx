import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState, Platform } from "react-native";
import Constants from "expo-constants";
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import { MAX_AUDIO_BYTES, MAX_NATIVE_RECORDING_SECONDS } from "@hale/contracts/audio";
import { CaptureController } from "../lib/capture";
import { createCaptureStore } from "../lib/native-store";
import { measureMediaDuration } from "../lib/media-duration";
import { useWorkspace } from "./workspace";

const Context = createContext<CaptureController | null>(null);
export function useCapture() {
  const controller = useContext(Context);
  if (!controller) throw new Error("Capture provider is missing.");
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return { controller, ...snapshot };
}

export function CaptureProvider({ children }: { children: ReactNode }) {
  const workspace = useWorkspace();
  const latestWorkspace = useRef(workspace);
  const controllerRef = useRef<CaptureController | null>(null);
  latestWorkspace.current = workspace;
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    numberOfChannels: 1, sampleRate: 24000, bitRate: 24000,
    directory: "document",
    android: { ...RecordingPresets.HIGH_QUALITY.android, maxFileSize: MAX_AUDIO_BYTES },
  }, (status) => {
    if (status.isFinished || status.hasError || status.mediaServicesDidReset) void controllerRef.current?.interrupt();
  });
  const [controller] = useState(() => new CaptureController({
    store: createCaptureStore(),
    backend: {
      owner: workspace.owner, patientId: workspace.space.id,
      beginSession: () => latestWorkspace.current.beginSession(),
      endSession: (id) => latestWorkspace.current.endSession(id),
      upload: (recording) => latestWorkspace.current.upload(recording),
    },
    device: {
      prepare: async () => {
        if (Constants.appOwnership === "expo" || Platform.OS === "web") throw new Error("Background recording requires a native development build, not Expo Go.");
        if (AppState.currentState !== "active") throw new Error("Open Hale before starting the microphone.");
        const permission = await AudioModule.requestRecordingPermissionsAsync();
        if (!permission.granted) throw new Error("Microphone access is off. Enable it in your device’s app settings, then try again.");
        await setAudioModeAsync({ allowsRecording: true, allowsBackgroundRecording: true, playsInSilentMode: true, interruptionMode: "doNotMix" });
        await recorder.prepareToRecordAsync();
        if (!recorder.uri) throw new Error("The microphone did not provide a local recording file.");
        return recorder.uri;
      },
      record: () => recorder.record({ forDuration: MAX_NATIVE_RECORDING_SECONDS }),
      stop: async () => { if (recorder.getStatus().canRecord) await recorder.stop(); },
      status: () => ({ ...recorder.getStatus(), isRecording: recorder.isRecording }),
      measureDuration: measureMediaDuration,
      disable: () => setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false }),
    },
  }));
  controllerRef.current = controller;
  useEffect(() => {
    const interval = setInterval(controller.observe, 1000);
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") controller.observe(); });
    return () => { clearInterval(interval); subscription.remove(); controller.dispose(); };
  }, [controller]);
  return <Context.Provider value={controller}>{children}</Context.Provider>;
}
