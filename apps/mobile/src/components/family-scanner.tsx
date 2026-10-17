import { Component, Suspense, lazy, type ReactNode } from "react";
import { requireOptionalNativeModule } from "expo";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Page } from "./ui";
import { styles } from "../theme";

export interface FamilyScannerProps {
  onScan(code: string): void;
  onClose(): void;
}

const FamilyCamera = lazy(() => import("./family-camera").then((module) => ({ default: module.FamilyCamera })));

function ScannerNotice({ title, description, onClose }: { title: string; description: string; onClose(): void }) {
  return <SafeAreaView style={styles.screen}><Page eyebrow="CONNECT YOUR FAMILY" title={title} description={description}>
    <Button title="Enter family code instead" tone="secondary" onPress={onClose} />
  </Page></SafeAreaView>;
}

class CameraBoundary extends Component<{ children: ReactNode; onClose(): void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <ScannerNotice title="The camera couldn’t open." description="Restart Hale and try again. If this app was installed before QR scanning was added, install a rebuilt Android development app. You can still enter the family code manually." onClose={this.props.onClose} />;
    return this.props.children;
  }
}

export function FamilyScanner(props: FamilyScannerProps) {
  if (!requireOptionalNativeModule("ExpoCamera")) return <ScannerNotice title="This app needs a camera update." description="The installed Android app doesn’t include the camera module. Rebuild and reinstall Hale using bun run mobile:android, then restart Metro. Reloading JavaScript alone cannot add the camera. Manual code entry still works." onClose={props.onClose} />;
  return <CameraBoundary onClose={props.onClose}><Suspense fallback={<ScannerNotice title="Opening camera…" description="Preparing the QR scanner." onClose={props.onClose} />}><FamilyCamera {...props} /></Suspense></CameraBoundary>;
}
