"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { ArrowRight, AudioLines, Check, Copy, Link2, ShieldCheck, Users } from "lucide-react";
import type { PatientSpace } from "@hale/contracts";
import { api, type PatientPerson } from "@/lib/api";
import { useWorkspace } from "./providers";
import { PageIntro, PrivacyNote } from "./ui";

type PersonRow = PatientPerson & { conversationCount: number };

export function PeopleView() {
  const { space, mode } = useWorkspace();
  const fallbackPeople = space.people.map((person) => ({
    id: person.id,
    name: person.name,
    relationship: person.relationship,
    isPatient: person.relationship === "You · patient",
    enrollment: person.enrollment,
    linked: false,
    isMe: false,
    voiceState: null,
    voiceConsentAt: null,
    conversationCount: space.conversations.filter((conversation) => conversation.people.includes(person.id)).length,
  } satisfies PersonRow));

  if (mode === "demo") return <PeopleContent space={space} mode={mode} people={fallbackPeople} loading={false} />;
  return <LivePeopleView space={space} fallbackPeople={fallbackPeople} />;
}

function LivePeopleView({ space, fallbackPeople }: { space: PatientSpace; fallbackPeople: PersonRow[] }) {
  const people = useQuery(api.patientPeople, { patientId: space.id });
  const rows = people?.map((person) => ({
    ...person,
    conversationCount: space.conversations.filter((conversation) => conversation.people.includes(person.id)).length,
  }));
  return <PeopleContent space={space} mode="live" people={rows ?? fallbackPeople} loading={!people} />;
}

function PeopleContent({ space, mode, people, loading }: { space: PatientSpace; mode: "demo" | "live"; people: PersonRow[]; loading: boolean }) {
  return <>
    <PageIntro eyebrow="YOUR CIRCLE" title={<>The voices <span className="heading-light">you know.</span></>} description="Familiar people, their connection to you, and the conversations you share." />
    {mode === "live" && space.capabilities.includes("sharing:manage") && <InvitationPanel patientId={space.id} patientName={space.name} />}
    {loading && <p className="small muted" role="status">Checking voice and invitation status…</p>}
    <div className="people-grid">{people.map((person) => {
      const initials = person.name.split(" ").map((part) => part[0]).slice(0, 2).join("");
      return <article className="person-card" key={person.id}>
        <span className={`avatar avatar-large avatar-${person.id === space.people[0]?.id ? "green" : "blue"}`}>{initials}</span>
        <h2>{person.name}</h2>
        <p className="muted">{person.relationship}</p>
        <div className="person-enrollment"><AudioLines size={17} /><span>{voiceStatus(person, mode)}</span></div>
        {person.voiceConsentAt && <p className="small muted">Voice matching consented {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(person.voiceConsentAt)}</p>}
        <span className="small muted">{person.conversationCount} linked {person.conversationCount === 1 ? "conversation" : "conversations"}</span>
        {mode === "live" && person.isMe && <>
          <Link className="text-link person-voice-link" href="/signup/voice">{person.voiceState === "enrolled" ? "Manage my voice profile" : "Set up my voice"}<ArrowRight size={15} /></Link>
          <VoiceMatchingControl key={person.voiceConsentAt ? "consented" : "not-consented"} patientId={space.id} consented={Boolean(person.voiceConsentAt)} />
        </>}
        {mode === "live" && space.capabilities.includes("sharing:manage") && !person.isMe && <UnlinkFamilyMember patientId={space.id} personId={person.id} personName={person.name} linked={person.linked} />}
      </article>;
    })}</div>
    <div className="people-explainer">
      <div><Users size={22} /><h3>A person is more than a voice match.</h3><p>Patient approval and account permissions establish who belongs in this space. A voice profile only helps organize recorded speech; it never grants access.</p></div>
      <div><ShieldCheck size={22} /><h3>Consent comes first. Every time.</h3><p>Voice enrollment and permission to match that voice in a particular patient space are separate from consent to record a conversation.</p>{mode === "demo" && <Link className="text-link" href="/signup/voice">Try the voice setup preview<AudioLines size={15} /></Link>}</div>
    </div>
    <div className="bottom-callout"><PrivacyNote>Speaker matching is not connected yet. Uncertain speakers stay unnamed, and a spoken name alone never identifies a voice.</PrivacyNote></div>
  </>;
}

function voiceStatus(person: PersonRow, mode: "demo" | "live") {
  if (mode === "demo") return "Demo enrollment · no real voiceprint";
  if (person.voiceState === "queued" || person.voiceState === "processing") return "Voice sample is processing";
  if (person.voiceState === "failed") return "Voice sample needs another try";
  if (person.voiceState === "revoked") return "Voice profile revoked";
  if (person.isPatient) {
    if (person.voiceState === "enrolled") return person.voiceConsentAt ? "Patient voice enrolled · speaker matching not connected yet" : "Patient voice enrolled · matching not approved for this space";
    return person.voiceConsentAt ? "Patient voice matching approved · voice not enrolled yet" : "Patient voice enrollment available · matching not approved";
  }
  if (!person.linked) return "Not linked to a family account";
  if (!person.voiceConsentAt) return "Account linked · voice matching not approved for this space";
  if (person.voiceState === "enrolled") return "Voice profile enrolled · speaker matching not connected yet";
  return "Voice matching approved · voice not enrolled yet";
}

function VoiceMatchingControl({ patientId, consented }: { patientId: string; consented: boolean }) {
  const saveConsent = useMutation(api.setVoiceMatchingConsent);
  const [enabled, setEnabled] = useState(consented);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const unchanged = enabled === consented;

  return <form className="voice-matching-consent" onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      await saveConsent({ patientId, enabled });
      setMessage(enabled ? "Voice matching consent saved for this patient space." : "Voice matching consent withdrawn for this patient space.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your voice-matching choice could not be saved.");
    } finally { setBusy(false); }
  }}>
    <label className="check-label"><input type="checkbox" checked={enabled} disabled={busy} onChange={(event) => { setEnabled(event.target.checked); setMessage(""); setError(""); }} /><span>Allow my enrolled voice profile to be used to recognize me in this patient’s recorded conversations when matching is available. This is optional and separate from recording consent.</span></label>
    {!unchanged && <button type="submit" className="btn btn-quiet" disabled={busy}>{busy ? "Saving…" : "Save voice choice"}</button>}
    {message && <p className="small" role="status">{message}</p>}
    {error && <p className="small error-text" role="alert">{error}</p>}
  </form>;
}

function UnlinkFamilyMember({ patientId, personId, personName, linked }: { patientId: string; personId: string; personName: string; linked: boolean }) {
  const unlink = useMutation(api.unlinkPatientPerson);
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function confirmRemoval() {
    setBusy(true); setError("");
    try {
      await unlink({ patientId, personId });
      dialog.current?.close();
      setMessage(`${personName} no longer has access to this patient space. Existing transcript labels are unchanged.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Access could not be removed. Try again.");
    } finally { setBusy(false); }
  }

  return <div className="person-access-actions">
    {linked && <button type="button" className="text-link person-remove-link" onClick={() => { setError(""); dialog.current?.showModal(); }}>Remove access</button>}
    {message && <p role="status" className="small">{message}</p>}
    <dialog ref={dialog} className="confirm-dialog" aria-labelledby={`remove-family-title-${personId}`} aria-describedby={`remove-family-copy-${personId}`} onCancel={(event) => event.preventDefault()}>
      <h2 id={`remove-family-title-${personId}`}>Remove {personName}?</h2>
      <p id={`remove-family-copy-${personId}`}>This immediately disables their access to this patient space and withdraws their patient-specific voice-matching consent. Their account-level voice profile is not deleted, and existing conversation labels are unchanged.</p>
      {error && <p role="alert" className="error-text">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => dialog.current?.close()}>Keep access</button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void confirmRemoval()}>{busy ? "Removing…" : "Remove access"}</button>
      </div>
    </dialog>
  </div>;
}

function InvitationPanel({ patientId, patientName }: { patientId: string; patientName: string }) {
  const createInvitation = useMutation(api.createPatientInvitation);
  const revokeInvitation = useMutation(api.revokePatientInvitation);
  const invitations = useQuery(api.patientInvitations, { patientId });
  const [invitation, setInvitation] = useState<{ id: string; link: string; name: string; relationship: string; expiresAt: number }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true); setError(""); setFeedback("");
    try {
      const result = await createInvitation({
        patientId,
        name: String(values.get("name") ?? ""),
        relationship: String(values.get("relationship") ?? ""),
      });
      const url = new URL("/join", window.location.origin);
      url.searchParams.set("token", result.token);
      setInvitation({ id: result.invitationId, link: url.toString(), name: String(values.get("name")), relationship: String(values.get("relationship")), expiresAt: result.expiresAt });
      form.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The invitation could not be created. Try again.");
    } finally { setBusy(false); }
  }

  async function copyLink() {
    if (!invitation) return;
    try {
      await navigator.clipboard.writeText(invitation.link);
      setFeedback("Invite link copied. Share it privately with this person.");
    } catch {
      setFeedback("Copy wasn’t available. Select and copy the invitation link below.");
    }
  }

  async function revoke(id: string) {
    setBusy(true); setError("");
    try {
      await revokeInvitation({ invitationId: id });
      if (invitation?.id === id) setInvitation(undefined);
      setFeedback("Invitation revoked.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The invitation could not be revoked.");
    } finally { setBusy(false); }
  }

  return <section className="people-invitation" aria-labelledby="invite-person-title">
    <div className="people-invitation-copy"><span className="invite-icon"><Link2 size={20} /></span><div><p className="eyebrow">A PRIVATE INVITATION</p><h2 id="invite-person-title">Bring someone into {patientName.split(" ")[0]}’s circle.</h2><p>The person can review memories after accepting. Voice matching is optional and requires their separate consent.</p></div></div>
    <div className="invite-management">
      {invitation ? <div className="invite-created" aria-labelledby="invite-created-title">
        <div className="invite-created-heading"><Check size={18} /><h3 id="invite-created-title">Invitation ready for {invitation.name}</h3></div>
        <p>This one-time link expires {new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(invitation.expiresAt)}. Send it directly to {invitation.name}; anyone holding the link can accept. Copy it now—the link can’t be recovered later.</p>
        <label htmlFor="patient-invite-link">Invitation link</label>
        <div className="invite-link-row"><input id="patient-invite-link" value={invitation.link} readOnly onFocus={(event) => event.currentTarget.select()} /><button type="button" className="btn btn-quiet" onClick={() => void copyLink()}><Copy size={15} />Copy</button></div>
        {feedback && <p className="small" role="status">{feedback}</p>}
        <button type="button" className="text-link invite-revoke" disabled={busy} onClick={() => void revoke(invitation.id)}>Revoke invitation</button>
      </div> : <form className="people-invitation-form" onSubmit={(event) => void submit(event)}>
        <label>Name<input name="name" autoComplete="name" minLength={2} maxLength={100} required placeholder="e.g. Daniel Okafor" /></label>
        <label>Relationship<input name="relationship" minLength={2} maxLength={80} required placeholder="e.g. Son" /></label>
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Creating invite…" : "Create invite link"}<ArrowRight size={16} /></button>
        <p className="small muted">Acceptance grants memory-reading access only. Voice matching and recording consent stay separate.</p>
      </form>}
      {error && <p role="alert" className="error-text invite-feedback">{error}</p>}
      {feedback && !invitation && <p className="small" role="status">{feedback}</p>}
      <section className="invite-history" aria-labelledby="invite-history-title">
        <h3 id="invite-history-title">Recent invitations</h3>
        {invitations === undefined ? <p className="small muted" role="status">Loading invitations…</p>
          : invitations.length === 0 ? <p className="small muted">No invitations yet.</p>
          : <ul>{invitations.map((item) => <li key={item.id}>
            <div><strong>{item.personName}</strong><span>{item.relationship} · {item.status === "pending" ? `Expires ${new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(item.expiresAt)}` : item.status}</span></div>
            {item.status === "pending" && <button type="button" className="text-link invite-revoke" disabled={busy} onClick={() => void revoke(item.id)}>Revoke</button>}
          </li>)}</ul>}
      </section>
    </div>
  </section>;
}
