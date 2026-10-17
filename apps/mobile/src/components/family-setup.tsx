import { useState } from "react";
import { FamilyLink } from "./family-link";
import { Button, Gate } from "./ui";

export function FamilySetup({ patientId, onContinue }: { patientId: string; onContinue(): void }) {
  const [connected, setConnected] = useState(false);
  return <Gate title={connected ? "Your family is connected." : "Bring your family closer."} description={connected ? "Your family dashboard is linked. You can manage sharing anytime under More → Connect family." : "Your patient account is ready. Connect to your family’s dashboard by scanning their QR code or entering their family code."}>
    <FamilyLink patientId={patientId} disabled={false} onConnected={() => setConnected(true)} />
    <Button title={connected ? "Continue to my dashboard" : "I’ll connect my family later"} tone="secondary" onPress={onContinue} />
  </Gate>;
}
