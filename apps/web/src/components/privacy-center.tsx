"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth, UserButton } from "@clerk/nextjs";
import { ConvexError } from "convex/values";
import { useConvex, useConvexAuth, useMutation, useQuery } from "convex/react";
import {
  Activity, ArrowLeft, ArrowRight, AudioLines, Check, ChevronDown, Clock3, Database,
  Download, FileClock, HeartHandshake, History, Leaf, LockKeyhole, Mic, ShieldCheck, Sparkles,
  Trash2, UserRound, Users, X,
} from "lucide-react";
import type { PatientInfo, PrivacyExportConversation, PrivacyExportPage } from "@hale/contracts/api";
import { normalizeFamilyCode } from "@hale/contracts/family-link";
import { api } from "@/lib/api";
import { appMode } from "@/lib/app-mode";
import { PageIntro } from "./ui";

type PendingAction =
  | { kind: "recording"; enabled: boolean }
  | { kind: "external-ai"; enabled: boolean }
  | { kind: "retention"; days: 7 | 30 | null }
  | { kind: "grant-family"; code: string }
  | { kind: "revoke-family"; personId: string; name: string }
  | { kind: "delete-conversation"; conversationId: string; title: string }
  | { kind: "export" };

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ConvexError) return String(error.data);
  return error instanceof Error ? error.message : fallback;
}

function PrivacyMasthead({ patients, selected, onSelect, role }: {
  patients: PatientInfo[];
  selected?: PatientInfo;
  onSelect(value: string): void;
  role?: "patient" | "family";
}) {
  return <header className="masthead"><div className="page-wrap">
    <div className="masthead-top"><div className="masthead-left"><Link className="wordmark" href={role === "patient" ? "/privacy" : "/family/overview"}><Leaf size={23} strokeWidth={1.8} />hale.</Link>
      {selected && <><span className="header-divider" /><label className="patient-select-control privacy-patient-select"><span className="sr-only">Patient space</span><select aria-label="Patient space" value={selected.id} onChange={(event) => onSelect(event.target.value)}>{patients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={14} /></label></>}
    </div><div className="masthead-right">{role !== "patient" && <Link href="/family/overview" className="patient-view-link"><ArrowLeft size={14} />Family dashboard</Link>}<UserButton /></div></div>
    <nav className="family-tabs" aria-label="Settings navigation">{role !== "patient" && <Link href="/family/settings">Settings</Link>}<Link href="/privacy" aria-current="page">Privacy &amp; security</Link></nav>
  </div></header>;
}

export function PrivacyCenterPage() {
  if (appMode === "demo") return <DemoPrivacyCenter />;
  if (appMode !== "live") return <main className="gate"><Link className="wordmark" href="/"><Leaf size={23} />hale.</Link><p className="eyebrow">PRIVACY &amp; SECURITY</p><h1>Your privacy settings need a live connection.</h1><p className="gate-description">Set the application mode to live and sign in to manage real patient privacy settings.</p></main>;
  return <LivePrivacyCenter />;
}

function DemoPrivacyCenter() {
  return <div className="family-app"><header className="masthead"><div className="page-wrap"><div className="masthead-top"><Link className="wordmark" href="/family/overview"><Leaf size={23} />hale.</Link><Link href="/family/settings" className="patient-view-link"><ArrowLeft size={14} />Settings</Link></div><nav className="family-tabs"><Link href="/family/settings">Settings</Link><Link href="/privacy" aria-current="page">Privacy &amp; security</Link></nav></div></header><main className="page-wrap family-main">
    <PageIntro eyebrow="PRIVACY & SECURITY" title="Your privacy, clearly." description="Review and manage the choices that protect a patient’s conversations and memories." />
    <div className="info-strip"><ShieldCheck size={17} /><p>This demo contains fictional records only. Privacy controls and data exports are available after signing in to a live Hale account; demo changes are not represented as saved settings.</p></div>
  </main></div>;
}

function LivePrivacyCenter() {
  const { isLoaded, isSignedIn } = useAuth();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const accountStatus = useQuery(api.accountStatus, isAuthenticated ? {} : "skip");
  const patients = useQuery(api.patientSpaces, isAuthenticated && accountStatus === "active" ? {} : "skip");
  const [selectedId, setSelectedId] = useState<string>();
  if (!isLoaded || isLoading || (isAuthenticated && accountStatus === undefined)) return <main className="gate"><Link className="wordmark" href="/"><Leaf size={23} />hale.</Link><p className="loading-text" role="status">Checking your secure connection…</p></main>;
  if (!isSignedIn || !isAuthenticated) return <main className="gate"><Link className="wordmark" href="/"><Leaf size={23} />hale.</Link><p className="eyebrow">PRIVACY &amp; SECURITY</p><h1>Sign in to manage privacy.</h1><p className="gate-description">Patient privacy controls are available only to an authenticated member of that patient space.</p><Link className="btn btn-primary" href="/login">Sign in <ArrowRight size={16} /></Link></main>;
  if (accountStatus === "deleted") return <main className="gate"><Link className="wordmark" href="/"><Leaf size={23} />hale.</Link><p className="eyebrow">ACCOUNT DELETED</p><h1>Your Hale data has been removed.</h1><p className="gate-description">Finish deleting your sign-in account or create a new one to continue.</p><Link className="btn btn-primary" href="/account/delete">Finish account deletion</Link></main>;
  if (!patients) return <main className="gate"><p className="loading-text" role="status">Loading your patient spaces…</p></main>;
  if (!patients.length) return <main className="gate"><Link className="wordmark" href="/"><Leaf size={23} />hale.</Link><p className="eyebrow">PRIVACY &amp; SECURITY</p><h1>No patient space is connected yet.</h1><p className="gate-description">Connect a patient space from your family dashboard, or create a patient space in the Hale Android app.</p><Link className="btn btn-primary" href="/family/connect">Connect a patient space</Link></main>;
  const selected = patients.find((patient) => patient.id === selectedId) ?? patients[0]!;
  return <div className="family-app"><PrivacyMasthead patients={patients} selected={selected} onSelect={setSelectedId} role={selected.capabilities.includes("sharing:manage") ? "patient" : "family"} />
    <main className="page-wrap family-main"><PrivacyDashboard key={selected.id} patient={selected} /></main>
  </div>;
}

function PrivacyDashboard({ patient }: { patient: PatientInfo }) {
  const convex = useConvex();
  const center = useQuery(api.privacy.center, { patientId: patient.id });
  const recordAccess = useMutation(api.privacy.recordAccess);
  const setRecordingConsent = useMutation(api.privacy.setRecordingConsent);
  const setExternalAIConsent = useMutation(api.privacy.setExternalAIConsent);
  const setRetention = useMutation(api.privacy.setRetention);
  const requestExport = useMutation(api.privacy.requestExport);
  const linkFamily = useMutation(api.linkFamily);
  const unlinkFamily = useMutation(api.unlinkFamily);
  const deleteConversation = useMutation(api.deleteConversation);
  const dialog = useRef<HTMLDialogElement>(null);
  const recordedPatient = useRef<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [familyCode, setFamilyCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!center || recordedPatient.current === patient.id) return;
    recordedPatient.current = patient.id;
    void recordAccess({ patientId: patient.id, resource: "privacy_center" }).catch(() => {});
  }, [center, patient.id, recordAccess]);
  useEffect(() => {
    if (pending) dialog.current?.showModal();
    else dialog.current?.close();
  }, [pending]);

  if (!center) return <p className="loading-text" role="status">Loading privacy settings…</p>;

  const isManager = center.permissions.canManagePrivacy;
  const familyMembers = center.family.filter((person) => person.role === "family" && person.active);

  function askFor(action: PendingAction) {
    setError("");
    setSuccess("");
    setPending(action);
  }

  async function downloadExport() {
    setExportBusy(true);
    setError("");
    setSuccess("");
    try {
      await requestExport({ patientId: patient.id });
      let indexCursor: string | null = null;
      let indexDone = false;
      let exportedPatient: { id: string; name: string; timezone: string } | undefined;
      const conversations: {
        id: string; title: string; summary: string; startedAt: number; duration: number; localDate: string; people: string[]; state: string;
        turns: { id: string; speaker: string; personId?: string; start: number; end: number; text: string; uncertain: boolean }[];
        memories: { id: string; kind: string; title: string; text: string; localDate: string; plannedFor?: string; occurredAt?: string; turnIds: string[]; people: string[] }[];
      }[] = [];
      while (!indexDone) {
        const page: { patient: { id: string; name: string; timezone: string }; page: PrivacyExportConversation[]; isDone: boolean; continueCursor: string } = await convex.query(api.privacy.exportIndex, { patientId: patient.id, paginationOpts: { numItems: 50, cursor: indexCursor } });
        exportedPatient = page.patient;
        indexDone = page.isDone;
        indexCursor = page.continueCursor;
        for (const item of page.page) {
          const turns: { id: string; speaker: string; personId?: string; start: number; end: number; text: string; uncertain: boolean }[] = [];
          const memories: { id: string; kind: string; title: string; text: string; localDate: string; plannedFor?: string; occurredAt?: string; turnIds: string[]; people: string[] }[] = [];
          let turnsCursor: string | null = null;
          let memoriesCursor: string | null = null;
          let turnsDone = false;
          let memoriesDone = false;
          let conversation = item;
          while (!turnsDone || !memoriesDone) {
            const content: {
              conversation: PrivacyExportConversation;
              turns: PrivacyExportPage<{ id: string; speaker: string; personId?: string; start: number; end: number; text: string; uncertain: boolean }>;
              memories: PrivacyExportPage<{ id: string; kind: string; title: string; text: string; localDate: string; plannedFor?: string; occurredAt?: string; turnIds: string[]; people: string[] }>;
            } = await convex.query(api.privacy.exportConversationPage, {
              conversationId: item.id,
              turnsPaginationOpts: { numItems: 100, cursor: turnsCursor },
              memoriesPaginationOpts: { numItems: 100, cursor: memoriesCursor },
            });
            conversation = content.conversation;
            turns.push(...content.turns.page);
            memories.push(...content.memories.page);
            turnsDone = content.turns.isDone;
            memoriesDone = content.memories.isDone;
            turnsCursor = content.turns.continueCursor;
            memoriesCursor = content.memories.continueCursor;
          }
          conversations.push({ ...conversation, turns, memories });
        }
      }
      const payload = JSON.stringify({ format: "Hale patient-data export", version: 1, exportedAt: new Date().toISOString(), patient: exportedPatient, conversations }, null, 2);
      const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `hale-${patient.name.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "")}-export.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setSuccess("Your authorized data export has been prepared and downloaded.");
    } catch (exception) {
      setError(errorMessage(exception, "The export could not be completed. Sign in again and retry."));
    } finally {
      setExportBusy(false);
    }
  }

  async function runPendingAction() {
    if (!pending || busy) return;
    const action = pending;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      if (action.kind === "recording") {
        await setRecordingConsent({ patientId: patient.id, enabled: action.enabled });
        setSuccess(action.enabled ? "Recording consent is on. Everyone present still needs to agree before each session." : "Future recording consent is off. Active sessions were stopped.");
      } else if (action.kind === "external-ai") {
        await setExternalAIConsent({ patientId: patient.id, enabled: action.enabled });
        setSuccess(action.enabled ? "External AI processing consent is on." : "External AI consent is off. Active sessions were stopped, pending processing was cancelled and temporary audio was removed.");
      } else if (action.kind === "retention") {
        await setRetention({ patientId: patient.id, retentionDays: action.days });
        setSuccess(action.days === null ? "Automatic conversation deletion is off." : `Automatic deletion after ${action.days} days is enabled.`);
      } else if (action.kind === "grant-family") {
        await linkFamily({ patientId: patient.id, code: action.code });
        setFamilyCode("");
        setSuccess("Family access was granted. They can read saved conversations, transcripts and memories.");
      } else if (action.kind === "revoke-family") {
        await unlinkFamily({ patientId: patient.id, personId: action.personId });
        setSuccess(`${action.name} no longer has access to this patient space.`);
      } else if (action.kind === "delete-conversation") {
        await deleteConversation({ conversationId: action.conversationId });
        setSuccess("The conversation, transcript, linked memories and temporary audio were deleted.");
      } else if (action.kind === "export") {
        dialog.current?.close();
        setPending(null);
        await downloadExport();
        return;
      }
      dialog.current?.close();
      setPending(null);
    } catch (exception) {
      setError(errorMessage(exception, "The change could not be saved. Check your connection and try again."));
      dialog.current?.close();
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  const retentionValue = center.settings.retentionDays === null ? "manual" : String(center.settings.retentionDays);
  const retentionLabel = center.settings.retentionDays === null ? "Manual deletion" : `Delete after ${center.settings.retentionDays} days`;
  return <div className="privacy-center">
    <PageIntro eyebrow="PATIENT-SPACE PRIVACY" title="Privacy & security" description="A clear view of who can access this space, what processing is allowed, and how long saved conversations remain." aside={<span className="private-label"><span className="status-dot" />{center.viewer.role === "patient" ? "Patient-controlled space" : "Authorized family access"}</span>} />

    {(error || success) && <div className={`info-strip ${error ? "privacy-error" : "privacy-success"}`} role={error ? "alert" : "status"}>{error ? <X size={17} /> : <Check size={17} />}<p>{error || success}</p></div>}

    <section className="privacy-overview" aria-labelledby="privacy-overview-title">
      <div className="privacy-overview-copy"><span className="feature-icon"><ShieldCheck size={22} /></span><div><p className="eyebrow">PRIVACY OVERVIEW</p><h2 id="privacy-overview-title">{center.patient.name}’s space</h2><p>Shared conversations stay read-only. The patient can separately enable limited Care controls for individual family members.</p></div></div>
      <div className="privacy-overview-stats"><div><span className="eyebrow">RECORDING</span><strong className={center.settings.recordingEnabled ? "privacy-value-on" : ""}>{center.settings.recordingEnabled ? "Allowed" : "Off"}</strong></div><div><span className="eyebrow">EXTERNAL AI</span><strong className={center.settings.externalAIEnabled ? "privacy-value-on" : ""}>{center.settings.externalAIEnabled ? "Allowed" : "Off"}</strong></div><div><span className="eyebrow">RETENTION</span><strong>{retentionLabel}</strong></div><div><span className="eyebrow">FAMILY ACCESS</span><strong>{familyMembers.length} {familyMembers.length === 1 ? "member" : "members"}</strong></div></div>
    </section>

    {!isManager && <div className="privacy-readonly"><LockKeyhole size={17} /><p>The patient manages consent, retention and family membership. Shared conversations remain read-only; patient-approved Care controls are limited to event review, contacts and alerts.</p></div>}

    <div className="privacy-grid">
      <section className="privacy-card" aria-labelledby="recording-title">
        <div className="privacy-card-heading"><span className="settings-option-icon"><Mic size={20} /></span><div><p className="eyebrow">RECORDING PERMISSIONS</p><h2 id="recording-title">Future conversation recordings</h2></div></div>
        <p className="privacy-description">Control whether new sessions may start. Everyone in a conversation must still agree before each recording.</p>
        <div className="privacy-control-row"><div><strong>{center.settings.recordingEnabled ? "Recording consent is on" : "Recording consent is off"}</strong><span>{center.settings.recordingEnabled ? "New sessions are permitted after participant consent." : "The microphone and upload APIs reject new recordings."}</span></div><button className="privacy-switch" type="button" role="switch" aria-label="Future conversation recording consent" aria-checked={center.settings.recordingEnabled} disabled={!isManager || busy} onClick={() => askFor({ kind: "recording", enabled: !center.settings.recordingEnabled })}><span /></button></div>
        {!isManager && <p className="privacy-help">Only the patient can change recording consent.</p>}
      </section>

      <section className="privacy-card" aria-labelledby="ai-title">
        <div className="privacy-card-heading"><span className="settings-option-icon"><Sparkles size={20} /></span><div><p className="eyebrow">AI DATA PRIVACY</p><h2 id="ai-title">External AI processing</h2></div></div>
        <p className="privacy-description">Sarvam receives audio for transcription. Optional speaker matching and appointment suggestions can also send data to providers.</p>
        <div className="privacy-control-row"><div><strong>{center.settings.externalAIEnabled ? "External AI processing is allowed" : "External AI processing is off"}</strong><span>{center.settings.externalAIEnabled ? "New transcription and optional AI tasks may be sent to configured providers." : "New external processing is blocked. Existing transcripts remain available."}</span></div><button className="privacy-switch" type="button" role="switch" aria-label="External AI processing consent" aria-checked={center.settings.externalAIEnabled} disabled={!isManager || busy} onClick={() => askFor({ kind: "external-ai", enabled: !center.settings.externalAIEnabled })}><span /></button></div>
        <div className="privacy-inline-note"><LockKeyhole size={15} /><p>Turning this off stops active sessions and queued jobs and removes unprocessed temporary audio. It cannot recall information already received by a provider.</p></div>
      </section>

      <section className="privacy-card" aria-labelledby="family-access-title">
        <div className="privacy-card-heading"><span className="settings-option-icon"><Users size={20} /></span><div><p className="eyebrow">FAMILY ACCESS MANAGEMENT</p><h2 id="family-access-title">People with access</h2></div></div>
         <p className="privacy-description">Family members can read saved conversations, transcripts and memories. The patient can separately enable Care controls for a linked family member. Access is checked by the server on every request.</p>
        <div className="privacy-member-list">{center.family.map((member) => <div className="privacy-member" key={member.id || member.role}>
          <span className={`avatar ${member.role === "patient" ? "avatar-ink" : ""}`}><UserRound size={16} /></span><div className="privacy-member-copy"><strong>{member.name}</strong><span>{member.role === "patient" ? "Patient · manages this space" : `${member.relationship} · family member`}</span><small>{member.permissions.join(" · ")}</small></div>
          {member.role === "family" && isManager && member.id && <button className="btn btn-quiet privacy-remove" type="button" disabled={busy} onClick={() => askFor({ kind: "revoke-family", personId: member.id, name: member.name })}>Remove access</button>}
        </div>)}</div>
        {isManager ? <div className="privacy-grant-form"><label htmlFor="family-code">Grant access with a family code</label><div><input id="family-code" value={familyCode} maxLength={40} autoCapitalize="characters" autoCorrect="off" placeholder="Enter a family member’s code" onChange={(event) => setFamilyCode(event.target.value)} /><button className="btn btn-primary" type="button" disabled={busy || !normalizeFamilyCode(familyCode)} onClick={() => { const code = normalizeFamilyCode(familyCode); if (code) askFor({ kind: "grant-family", code }); }}>Grant access <ArrowRight size={15} /></button></div><p>Only share with someone you trust. They’ll be able to read this patient space.</p></div> : <p className="privacy-help">A family code must be approved by the patient in the patient app.</p>}
      </section>

      <section className="privacy-card" aria-labelledby="retention-title">
        <div className="privacy-card-heading"><span className="settings-option-icon"><Clock3 size={20} /></span><div><p className="eyebrow">DATA RETENTION</p><h2 id="retention-title">Keep conversations for</h2></div></div>
        <p className="privacy-description">Choose when saved conversations, transcripts and linked memories are automatically deleted.</p>
        <label className="privacy-select-label" htmlFor="retention-setting">Automatic deletion</label><select id="retention-setting" className="privacy-select" value={retentionValue} disabled={!isManager || busy} onChange={(event) => askFor({ kind: "retention", days: event.target.value === "7" ? 7 : event.target.value === "30" ? 30 : null })}><option value="7">After 7 days</option><option value="30">After 30 days</option><option value="manual">Manual deletion only</option></select>
        <div className="privacy-inline-note"><FileClock size={15} /><p>Temporary raw audio is deleted after processing and expires after about 24 hours if processing stalls. Provider retention is governed by their terms.</p></div>
      </section>

      <section className="privacy-card privacy-card-wide" aria-labelledby="history-title">
        <div className="privacy-card-heading"><span className="settings-option-icon"><History size={20} /></span><div><p className="eyebrow">ACCESS HISTORY</p><h2 id="history-title">Recent access and privacy changes</h2></div></div>
        <p className="privacy-description">This history records dashboard visits, family-access changes, consent updates, exports and deletions.</p>
        {center.accessHistory.length ? <ol className="privacy-history">{center.accessHistory.map((event) => <li key={event.id}><span className="privacy-history-icon"><Activity size={15} /></span><div><strong>{eventLabel(event.operation)}</strong><span>{event.actor} · {event.targetLabel}</span></div><time dateTime={new Date(event.timestamp).toISOString()}>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(event.timestamp)}</time></li>)}</ol> : <p className="privacy-empty">No access history is available yet.</p>}
      </section>

      <section className="privacy-card privacy-card-wide" aria-labelledby="data-management-title">
        <div className="privacy-card-heading"><span className="settings-option-icon"><Database size={20} /></span><div><p className="eyebrow">DATA MANAGEMENT</p><h2 id="data-management-title">Export or delete saved records</h2></div></div>
        <p className="privacy-description">Exports include saved conversation details, available transcript turns and linked memories. Only records this account is authorized to read are included.</p>
        <div className="privacy-data-actions"><button className="btn btn-quiet" type="button" disabled={exportBusy} onClick={() => askFor({ kind: "export" })}><Download size={16} />{exportBusy ? "Preparing export…" : "Request data export"}</button>{center.permissions.canDeleteRecords && <span className="small muted"><Trash2 size={14} />You can delete individual records below.</span>}</div>
        {center.recentConversations.length ? <div className="privacy-record-list">{center.recentConversations.map((conversation) => <div className="privacy-record" key={conversation.id}><div><strong>{conversation.title}</strong><span>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(conversation.startedAt)} · {conversation.state}</span></div>{center.permissions.canDeleteRecords && <button className="icon-button privacy-delete-button" type="button" aria-label={`Delete ${conversation.title}`} disabled={busy} onClick={() => askFor({ kind: "delete-conversation", conversationId: conversation.id, title: conversation.title })}><Trash2 size={17} /></button>}</div>)}</div> : <p className="privacy-empty">There are no saved conversations to manage.</p>}
        <div className="privacy-inline-note"><HeartHandshake size={15} /><p>Deletion permanently removes the conversation, transcript, linked memories and any remaining temporary audio. Each delete is confirmed before it is sent.</p></div>
      </section>
    </div>

    <p className="privacy-footnote"><AudioLines size={14} />Cloud processing is not end-to-end encrypted. Consent controls govern future access and processing; they cannot remove copies already received by an external provider.</p>

    <dialog ref={dialog} className="confirm-dialog privacy-dialog" aria-labelledby="privacy-confirm-title" onCancel={(event) => { event.preventDefault(); setPending(null); }}>
      <p className="eyebrow">CONFIRM PRIVACY CHANGE</p><h2 id="privacy-confirm-title">{pendingTitle(pending)}</h2><p>{pendingDescription(pending)}</p>
      <div className="dialog-actions"><button className="btn btn-quiet" type="button" disabled={busy} onClick={() => setPending(null)}>Cancel</button><button className={pending?.kind === "delete-conversation" || pending?.kind === "revoke-family" ? "btn btn-danger" : "btn btn-primary"} type="button" disabled={busy} onClick={() => void runPendingAction()}>{busy ? "Saving…" : pending?.kind === "delete-conversation" ? "Delete permanently" : pending?.kind === "revoke-family" ? "Remove access" : pending?.kind === "grant-family" ? "Grant access" : pending?.kind === "export" ? "Prepare export" : "Confirm change"}</button></div>
    </dialog>
  </div>;
}

function pendingTitle(action: PendingAction | null): string {
  if (!action) return "Confirm this change?";
  if (action.kind === "recording") return action.enabled ? "Allow future recordings?" : "Turn recording off?";
  if (action.kind === "external-ai") return action.enabled ? "Allow external AI processing?" : "Stop external AI processing?";
  if (action.kind === "retention") return action.days === null ? "Use manual deletion?" : `Delete conversations after ${action.days} days?`;
  if (action.kind === "grant-family") return "Grant this family member access?";
  if (action.kind === "revoke-family") return `Remove ${action.name}’s access?`;
  if (action.kind === "delete-conversation") return "Delete this conversation permanently?";
  return "Prepare an authorized data export?";
}

function pendingDescription(action: PendingAction | null): string {
  if (!action) return "Review the change before continuing.";
  if (action.kind === "recording") return action.enabled ? "This records your explicit consent for future recordings. Everyone present must still agree each time." : "Active sessions will be stopped. This does not delete conversations already saved.";
  if (action.kind === "external-ai") return action.enabled ? "Conversation audio and other eligible patient information may be sent to configured external AI providers for transcription and optional features." : "Active sessions will stop, old session uploads will be rejected, queued provider processing will stop and temporary audio will be deleted. Transcripts already created will remain.";
  if (action.kind === "retention") return action.days === null ? "Saved conversations will remain until an authorized user deletes them." : `Conversations, transcripts and linked memories older than ${action.days} days will be permanently deleted by the retention process.`;
  if (action.kind === "grant-family") return "The account using this code will be able to read saved conversations, transcripts and memories. You can remove access later.";
  if (action.kind === "revoke-family") return "Their next request for patient information will be denied. Data they already viewed or downloaded cannot be recalled.";
  if (action.kind === "delete-conversation") return `“${action.title}” and its transcript, linked memories and remaining temporary audio will be permanently deleted.`;
  return "A JSON file containing the records this account is authorized to read will be prepared in this browser. No public download link is created.";
}

function eventLabel(operation: string): string {
  const labels: Record<string, string> = {
    "patient.created": "Patient space created",
    "family.code.linked": "Family access granted",
    "family.member.unlinked": "Family access revoked",
    "family.invitation.created": "Family invitation created",
    "family.invitation.accepted": "Family invitation accepted",
    "privacy.recording_consent.granted": "Recording consent enabled",
    "privacy.recording_consent.revoked": "Recording consent disabled",
    "privacy.external_ai_consent.granted": "External AI consent enabled",
    "privacy.external_ai_consent.revoked": "External AI consent disabled",
    "privacy.retention.set_manual": "Automatic deletion disabled",
    "conversation.deleted": "Conversation deleted",
    "conversation.retention_deleted": "Conversation deleted by retention policy",
    "data.export.requested": "Data export requested",
  };
  if (labels[operation]) return labels[operation]!;
  if (operation.startsWith("privacy.retention.set_")) return `Retention changed · ${operation.replace("privacy.retention.set_", "").replaceAll("_", " ")}`;
  if (operation.startsWith("access.")) {
    const resource = operation.slice("access.".length).replace(/\.viewed$/u, "").replaceAll("_", " ");
    return `${resource[0]?.toUpperCase()}${resource.slice(1)} viewed`;
  }
  return operation.replaceAll(".", " ").replaceAll("_", " ");
}
