"use client";

import Link from "next/link";
import { SignIn, SignUp, useAuth } from "@clerk/nextjs";
import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { AuthShell } from "./auth-shell";
import { appMode } from "@/lib/app-mode";

const appearance = {
  variables: {
    colorPrimary: "#9B2C2C",
    colorText: "#1A1A1A",
    colorTextSecondary: "#6B625E",
    fontFamily: "inherit",
    borderRadius: "6px",
  },
  elements: {
    rootBox: "clerk-auth-root",
    cardBox: "clerk-auth-box",
    card: "clerk-auth-card",
    header: "clerk-auth-header",
    footer: "clerk-auth-footer",
    formFieldLabel: "clerk-auth-label",
    formFieldInput: "clerk-auth-input",
    formFieldAction: "clerk-auth-action",
    formButtonPrimary: "clerk-auth-submit",
    socialButtonsBlockButton: "clerk-auth-social",
    dividerLine: "clerk-auth-divider-line",
    dividerText: "clerk-auth-divider-text",
    footerActionLink: "clerk-auth-link",
  },
};

function LiveAuth({ signup, patient, redirectUrl }: { signup: boolean; patient: boolean; redirectUrl?: string }) {
  const { isLoaded, isSignedIn } = useAuth();
  const destination = patient ? "/patient/today" : "/signup/voice";
  if (!isLoaded) {
    return <p role="status" className="muted">Opening a secure connection…</p>;
  }

  if (isSignedIn) {
    const nextStep = redirectUrl
      ? "Your invitation is ready to continue."
      : signup
      ? patient
        ? "Next, create your own private patient space."
        : "Next, introduce yourself and choose whether to set up your voice."
      : "Your private memory space is waiting for you.";

    return (
      <div className="auth-signed-in">
        <ShieldCheck size={28} />
        <h2>You’re signed in.</h2>
        <p className="muted">{nextStep}</p>
        <Link className="btn btn-primary" href={redirectUrl ?? (signup ? destination : "/family/overview")}>
          {redirectUrl ? "Continue invitation" : signup ? "Continue setup" : "Open my space"}
          <ArrowRight size={17} />
        </Link>
      </div>
    );
  }

  return signup
    ? <SignUp path={patient ? "/signup/patient" : "/signup"} routing="path" signInUrl={redirectUrl ? `/login?redirect_url=${encodeURIComponent(redirectUrl)}` : "/login"} forceRedirectUrl={redirectUrl ?? destination} appearance={appearance} />
    : <SignIn path="/login" routing="path" signUpUrl={redirectUrl ? `/signup?redirect_url=${encodeURIComponent(redirectUrl)}` : "/signup"} forceRedirectUrl={redirectUrl} fallbackRedirectUrl="/family/overview" appearance={appearance} />;
}

function AuthUnavailable() {
  return <div className="auth-setup-notice" role="status"><LockKeyhole size={24} /><h2>Authentication isn’t configured.</h2><p>Sign-in and account creation require a connected Clerk application and Convex backend. There is no preview login or pretend account.</p><p className="small muted">Configure live mode using the deployment instructions in README.md, then restart the application.</p></div>;
}

function safeInviteRedirect(value?: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return undefined;
  try {
    const url = new URL(value, "https://hale.invalid");
    const tokens = url.searchParams.getAll("token");
    if (url.origin !== "https://hale.invalid" || url.pathname !== "/join" || url.hash || tokens.length !== 1 || !/^[\da-f]{64}$/i.test(tokens[0])) return undefined;
    if ([...url.searchParams.keys()].some((key) => key !== "token")) return undefined;
    return `/join?token=${encodeURIComponent(tokens[0])}`;
  } catch {
    return undefined;
  }
}

export function AuthPage({ signup = false, patient = false, redirectUrl }: { signup?: boolean; patient?: boolean; redirectUrl?: string }) {
  const live = appMode === "live";
  const inviteRedirect = safeInviteRedirect(redirectUrl);
  const introDescription = !signup
    ? "Log in to reconnect with the conversations, people, and little moments that matter."
    : patient
      ? "Create your own memory space. Keep the moments that matter close, and choose who can join your circle."
      : "Create your family account and help keep the moments that matter close.";

  return (
    <AuthShell signup={signup} patient={patient}>
      <div className="auth-intro">
        <p className="eyebrow">{signup ? "A LITTLE CLOSER, EVEN FROM AFAR" : "A FAMILIAR PLACE TO RETURN TO"}</p>
        <h1>
          {signup ? <>Good memories.<br /><span>Better together.</span></> : <>Welcome back.<br /><span>Make yourself at home.</span></>}
        </h1>
        <p>{introDescription}</p>
      </div>
      {signup && (
        <nav className="auth-account-type" aria-label="Who is this account for?">
          <Link href="/signup" aria-current={!patient ? "page" : undefined}>I’m a family member</Link>
          <Link href="/signup/patient" aria-current={patient ? "page" : undefined}>I’m here for myself</Link>
        </nav>
      )}
      {!live && <AuthUnavailable />}
      {live && signup && <LiveAuth signup patient={patient} redirectUrl={inviteRedirect} />}
      {live && !signup && <LoginPanel patient={patient} redirectUrl={inviteRedirect} />}
      <p className="auth-privacy">
        <ShieldCheck size={15} />
        <span>{signup ? "Joining doesn’t grant access to anyone’s memories. Patient-space permission is always required." : "Your memories stay in your circle. Access is always permission-based."}</span>
      </p>
    </AuthShell>
  );
}

function LoginPanel({ patient, redirectUrl }: { patient: boolean; redirectUrl?: string }) {
  return (
    <section className="auth-login-card" aria-label="Secure sign-in">
      <header className="auth-login-card-heading">
        <span className="auth-login-lock" aria-hidden="true"><LockKeyhole size={18} /></span>
        <div>
          <p className="eyebrow">PRIVATE ACCOUNT</p>
          <h2>Sign in securely</h2>
        </div>
      </header>
      <LiveAuth signup={false} patient={patient} redirectUrl={redirectUrl} />
    </section>
  );
}
