import Link from "next/link";
import { ArrowUpRight, Check, Leaf, LockKeyhole } from "lucide-react";
import type { ReactNode } from "react";

export function AuthShell({ children, signup = false, step = 0 }: { children: ReactNode; signup?: boolean; step?: number }) {
  const signupLanding = signup && step === 0;

  return <div className="auth-page">
    <a className="skip-link" href="#auth-main">Skip to content</a>
    <aside className="auth-story" aria-label="About Hale">
      <Link href="/" className="wordmark"><Leaf size={26} strokeWidth={1.7} aria-hidden />hale.</Link>
      <div className="auth-story-body">
        <p className="eyebrow">{signupLanding ? "CREATE A FAMILY ACCOUNT" : "CARE CONVERSATIONS, KEPT CLOSE"}</p>
        <h2>{signupLanding ? <>Stay close to<br />the words and<br /><span>moments that matter.</span></> : <>Keep important<br />conversations<br /><span>within reach.</span></>}</h2>
        <p>{signupLanding ? "Hale helps you revisit recorded conversations and the details your loved one chooses to share. Their permission is always needed before you can access their patient space." : "Hale helps you return to recorded words and the details that matter. Only people with permission can see a patient space."}</p>
      </div>
      <div className="auth-story-footer"><LockKeyhole size={14} /><span>Personal memories. Shared only with permission.</span></div>
    </aside>
    <div className="auth-content">
      <header className="auth-header"><Link className="wordmark auth-mobile-brand" href="/"><Leaf size={22} />hale.</Link><p>{signup ? "Already part of the circle?" : "New to Hale?"} <Link href={signup ? "/login" : "/signup"}>{signup ? "Log in" : "Join us"}<ArrowUpRight size={14} /></Link></p></header>
      <main id="auth-main" className="auth-main">
        {signup && <ol className="auth-steps" aria-label="Signup progress">{["Family account", "Family code", "Connect Android", "Voice profile"].map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined} className={index <= step ? "is-active" : ""}><span>{index < step ? <Check size={12} /> : `0${index + 1}`}</span>{label}</li>)}</ol>}
        {children}
      </main>
    </div>
  </div>;
}
