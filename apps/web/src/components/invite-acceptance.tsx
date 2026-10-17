"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ArrowRight, Link2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { appMode } from "@/lib/app-mode";
import { AuthShell } from "./auth-shell";

export function InviteAcceptance({ token }: { token: string }) {
  if (appMode !== "live") return <AuthShell><div className="auth-intro"><p className="eyebrow">A PRIVATE INVITATION</p><h1>This invite needs<br /><span>a live connection.</span></h1><p>Open it from Hale’s configured live app. Demo mode cannot accept patient invitations.</p></div></AuthShell>;
  return <LiveInviteAcceptance token={token} />;
}

function LiveInviteAcceptance({ token }: { token: string }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();
  const invitation = useQuery(api.previewPatientInvitation, isAuthenticated && token ? { token } : "skip");
  const accept = useMutation(api.acceptPatientInvitation);
  const [voiceConsent, setVoiceConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const returnToInvite = `/join?token=${encodeURIComponent(token)}`;
  if (!token) return <InviteMessage title="This invitation link is incomplete." detail="Ask the person who invited you to send a new link." />;
  if (!isLoaded || (isSignedIn && isLoading)) return <AuthShell><p role="status" className="muted">Opening your invitation…</p></AuthShell>;
  if (!isSignedIn) return <AuthShell>
    <div className="auth-intro"><p className="eyebrow">A PRIVATE INVITATION</p><h1>You’ve been invited<br /><span>to join a circle.</span></h1><p>Sign in or create your Hale account, then reopen this invite link to continue.</p></div>
    <div className="button-group invite-auth-actions"><Link className="btn btn-primary" href={`/login?redirect_url=${encodeURIComponent(returnToInvite)}`}>Sign in<ArrowRight size={16} /></Link><Link className="btn btn-quiet" href={`/signup?redirect_url=${encodeURIComponent(returnToInvite)}`}>Create an account</Link></div>
    <p className="auth-privacy"><ShieldCheck size={15} /><span>Joining begins with an invitation. Your voice profile never grants memory access.</span></p>
  </AuthShell>;
  if (!isAuthenticated) return <InviteMessage title="Your secure connection needs attention." detail="Sign in again or check the Hale connection settings. This invitation has not been accepted." />;
  if (invitation === undefined) return <AuthShell><p role="status" className="muted">Checking this invitation…</p></AuthShell>;
  if (!invitation) return <InviteMessage title="This invitation is no longer available." detail="It may have expired, been revoked, or already been accepted. Ask for a new invitation if you still need access." />;

  return <AuthShell>
    <div className="auth-intro"><span className="invite-large-icon"><Link2 size={23} /></span><p className="eyebrow">A PRIVATE INVITATION</p><h1>Join {invitation.patientName}’s<br /><span>circle of care.</span></h1><p>{invitation.personName}, listed as {invitation.relationship}, invited you to view this patient space.</p></div>
    <div className="invite-access-note"><ShieldCheck size={19} /><p>Accepting gives this account permission to read memories in this patient space. It does not grant recording, deletion, or invitation permissions.</p></div>
    <form className="invite-accept-form" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError("");
      try {
        await accept({ token, useVoiceMatching: voiceConsent });
        router.replace("/family/overview");
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The invitation could not be accepted. Try again.");
      } finally { setBusy(false); }
    }}>
      <label className="check-label invite-voice-consent"><input type="checkbox" checked={voiceConsent} onChange={(event) => setVoiceConsent(event.target.checked)} disabled={busy} /><span>If I enroll my voice, I allow Hale to use that voice profile to recognize me in this patient’s recorded conversations when speaker matching becomes available. This is optional, separate from recording consent, and can be withdrawn. No speaker matching is active yet.</span></label>
      {error && <p role="alert" className="error-text">{error}</p>}
      <button className="btn btn-primary auth-submit" type="submit" disabled={busy}>{busy ? "Joining…" : "Accept invitation"}<ArrowRight size={17} /></button>
      <p className="small muted">This link expires {new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(invitation.expiresAt)}.</p>
    </form>
  </AuthShell>;
}

function InviteMessage({ title, detail }: { title: string; detail: string }) {
  return <AuthShell><div className="auth-intro"><p className="eyebrow">A PRIVATE INVITATION</p><h1>{title}</h1><p>{detail}</p></div><Link href="/family/overview" className="text-link">Go to Hale<ArrowRight size={15} /></Link></AuthShell>;
}
