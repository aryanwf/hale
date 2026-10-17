"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ArrowUpRight, FlaskConical, Leaf, MoreHorizontal, Search, Sparkles, X } from "lucide-react";
import { useWorkspace } from "./providers";
import { PatientSwitcher } from "./patient-switcher";

const navigation = [
  ["Overview", "/family/overview"], ["Calendar", "/family/calendar"],
  ["Conversations", "/family/conversations"], ["Care & Tasks", "/family/care"],
  ["People", "/family/people"], ["Ask Hale", "/family/ask"], ["Settings", "/family/settings"],
];
const mobilePrimary = navigation.slice(0, 3).concat([navigation[5]]);
const mobileSecondary = [navigation[3], navigation[4], navigation[6]];

export function FamilyShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { space, mode, patients, selectPatient, account } = useWorkspace();
  const [moreOpen, setMoreOpen] = useState(false);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  return <div className="family-app">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="masthead"><div className="page-wrap"><div className="masthead-top"><div className="masthead-left"><Link className="wordmark" href="/family/overview"><Leaf aria-hidden size={23} strokeWidth={1.8} />hale.</Link><span className="header-divider" /><PatientSwitcher patient={space} patients={patients} onSelect={selectPatient} /></div><div className="masthead-right"><Link href="/patient/today" className="patient-view-link">Patient view<ArrowUpRight size={14} /></Link><Link href="/family/conversations" className="icon-button" aria-label="Search conversations"><Search size={19} /></Link>{account}</div></div>
      <nav className="family-tabs" aria-label="Family navigation">{navigation.map(([label, href]) => <Link key={href} href={href} aria-current={isActive(href) ? "page" : undefined}>{label}</Link>)}</nav>
    </div></header>
    {mode === "demo" && <div className="demo-banner"><div className="page-wrap"><span><FlaskConical size={14} /><strong>Demo space</strong><span className="demo-banner-description">Fictional people, synthetic memories. Nothing here is a live patient record.</span></span><Link href="/family/settings">About this demo<ArrowUpRight size={13} /></Link></div></div>}
    <main id="main" className="page-wrap family-main">{children}</main>
    <footer className="site-footer"><div className="page-wrap"><span className="footer-brand">hale. <span>your memories, always within reach.</span></span><p>A memory aid, not a medical service.<br />Recordings may be incomplete or inaccurate.</p></div></footer>
    <nav className="family-mobile-nav" aria-label="Family navigation">
      {mobilePrimary.map(([label, href]) => <Link key={href} href={href} onClick={() => setMoreOpen(false)} aria-current={isActive(href) ? "page" : undefined}>{label === "Ask Hale" ? <SparkleMark /> : <span className="family-mobile-nav-mark" aria-hidden>{label.slice(0, 1)}</span>}<span>{label}</span></Link>)}
      <div className="family-mobile-more">
        <button className="family-mobile-more-trigger" type="button" aria-expanded={moreOpen} aria-controls="family-more-links" onClick={() => setMoreOpen((open) => !open)}>{moreOpen ? <X size={19} aria-hidden /> : <MoreHorizontal size={19} aria-hidden />}<span>More</span></button>
        {moreOpen && <div id="family-more-links" className="family-mobile-more-panel"><p className="eyebrow">MORE IN HALE</p>{mobileSecondary.map(([label, href]) => <Link key={href} href={href} onClick={() => setMoreOpen(false)} aria-current={isActive(href) ? "page" : undefined}>{label}<ArrowUpRight size={14} /></Link>)}</div>}
      </div>
    </nav>
  </div>;
}

function SparkleMark() {
  return <span className="family-mobile-nav-mark family-mobile-nav-spark" aria-hidden><Sparkles size={17} /></span>;
}
