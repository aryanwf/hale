"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMutation } from "convex/react";
import { ArrowUpRight, Leaf, FlaskConical, Search } from "lucide-react";
import { useWorkspace } from "./providers";
import { PatientSwitcher } from "./patient-switcher";
import { api } from "@/lib/api";

const navigation = [
  ["Overview", "/family/overview"], ["Summaries", "/family/summaries"], ["Calendar", "/family/calendar"],
  ["Conversations", "/family/conversations"], ["Care & Tasks", "/family/care"],
  ["People", "/family/people"], ["Ask Hale", "/family/ask"], ["Connect family", "/family/connect"], ["Settings", "/family/settings"], ["Privacy", "/privacy"],
];

export function FamilyShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { space, mode, patients, selectPatient, account } = useWorkspace();
  return <div className="family-app">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="masthead"><div className="page-wrap"><div className="masthead-top"><div className="masthead-left"><Link className="wordmark" href="/family/overview"><Leaf aria-hidden size={23} strokeWidth={1.8} />hale.</Link><span className="header-divider" /><PatientSwitcher patient={space} patients={patients} onSelect={selectPatient} /></div><div className="masthead-right">
        <Link className="family-search-shortcut" href="/family/conversations#conversation-search" aria-label="Search conversations"><Search size={17} /><span>Search</span></Link>
        <Link href="/patient/today" className="patient-view-link">Recording view<ArrowUpRight size={14} /></Link>{account}
      </div></div>
      <nav className="family-tabs" aria-label="Family navigation">{navigation.map(([label, href]) => <Link key={href} href={href} aria-current={pathname === href || pathname.startsWith(`${href}/`) ? "page" : undefined}>{label}</Link>)}</nav>
    </div></header>
    {mode === "demo" && <div className="demo-banner"><div className="page-wrap"><span><FlaskConical size={14} /><strong>Demo space</strong><span className="demo-banner-description">Fictional people, synthetic memories. Nothing here is a live patient record.</span></span><Link href="/family/settings">About this demo<ArrowUpRight size={13} /></Link></div></div>}
    {mode === "live" && <AccessAudit patientId={space.id} pathname={pathname} />}
    <main id="main" className="page-wrap family-main">{children}</main>
  </div>;
}

function AccessAudit({ patientId, pathname }: { patientId: string; pathname: string }) {
  const recordAccess = useMutation(api.privacy.recordAccess);
  useEffect(() => {
    const parts = pathname.split("/").filter(Boolean);
    const resource = parts[1] === "overview" ? "overview"
      : parts[1] === "conversations" ? (parts.length > 2 ? "conversation" : "conversations")
        : parts[1] === "memories" ? "memories"
          : parts[1] === "care" ? "care"
            : parts[1] === "people" || parts[1] === "connect" ? "family_access"
              : parts[1] === "settings" ? "settings"
                : null;
    if (!resource) return;
    const conversationId = resource === "conversation" ? parts[2] : undefined;
    void recordAccess({ patientId, resource, ...(conversationId ? { conversationId } : {}) }).catch(() => {});
  }, [patientId, pathname, recordAccess]);
  return null;
}
