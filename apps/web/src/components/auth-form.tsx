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

function LiveAuth({ signup, patient }: { signup: boolean; patient: boolean }) {
  const { isLoaded, isSignedIn } = useAuth();
  const destination = patient ? "/patient/today" : "/signup/voice";
  if (!isLoaded) {
    return <p role="status" className="muted">Opening a secure connection…</p>;
  }

  if (isSignedIn) {
    const nextStep = signup
      ? patient
        ? "Next, create your patient space."
        : "Next, create your family profile. Voice setup is optional."
      : "Open your available patient spaces.";

    return (
      <div className="auth-signed-in">
        <ShieldCheck size={28} />
        <h2>You’re signed in.</h2>
        <p className="muted">{nextStep}</p>
        <Link className="btn btn-primary" href={signup ? destination : "/family/overview"}>
          {signup ? "Continue" : "Open my space"}
          <ArrowRight size={17} />
        </Link>
      </div>
    );
  }

  return signup
    ? <SignUp path={patient ? "/signup/patient" : "/signup"} routing="path" signInUrl="/login" forceRedirectUrl={destination} appearance={appearance} />
    : <SignIn path="/login" routing="path" signUpUrl="/signup" fallbackRedirectUrl="/family/overview" appearance={appearance} />;
}

function AuthUnavailable() {
  return <div className="auth-setup-notice" role="status"><LockKeyhole size={24} /><h2>Authentication isn’t configured.</h2><p>Sign-in and account creation require a connected Clerk application and Convex backend. There is no preview login or pretend account.</p><p className="small muted">Configure live mode using the deployment instructions in README.md, then restart the application.</p></div>;
}

export function AuthPage({ signup = false, patient = false }: { signup?: boolean; patient?: boolean }) {
  const live = appMode === "live";
  const introDescription = !signup
    ? "Sign in to open the patient spaces you’re authorized to see."
    : patient
      ? "Create a patient space for your recordings and memories."
      : "Create a family account. Access to a patient space still requires permission.";

  return (
    <AuthShell signup={signup} patient={patient}>
      <div className="auth-intro">
        <p className="eyebrow">{signup ? "CREATE YOUR ACCOUNT" : "SIGN IN TO HALE"}</p>
        <h1>
          {signup ? patient ? <>Create your<br /><span>patient space.</span></> : <>Create a family<br /><span>account.</span></> : <>Welcome back.<br /><span>Sign in to continue.</span></>}
        </h1>
        <p>{introDescription}</p>
      </div>
      {signup && (
        <nav className="auth-account-type" aria-label="Who is this account for?">
          <Link href="/signup" aria-current={!patient ? "page" : undefined}>Family account</Link>
          <Link href="/signup/patient" aria-current={patient ? "page" : undefined}>Patient account</Link>
        </nav>
      )}
      {!live && <AuthUnavailable />}
      {live && signup && <LiveAuth signup patient={patient} />}
      {live && !signup && <LoginPanel patient={patient} />}
      <p className="auth-privacy">
        <ShieldCheck size={15} />
        <span>{signup ? "Joining doesn’t grant access to anyone’s memories. Patient-space permission is always required." : "Your memories stay in your circle. Access is always permission-based."}</span>
      </p>
    </AuthShell>
  );
}

function LoginPanel({ patient }: { patient: boolean }) {
  return (
    <section className="auth-login-card" aria-label="Secure sign-in">
      <header className="auth-login-card-heading">
        <span className="auth-login-lock" aria-hidden="true"><LockKeyhole size={18} /></span>
        <div>
          <p className="eyebrow">PRIVATE ACCOUNT</p>
          <h2>Sign in securely</h2>
        </div>
      </header>
      <LiveAuth signup={false} patient={patient} />
    </section>
  );
}
