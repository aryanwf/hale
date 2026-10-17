"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Check, Copy, Link2, Smartphone } from "lucide-react";
import { api } from "@/lib/api";
import { QRCodeSVG } from "qrcode.react";
import { familyQrPayload } from "@hale/contracts/family-link";

export function FamilyConnection() {
  const invitation = useQuery(api.familyCode, {});
  const create = useMutation(api.createFamilyCode);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
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
    <span className="connection-icon"><Link2 size={26} /></span>
    <p className="eyebrow">YOUR FAMILY CONNECTION</p>
    <h2 id="connection-title">Different screens.<br /><span>One shared connection.</span></h2>
    <p>This is your family dashboard. Your loved one uses Hale on Android and chooses to share their memories with you.</p>
    {invitation && !invitation.linked ? <>
      <div className="family-code-box"><span className="eyebrow">SCAN TO CONNECT</span><div className="family-qr"><QRCodeSVG value={familyQrPayload(invitation.code)} size={208} level="M" marginSize={4} title="Scan this private family QR code using the Hale Android app" /></div><p className="small muted">Scan with Hale on the patient’s Android phone, or enter this family code instead.</p><code className="family-code">{invitation.code.match(/.{1,4}/g)?.join("-")}</code><button className="btn btn-quiet" onClick={() => void copy()}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "Copied" : "Copy code"}</button></div>
      <p className="small muted">Single use · expires {new Date(invitation.expiresAt).toLocaleDateString()}. Share only with your loved one. If expired, generate a new code below.</p>
    </> : invitation?.linked ? <p className="notice"><Check size={20} />Your last code was used. Generate another to connect with another patient.</p> : !error && <p role="status">Preparing your private code…</p>}
    <ol className="connection-steps"><li><Smartphone size={20} /><div><strong>Open Hale on the patient’s Android phone</strong><p>They sign up with their own account and create their patient space.</p></div></li><li><Link2 size={20} /><div><strong>Scan the QR code or enter the family code</strong><p>They can connect during signup, or later in More → Connect family, and approve sharing with you.</p></div></li><li><Check size={20} /><div><strong>Stay close, from here</strong><p>This dashboard opens automatically once connected.</p></div></li></ol>
    <p className="small muted">This code doesn’t enable recording or voice identification. The patient controls sharing and can remove your access.</p>
    {error && <p role="alert" className="error-text">{error}</p>}
    <button className="text-link" disabled={busy} onClick={() => void generate()}>{busy ? "Preparing…" : "Generate / refresh family code"}</button>
  </section>;
}
