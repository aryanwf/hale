"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Check, Copy, Link2, LoaderCircle, RefreshCw, Smartphone } from "lucide-react";
import { api } from "@/lib/api";
import { QRCodeSVG } from "qrcode.react";
import { familyQrPayload } from "@hale/contracts/family-link";

export function FamilyConnection({ embedded = false }: { embedded?: boolean }) {
  const invitation = useQuery(api.familyCode, {});
  const create = useMutation(api.createFamilyCode);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasActiveCode = invitation !== undefined && invitation !== null && !invitation.linked;
  const preparing = invitation === undefined || (invitation === null && !error);
  const actionLabel = busy
    ? hasActiveCode ? "Refreshing…" : "Generating…"
    : preparing ? "Preparing family code…"
    : hasActiveCode ? "Refresh family code" : "Generate family code";
  const Heading = embedded ? "h2" : "h1";

  useEffect(() => {
    if (invitation === null) void create({}).catch(() => setError("We couldn’t create your family code. Please try again."));
  }, [invitation, create]);
  async function generate() {
    setBusy(true); setError(""); setCopied(false);
    try { await create({}); }
    catch { setError("We couldn’t create your family code. Please try again."); }
    finally { setBusy(false); }
  }
  async function copy() {
    if (!invitation) return;
    try { await navigator.clipboard.writeText(invitation.code); setCopied(true); }
    catch { setError("Copy isn’t available. Select the code and copy it manually."); }
  }
  return <section className="family-connection" aria-labelledby="connection-title">
    <header className="family-connection-heading">
      <Heading id="connection-title">Connect your family</Heading>
      <p className="connection-intro">On your loved one’s Android phone, scan the QR code or enter the family code to connect them to this family dashboard.</p>
    </header>

    {hasActiveCode && invitation ? <div className="family-code-panel">
      <div className="family-qr"><QRCodeSVG value={familyQrPayload(invitation.code)} size={184} level="M" marginSize={4} title="Scan this private family QR code using the Hale Android app" /></div>
      <div className="family-code-details">
        <p className="family-code-label">Family code</p>
        <code className="family-code">{invitation.code.match(/.{1,4}/g)?.join("-")}</code>
        <p className="family-code-hint">Scan with Hale on the patient’s Android phone, or enter the code in the app.</p>
        <p className="family-code-expiry">Single use <span aria-hidden="true">·</span> expires {new Date(invitation.expiresAt).toLocaleDateString()}</p>
      </div>
    </div> : invitation?.linked ? <div className="family-code-status" role="status">
      <Check size={19} />
      <div><strong>Your last code was used</strong><p>Generate another code to connect with another patient.</p></div>
    </div> : null}

    <div className="family-code-actions">
      {hasActiveCode && <button className="btn btn-quiet" type="button" onClick={() => void copy()}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "Copied" : "Copy code"}</button>}
      <button className="btn btn-primary" type="button" disabled={busy || preparing} aria-busy={busy} onClick={() => void generate()}>
        {busy ? <LoaderCircle size={16} /> : hasActiveCode ? <RefreshCw size={16} /> : <Link2 size={16} />}
        {actionLabel}
      </button>
    </div>
    {error && <p role="alert" className="error-text family-connection-error">{error}</p>}

    <ol className="connection-steps" aria-label="How to connect">
      <li><span className="connection-step-icon"><Smartphone size={18} /></span><div><strong>Open Hale on Android</strong><p>Your loved one signs in or creates their patient space.</p></div></li>
      <li><span className="connection-step-icon"><Link2 size={18} /></span><div><strong>Scan or enter the code</strong><p>They review and approve sharing in the app.</p></div></li>
      <li><span className="connection-step-icon"><Check size={18} /></span><div><strong>Set up a voice profile, if wanted</strong><p>It can be set up after connecting or skipped for now.</p></div></li>
    </ol>
  </section>;
}
