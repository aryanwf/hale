"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useWorkspace } from "./providers";
import type { SettingsTopic } from "./settings-topics";
import { PageIntro } from "./ui";

const topicCopy: Record<SettingsTopic, { title: string; description: string }> = {
  "family-access": {
    title: "Your family access",
    description: "Your family account can see only the patient spaces shared with it. The patient stays in control of that connection.",
  },
  "patient-phone": {
    title: "Patient phone. Family dashboard.",
    description: "Hale runs on the patient’s Android phone. This website is where approved family members can review what has been shared.",
  },
  "shared-data": {
    title: "What is shared",
    description: "See what happens to recordings, transcripts, saved memories, and an optional family voice profile.",
  },
};

export function SettingsDetailView({ section }: { section: SettingsTopic }) {
  const { mode, space } = useWorkspace();
  const { title, description } = topicCopy[section];

  return <article className="settings-detail">
    <Link className="back-link" href="/family/settings"><ArrowLeft size={16} />All settings</Link>
    <PageIntro eyebrow="FAMILY SETTINGS" title={title} description={description} />
    <div className="settings-detail-content">
      {section === "family-access" && <>
        <section className="settings-detail-section">
          <h2>What your family account can see</h2>
          <p>Family access is read-only. It lets you review the patient space and the conversations and memories the patient has chosen to share. It does not let you record, delete conversations, or manage the patient’s account.</p>
          <dl className="settings-rows">
            <div><dt>Connected patient</dt><dd>{space.name}</dd></div>
            <div><dt>Patient time zone</dt><dd>{space.timezone}</dd></div>
            <div><dt>Account access</dt><dd>{mode === "demo" ? "Fictional demo" : "Read-only family membership"}</dd></div>
          </dl>
        </section>
        <section className="settings-detail-section">
          <h2>The patient approves the connection</h2>
          <p>The patient approves your connection in the Android app and can remove your access. A family code does not give permission to record, delete conversations, or manage the patient’s account.</p>
          <Link className="text-link" href="/family/connect">Connect another patient <ArrowRight size={16} /></Link>
        </section>
      </>}

      {section === "patient-phone" && <>
        <section className="settings-detail-section">
          <h2>How the connection works</h2>
          <ol className="settings-detail-steps">
            <li><strong>Create a family account.</strong><p>The family member signs in on this website.</p></li>
            <li><strong>Get a family code.</strong><p>Find the private code on the Connect family page of the dashboard.</p></li>
            <li><strong>Open Hale on the patient’s Android phone.</strong><p>The patient uses their own account and opens More → Connect family.</p></li>
            <li><strong>Review and approve sharing.</strong><p>The patient enters the code or scans the QR code, then approves the connection.</p></li>
          </ol>
        </section>
        <section className="settings-detail-section">
          <h2>What happens after approval</h2>
          <p>Uploaded conversations and processed memories appear on the family dashboard after sharing is approved. Recording happens in the Android app, not in this browser. Family access remains read-only.</p>
          <Link className="text-link" href="/family/connect">Open Connect family <ArrowRight size={16} /></Link>
        </section>
      </>}

      {section === "shared-data" && <>
        <section className="settings-detail-section">
          <h2>What the patient chooses to share</h2>
          <dl className="settings-rows">
            <div><dt>Temporary conversation audio</dt><dd>Deleted after processing; expires in about 24 hours if stalled</dd></div>
            <div><dt>Transcripts and memories</dt><dd>Available until the patient deletes them</dd></div>
            <div><dt>Voice profile</dt><dd>Optional, with separate consent</dd></div>
          </dl>
          <p>Providers receive audio for transcription and optional speaker matching; their independent retention is governed by their terms. Cloud processing is not end-to-end encrypted. Transcripts can be incomplete or inaccurate. Hale is a memory aid, not a medical service.</p>
          <Link className="text-link" href="/signup/voice">Manage family voice profile <ArrowRight size={16} /></Link>
        </section>
      </>}
    </div>
  </article>;
}
