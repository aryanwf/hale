"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useReverification, useUser } from "@clerk/nextjs";
import { isReverificationCancelledError } from "@clerk/nextjs/errors";
import { useConvexAuth, useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { AlertTriangle, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { appMode } from "@/lib/app-mode";
import { Gate } from "./providers";

function LiveDeleteAccount() {
  const { isLoaded, isSignedIn, user } = useUser();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const deleteData = useMutation(api.deleteMyAccount);
  const deleteLogin = useReverification(async () => {
    if (!user) throw new Error("Please sign in again.");
    return user.delete();
  });
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [dataDeleted, setDataDeleted] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || (!dataDeleted && confirmation !== "DELETE")) return;
    setBusy(true); setError("");
    let haleDeleted = dataDeleted;
    try {
      if (!haleDeleted) {
        await deleteData({ confirmation: "DELETE" });
        haleDeleted = true;
        setDataDeleted(true);
      }
      await deleteLogin();
      window.location.replace("/signup");
    } catch (error) {
      if (haleDeleted) setError(isReverificationCancelledError(error)
        ? "Verification was cancelled. Your Hale data is deleted, but your sign-in account still exists. Retry below to finish deleting it."
        : "Your Hale data is deleted, but the sign-in account could not be deleted. Retry below. If account deletion is disabled in Clerk, contact support to finish.");
      else setError(error instanceof ConvexError ? String(error.data) : "We couldn’t delete your Hale data. Your sign-in account has not been deleted. Please try again.");
      setBusy(false);
    }
  }

  if (!isLoaded || (isSignedIn && isLoading)) return <Gate title="Opening account settings…" />;
  if (!isSignedIn) return <Gate title="Sign in to delete your account." description="Only you can delete your own account."><Link className="btn btn-primary" href="/login">Sign in</Link></Gate>;
  if (!isAuthenticated) return <Gate title="Your secure connection needs attention." description="Reconnect before deleting your account. Nothing has been deleted."><Link className="btn btn-quiet" href="/login">Back to sign in</Link></Gate>;
  return <Gate title="Delete your account." description="This permanently deletes your Hale account data and then your Clerk sign-in account. This cannot be undone.">
    <section className="settings-card account-danger">
      <div className="icon-label"><AlertTriangle size={22} /><h2>Before you continue</h2></div>
      <p><strong>Account: {user.primaryEmailAddress?.emailAddress ?? user.fullName ?? user.id}</strong></p>
      <ul className="deletion-details"><li>Your family profile, voiceprint, family codes, consents, and access links will be removed.</li><li>If you own a patient space, its recordings, audio, transcripts, memories, and family access will also be deleted.</li><li>Other patients’ recordings are not deleted when a family member leaves. Account-linked speaker labels are anonymized; words already recorded in their transcripts may remain.</li><li>Files stored only on your phone and independent provider records are not erased by this action. Discard local recordings separately. Temporary generated speech expires on its existing retention schedule.</li><li>A one-way login hash is retained to stop old sessions from recreating your deleted account data.</li></ul>
      <form className="onboarding-form" onSubmit={(event) => void submit(event)}>
        {dataDeleted ? <p role="status">Your Hale data has been removed. Finish deleting your sign-in account below.</p> : <label>Type DELETE to confirm<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" spellCheck={false} disabled={busy} required pattern="DELETE" /></label>}
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="btn btn-primary" disabled={busy || (!dataDeleted && confirmation !== "DELETE")}><Trash2 size={17} />{busy ? "Deleting account…" : dataDeleted ? "Finish deleting sign-in account" : "Delete account permanently"}</button>
        {!busy && !dataDeleted && <Link className="text-link" href="/family/settings">Cancel and keep my account</Link>}
      </form>
    </section>
  </Gate>;
}

export function DeleteAccount() {
  return appMode === "live" ? <LiveDeleteAccount /> : <Gate title="No real account in demo mode." description="Demo data is fictional. Account deletion is only available after signing in to live mode."><Link className="btn btn-quiet" href="/family/settings">Back to settings</Link></Gate>;
}
