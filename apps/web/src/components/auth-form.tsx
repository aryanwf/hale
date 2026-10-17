"use client";

import Link from "next/link";
import { SignIn, SignUp, useAuth } from "@clerk/nextjs";
import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { AuthShell } from "./auth-shell";
import { appMode } from "@/lib/app-mode";

const appearance = {
  cssLayerName: "clerk",
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

function LiveAuth({ signup }: { signup: boolean }) {
  const { isLoaded, isSignedIn } = useAuth();
  const destination = "/family/overview";
  if (!isLoaded) {
    return <p role="status" className="muted">Opening a secure connection…</p>;
  }

  if (isSignedIn) {
    const nextStep = signup
      ? "Next, share your family code. After your loved one connects, you can optionally set up voice enrollment."
      : "Your family dashboard is waiting for you.";

    return (
      <div className="auth-signed-in">
        <ShieldCheck size={28} />
        <h2>You’re signed in.</h2>
        <p className="muted">{nextStep}</p>
        <Link className="btn btn-primary" href={destination}>
          {signup ? "Continue setup" : "Open my space"}
          <ArrowRight size={17} />
        </Link>
      </div>
    );
  }

  return signup
    ? <SignUp path="/signup" routing="path" signInUrl="/login" forceRedirectUrl={destination} appearance={appearance} />
    : <SignIn path="/login" routing="path" signUpUrl="/signup" fallbackRedirectUrl="/family/overview" appearance={appearance} />;
}

function AuthUnavailable() {
  return <div className="auth-setup-notice" role="status"><LockKeyhole size={24} /><h2>Authentication isn’t configured.</h2><p>Sign-in and account creation require a connected Clerk application and Convex backend. There is no preview login or pretend account.</p><p className="small muted">Configure live mode using the deployment instructions in README.md, then restart the application.</p></div>;
}

export function AuthPage({ signup = false }: { signup?: boolean }) {
  const live = appMode === "live";

  return (
    <AuthShell signup={signup}>
      <div className="auth-intro">
        <p className="eyebrow">{signup ? "CREATE YOUR ACCOUNT" : "SIGN IN TO HALE"}</p>
        <h1>
          {signup ? <>Create a family<br /><span>account.</span></> : <>Welcome back.<br /><span>Sign in to continue.</span></>}
        </h1>
      </div>
      {signup && <p className="auth-account-type">For family members · patients use the Hale Android app</p>}
      {!live && <AuthUnavailable />}
      {live && signup && <LiveAuth signup />}
      {live && !signup && <LoginPanel />}
    </AuthShell>
  );
}

function LoginPanel() {
  return (
    <section className="auth-login-card" aria-label="Secure sign-in">
      <header className="auth-login-card-heading">
        <span className="auth-login-lock" aria-hidden="true"><LockKeyhole size={18} /></span>
        <div>
          <p className="eyebrow">PRIVATE ACCOUNT</p>
          <h2>Sign in securely</h2>
        </div>
      </header>
      <LiveAuth signup={false} />
    </section>
  );
}
