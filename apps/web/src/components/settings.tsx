"use client";

import Link from "next/link";
import { Database, RotateCcw, ShieldCheck, Smartphone, Trash2 } from "lucide-react";
import { useWorkspace } from "./providers";
import { PageIntro } from "./ui";

export function SettingsView() {
  const { mode, space, resetDemo } = useWorkspace();
  return <>
    <PageIntro eyebrow="FAMILY ACCESS & PRIVACY" title={<>Close to them.<br /><span className="heading-light">On their terms.</span></>} description="Your family dashboard shows only the patient spaces shared with your account." />
    <div className="settings-grid">
      <section className="settings-card"><div className="icon-label"><ShieldCheck size={21} /><h2>Your family access</h2></div><dl className="settings-rows"><div><dt>Connected patient</dt><dd>{space.name}</dd></div><div><dt>Their timezone</dt><dd>{space.timezone}</dd></div><div><dt>Account access</dt><dd>{mode === "demo" ? "Fictional demo" : "Read-only family membership"}</dd></div></dl><p>The patient approves your connection in the Android app and can remove your access. A family code never gives permission to record, delete conversations, or manage the patient’s account.</p><Link className="text-link" href="/family/connect">Connect another patient →</Link></section>
      <section className="settings-card"><div className="icon-label"><Smartphone size={21} /><h2>Patient phone. Family dashboard.</h2></div><ol className="install-steps"><li>You create a family account on this website.</li><li>Your private family code appears on your dashboard.</li><li>The patient signs in to Hale on Android with their own account.</li><li>They enter your code under More → Connect family and approve sharing.</li></ol><p>Once linked, uploaded conversations and processed memories appear here automatically. Recording happens in the Android app, not this browser.</p></section>
       <section className="settings-card"><div className="icon-label"><Database size={21} /><h2>What is shared</h2></div><dl className="settings-rows"><div><dt>Temporary conversation audio</dt><dd>Deleted after processing; expires in about 24 hours if stalled</dd></div><div><dt>Transcripts & memories</dt><dd>Until the patient deletes them</dd></div><div><dt>Voice profile</dt><dd>Optional, separate consent</dd></div></dl><p>Providers receive audio for transcription and optional speaker matching; their independent retention is governed by their terms. Cloud processing is not end-to-end encrypted. Transcripts can be incomplete or inaccurate. Hale is a memory aid, not a medical service.</p><Link className="text-link" href="/signup/voice">Manage my family voice profile →</Link></section>
      {mode === "demo" && <section className="settings-card"><h2>A fictional family space</h2><p>Demo memories are synthetic. No patient is connected and no real family code is generated.</p><button className="btn btn-quiet" onClick={resetDemo}><RotateCcw size={16} />Reset demo</button></section>}
      {mode === "live" && <section className="settings-card account-danger"><div className="icon-label"><Trash2 size={21} /><h2>Delete account</h2></div><p>Permanently delete your Hale data and sign-in account. Any patient spaces you own will also be deleted. You’ll review the consequences and confirm before anything is removed.</p><Link className="btn btn-quiet" href="/account/delete">Delete account</Link></section>}
    </div>
  </>;
}
