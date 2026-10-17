"use client";

import Link from "next/link";
import { ChevronRight, Database, RotateCcw, ShieldCheck, Smartphone, Trash2 } from "lucide-react";
import { useWorkspace } from "./providers";

export function SettingsView() {
  const { mode, resetDemo } = useWorkspace();

  return <div className="settings-view">
    <header className="settings-page-heading"><h1>Settings</h1><p className="settings-title-subtitle">Terms and Conditions</p></header>
    <nav className="settings-options" aria-label="Settings topics">
      <Link className="settings-option" href="/family/settings/family-access">
        <span className="settings-option-icon"><ShieldCheck size={20} aria-hidden="true" /></span>
        <div className="settings-option-copy"><h2>Your family access</h2><p>Who can see this space, how approval works, and what family access allows.</p></div>
        <ChevronRight size={19} aria-hidden="true" />
      </Link>
      <Link className="settings-option" href="/family/settings/patient-phone">
        <span className="settings-option-icon"><Smartphone size={20} aria-hidden="true" /></span>
        <div className="settings-option-copy"><h2>Patient phone. Family dashboard.</h2><p>How the patient connects from Android and shares memories with family.</p></div>
        <ChevronRight size={19} aria-hidden="true" />
      </Link>
      <Link className="settings-option" href="/family/settings/shared-data">
        <span className="settings-option-icon"><Database size={20} aria-hidden="true" /></span>
        <div className="settings-option-copy"><h2>What is shared</h2><p>What happens to conversation audio, transcripts, memories, and voice profiles.</p></div>
        <ChevronRight size={19} aria-hidden="true" />
      </Link>
      <Link className="settings-option" href="/privacy">
        <span className="settings-option-icon"><ShieldCheck size={20} aria-hidden="true" /></span>
        <div className="settings-option-copy"><h2>Privacy &amp; security center</h2><p>Review access, consent, retention, access history and authorized data export.</p></div>
        <ChevronRight size={19} aria-hidden="true" />
      </Link>
    </nav>

    {mode === "demo" && <section className="settings-card settings-demo" aria-labelledby="demo-settings-title">
      <div><h2 id="demo-settings-title">Demo workspace</h2><p>Demo memories are synthetic. No patient is connected and no real family code is generated.</p></div>
      <button className="btn btn-quiet" onClick={resetDemo}><RotateCcw size={16} />Reset demo</button>
    </section>}

    {mode === "live" && <section className="settings-card account-danger">
      <div className="icon-label"><Trash2 size={21} /><h2>Delete account</h2></div>
      <p>Permanently delete your Hale data and sign-in account. Any patient spaces you own will also be deleted. You’ll review the consequences and confirm before anything is removed.</p>
      <Link className="btn btn-primary" href="/account/delete">Delete account</Link>
    </section>}
  </div>;
}
