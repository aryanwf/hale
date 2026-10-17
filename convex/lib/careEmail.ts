import { env } from "../_generated/server";

type CareEmailKind = "urgent" | "appointment_reminder";
export type EmailDeliveryResult = "sent" | "skipped" | "failed";

const EMAIL_MESSAGES: Record<CareEmailKind, { subject: string; text: string }> = {
  urgent: {
    subject: "Hale: a care alert needs review",
    text: "A possible English trigger phrase in a recorded conversation may need prompt review. Sign in to Hale to check the care dashboard. Hale has not verified an emergency or contacted responders.",
  },
  appointment_reminder: {
    subject: "Hale: an appointment reminder",
    text: "You have an appointment reminder in Hale. Sign in to the care dashboard for details.",
  },
};

function careDashboardUrl(): string | undefined {
  const origin = env.APP_ORIGIN;
  if (!origin) return undefined;
  try {
    const url = new URL(origin);
    if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost"))) return undefined;
    return new URL("/family/care", url.origin).toString();
  } catch {
    return undefined;
  }
}

function validFromAddress(value: string): boolean {
  if (!value || value.length > 254 || /[\r\n]/.test(value)) return false;
  const bracketed = value.match(/<([^<>]+)>$/);
  const address = bracketed?.[1] ?? value;
  return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(address);
}

function hasMessageId(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return "id" in value && typeof value.id === "string" && value.id.length > 0 && value.id.length <= 200;
}

/** Sends generic care notifications only; no transcript or patient detail is included. */
export async function sendCareEmail(
  recipients: string[],
  kind: CareEmailKind,
  idempotencyKey: string,
): Promise<EmailDeliveryResult> {
  const apiKey = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM;
  if (!apiKey || !from) return "skipped";
  if (!validFromAddress(from) || recipients.length === 0 || recipients.some((email) => !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email))) {
    return "failed";
  }

  try {
    const message = EMAIL_MESSAGES[kind];
    const dashboardUrl = careDashboardUrl();
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: recipients[0],
        ...(recipients.length > 1 ? { bcc: recipients.slice(1) } : {}),
        subject: message.subject,
        text: `${message.text}${dashboardUrl ? `\n\nOpen Hale: ${dashboardUrl}` : ""}`,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return "failed";
    const result: unknown = await response.json();
    return hasMessageId(result) ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
