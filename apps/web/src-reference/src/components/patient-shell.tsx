"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, CalendarDays, House, Leaf, Settings, Share, Sparkles, Users, X } from "lucide-react";
import { useWorkspace } from "./providers";
import { RecorderCard, RecordingProvider, useRecordingController } from "./recorder";

export function PatientShell({ children }: { children: React.ReactNode }) {
  const { space } = useWorkspace();
  return <RecordingProvider key={space.id}><PatientFrame>{children}</PatientFrame></RecordingProvider>;
}

function PatientFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { mode } = useWorkspace();
  const capture = useRecordingController();
  const [showGuide, setShowGuide] = useState(false);
  const [offline, setOffline] = useState(false);
  const [workerError, setWorkerError] = useState(false);
  useEffect(() => {
    const connection = () => setOffline(!navigator.onLine);
    window.addEventListener("online", connection); window.addEventListener("offline", connection);
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/patient/sw.js", { scope: "/patient/", updateViaCache: "none" }).catch(() => setWorkerError(true));
    }
    return () => { window.removeEventListener("online", connection); window.removeEventListener("offline", connection); };
  }, []);
  const navigation = [{ href: "/patient/today", label: "Today", icon: House }, { href: "/patient/ask", label: "Ask", icon: Sparkles }, { href: "/patient/memories", label: "Memories", icon: CalendarDays }];
  return <div className="patient-app"><a className="skip-link" href="#patient-main">Skip to content</a><header className="patient-header"><Link className="wordmark" href="/patient/today"><Leaf size={23} />hale.</Link><div><Link href="/patient/people" className="icon-button" aria-label="People"><Users size={20} /></Link><Link href="/patient/settings" className="icon-button" aria-label="Settings"><Settings size={20} /></Link></div></header>
    {mode === "demo" && <div className="patient-demo-label">DEMO SPACE · FICTIONAL RECORDS ONLY</div>}
    {offline && <div className="info-strip" role="status">You’re offline. Unsent audio is temporary. Search and live answers need a connection.</div>}
    {workerError && <p className="small muted">Offline support is unavailable. Keep Hale open while recording.</p>}
    <div className="persistent-capture">{!pathname.endsWith("/today") && <RecorderCard compact />}</div>
    <main id="patient-main" className="patient-main">{children}</main><footer className="patient-footer"><button className="text-link" onClick={() => setShowGuide(!showGuide)}>Install Hale on your iPhone<ArrowUpRight size={14} /></button>{showGuide && <section className="install-guide"><div><h3>Add Hale to your Home Screen</h3><button className="icon-button" onClick={() => setShowGuide(false)} aria-label="Close install guide"><X size={17} /></button></div><p>In Safari, tap <Share size={15} aria-label="Share" /> Share, then <strong>Add to Home Screen</strong>. Use HTTPS. This does not enable background recording.</p></section>}<p>Hale helps you remember. It is not a medical service. Recordings may be incomplete.</p><Link href="/family/overview" className="small text-link" onClick={(event) => { const snapshot = capture?.getSnapshot(); if (snapshot && (["starting", "recording"].includes(snapshot.phase) || snapshot.segments.length > 0) && !window.confirm("Leaving stops recording and removes unsent audio from this page. Download or upload it first. Leave anyway?")) event.preventDefault(); }}>Family dashboard<ArrowUpRight size={13} /></Link></footer>
    <nav className="patient-bottom-nav" aria-label="Patient navigation">{navigation.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={pathname === href || (href === "/patient/memories" && pathname.includes("/conversations/")) ? "page" : undefined}><Icon size={22} strokeWidth={1.7} /><span>{label}</span></Link>)}</nav>
  </div>;
}
