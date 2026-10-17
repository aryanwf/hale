import { useEffect, useRef, useState } from "react";
import { AppState, Linking, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { readFamilyQr } from "@hale/contracts/family-link";
import { Button, Page } from "./ui";
import { styles } from "../theme";
import type { FamilyScannerProps } from "./family-scanner";

export function FamilyCamera({ onScan, onClose }: FamilyScannerProps) {
  const [permission, requestPermission, refreshPermission] = useCameraPermissions();
  const [active, setActive] = useState(AppState.currentState === "active");
  const [error, setError] = useState("");
  const [cameraFailed, setCameraFailed] = useState(false);
  const accepted = useRef(false);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setActive(state === "active");
      if (state === "active") void refreshPermission().catch(() => setError("Couldn’t check camera access. Enter the family code instead."));
    });
    return () => subscription.remove();
  }, [refreshPermission]);
  async function allowCamera() {
    setError("");
    try {
      if (permission && !permission.canAskAgain) await Linking.openSettings();
      else await requestPermission();
    } catch { setError("Couldn’t open the camera. You can enter the family code instead."); }
  }
  function scanned({ data }: BarcodeScanningResult) {
    if (accepted.current) return;
    const code = readFamilyQr(data);
    if (!code) { setError("This isn’t a Hale family QR code. Scan the QR code on your family member’s dashboard, or enter their family code instead."); return; }
    accepted.current = true;
    onScan(code);
  }
  return <SafeAreaView style={styles.screen}><Page eyebrow="CONNECT YOUR FAMILY" title="Scan their family QR code." description="Point your camera at the QR code on your family member’s Hale dashboard. You’ll confirm sharing before anything is linked.">
    {!permission ? <Text style={styles.small}>Checking camera permission…</Text> : !permission.granted ? <View style={styles.card}>
      <Text style={styles.body}>Camera access is only used for scanning. No photos or video are saved or uploaded.</Text>
      <Button title={permission.canAskAgain ? "Allow camera access" : "Open camera settings"} onPress={() => void allowCamera()} />
      <Text style={styles.small}>Prefer not to use your camera? Enter the family code instead.</Text>
    </View> : cameraFailed ? <Text style={styles.body}>The camera couldn’t start. Close the scanner and enter the family code instead.</Text> : active ? <View style={{ height: 300, borderRadius: 20, overflow: "hidden" }}>
      <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={scanned} onMountError={() => setCameraFailed(true)} />
    </View> : <Text style={styles.small}>Return to Hale to resume scanning.</Text>}
    {error && <Text accessibilityRole="alert" style={styles.small}>{error}</Text>}
    <Button title="Enter family code instead" tone="secondary" onPress={onClose} />
  </Page></SafeAreaView>;
}
