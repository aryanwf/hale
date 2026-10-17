"use client";

import { FamilyConnection } from "@/components/family-connection";
import { useWorkspace } from "@/components/providers";
import { Link2 } from "lucide-react";

export default function ConnectPage() {
  const { mode } = useWorkspace();
  return mode === "live" ? <FamilyConnection /> : <section className="family-connection family-connection-demo" aria-labelledby="demo-connection-title">
    <header className="family-connection-heading">
      <h1 id="demo-connection-title">Connect your family</h1>
      <p className="connection-intro">On your loved one’s Android phone, scan the QR code or enter the family code to connect them to this family dashboard.</p>
    </header>
    <div className="family-code-status family-code-status-demo">
      <span className="family-code-status-icon"><Link2 size={18} /></span>
      <div><strong>Family codes aren’t available in demo mode</strong><p>Use a live family account to generate a private code for your loved one.</p></div>
    </div>
  </section>;
}
