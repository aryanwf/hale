"use client";

import { useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  CarFront,
  Check,
  Clock3,
  ExternalLink,
  Info,
  Leaf,
  Mail,
  Pill,
  ShieldCheck,
  ShieldAlert,
  Trash2,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Component, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import type { CareAlert, CareContact, CareProposal } from "@hale/contracts/api";
import { api } from "@/lib/api";
import { useWorkspace } from "./providers";
import styles from "./care-mockup.module.css";

const sections = [
  { id: "rides", label: "Rides", detail: "Transportation", icon: CarFront },
  { id: "appointments", label: "Appointments", detail: "Confirmed & AI review", icon: CalendarDays },
  { id: "contacts", label: "Emergency contacts", detail: "People to reach", icon: UsersRound },
  { id: "alerts", label: "Alert history", detail: "Email & web alerts", icon: Bell },
  { id: "medications", label: "Medication records", detail: "Your instructions", icon: Pill },
] as const;

type MedicationReport = "taken" | "skipped" | "unknown";
type SectionId = (typeof sections)[number]["id"];

export function CareMockupView() {
  const { mode, space } = useWorkspace();
  const [tab, setTab] = useState<SectionId>("appointments");
  const [quotes, setQuotes] = useState(false);
  const [handoff, setHandoff] = useState(false);
  const [report, setReport] = useState<MedicationReport>();
  const [pending, setPending] = useState<MedicationReport>();
  const confirmation = useRef<HTMLDialogElement>(null);

  return (
    <div className={styles.careMockup}>
      <header className={styles.intro}>
        <div>
          <p className={styles.eyebrow}><Leaf size={14} /> Support for the everyday</p>
          <h1>A little help, <span>for what’s next.</span></h1>
        </div>
        <p className={styles.introCopy}>
          Rides, recorded medication instructions, confirmed visits, and possible events from conversations. Always with your say-so.
        </p>
      </header>

      <nav className={styles.sectionNav} aria-label="Care sections">
        {sections.map(({ id, label, detail, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            className={styles.sectionButton}
            onClick={() => setTab(id)}
          >
            <span className={styles.sectionIcon}><Icon size={19} /></span>
            <span className={styles.sectionCopy}>
              <span className={styles.sectionLabel}>{label}</span>
              <span className={styles.sectionDetail}>{detail}</span>
            </span>
            <ArrowRight className={styles.sectionArrow} size={17} />
          </button>
        ))}
      </nav>

      <section className={`${styles.panel} swap-in`} aria-label={sections.find((section) => section.id === tab)?.label}>
        {tab === "rides" && <>
          <SectionHeading
            icon={<CarFront size={22} />}
            title="A way to get there."
            description="Review your route. Choose an option. Finish in Uber."
            status="Not connected"
          />
          {mode === "demo" ? <>
            <div className={styles.notice}>
              <Info size={17} />
              <p>These are synthetic quote fixtures, not live fares. No Uber account is linked and no ride can be requested here.</p>
            </div>
            <div className={styles.routeCard}>
              <div className={styles.routeStop}>
                <span className={styles.routeMarker} />
                <span><span className={styles.routeLabel}>Demo pickup</span><strong>Home · fictional address</strong></span>
              </div>
              <span className={styles.routeLine} aria-hidden="true" />
              <div className={styles.routeStop}>
                <span className={`${styles.routeMarker} ${styles.routeMarkerEnd}`} />
                <span><span className={styles.routeLabel}>Demo destination</span><strong>Garden café · fictional location</strong></span>
              </div>
            </div>
            <button className={`btn btn-primary ${styles.previewButton}`} onClick={() => setQuotes(true)}>
              {quotes ? "Showing demo options" : "Preview demo ride options"}<ArrowRight size={16} />
            </button>
            {quotes && <div className={styles.rideOptions}>
              <p className="eyebrow">Synthetic estimates · USD · no live observation time</p>
              {[{ name: "UberX", price: "14.80", eta: "5" }, { name: "Comfort", price: "21.40", eta: "8" }].map((option) => (
                <div className={styles.rideOption} key={option.name}>
                  <span className={styles.rideOptionIcon}><CarFront size={20} /></span>
                  <span className={styles.rideOptionCopy}><strong>{option.name}</strong><span>Example ETA: {option.eta} min · Demo fixture</span></span>
                  <strong className={styles.price}>${option.price}</strong>
                </div>
              ))}
              <p className={`small muted ${styles.rideDisclaimer}`}>The cheapest fixture is UberX. Real availability, price, and accessibility options must be verified in Uber.</p>
              <a className="btn btn-ink" href="https://m.uber.com/" rel="noopener noreferrer" target="_blank" onClick={() => setHandoff(true)}>
                Open Uber to choose a real route<ArrowUpRight size={16} />
              </a>
              {handoff && <p role="status" className={styles.handoff}><Check size={16} />Handoff link selected. No booking or ride is confirmed.</p>}
            </div>}
          </> : <ConnectionState
            title="Your ride connection starts here."
            description="The Uber quote connector is not configured in this build. No quotes or account details have been invented."
          >
            <a className="btn btn-quiet" href="https://m.uber.com/" target="_blank" rel="noopener noreferrer">Open Uber directly<ArrowUpRight size={16} /></a>
          </ConnectionState>}
        </>}

        {tab === "medications" && <>
          <SectionHeading
            icon={<Pill size={22} />}
            title="Your recorded instructions."
            description="Records and self-reports. Not medication advice."
          />
          {mode === "demo" ? <>
            <div className={styles.notice}>
              <Info size={17} />
              <p>This is a fictional schedule example, not a prescription. Do not use it for treatment or dosing decisions.</p>
            </div>
            <article className={styles.medicationCard}>
              <div className={styles.medicationTop}>
                <div><p className="eyebrow">Fictional, unverified source · demo only</p><h3>Example medication A</h3></div>
                <span className={styles.timeBadge}><Clock3 size={15} />08:00 · {space.timezone}</span>
              </div>
              <p className={styles.instruction}>Example recorded instruction: 1 tablet in the morning.</p>
              <div className={styles.medicationReport}>
                <span className={styles.reportDot} />
                <p>{report ? `Demo self-report: ${report === "taken" ? "You reported taking this dose" : report === "skipped" ? "You reported skipping this dose" : "You reported not remembering"}.` : "No self-report recorded. This does not tell us whether a dose was taken."}</p>
              </div>
              <p className={styles.reportPrompt}>Record a fictional self-report:</p>
              <div className={`button-group ${styles.reportButtons}`}>
                {(["taken", "skipped", "unknown"] as const).map((status) => (
                  <button className="btn btn-quiet" key={status} onClick={() => { setPending(status); confirmation.current?.showModal(); }}>
                    {status === "taken" ? "I took it" : status === "skipped" ? "I skipped it" : "I don’t remember"}
                  </button>
                ))}
              </div>
            </article>
            <p className={`small muted ${styles.medicationFootnote}`}>
              This demo keeps the self-report only while this screen is open. Missing or conflicting logs never mean you should take another dose. Ask your pharmacist or clinician about personal medication questions.
            </p>
          </> : <ConnectionState
            title="No medication schedule is recorded."
            description="No medication or dose is inferred from conversations. Verified prescription-source records and server-confirmed self-reports will be added in the care integration milestone."
          />}
        </>}

        {mode === "live" && <CareDataBoundary><LiveCareSections tab={tab} patientId={space.id} timezone={space.timezone} canManageCare={space.capabilities.includes("care:manage")} /></CareDataBoundary>}
        {mode === "demo" && (tab === "appointments" || tab === "contacts" || tab === "alerts") && <DemoCareSection tab={tab} />}
      </section>

      <aside className={styles.privacyNote}>
        <ShieldCheck size={18} />
        <p>Consequential actions need exact, server-verified approval. External bookings are disabled in this first build.</p>
      </aside>

      <dialog className={`confirm-dialog ${styles.confirmDialog}`} ref={confirmation} aria-labelledby="medication-report-title">
        <p className="eyebrow">Demo self-report · no external action</p>
        <h2 id="medication-report-title">{pending === "taken" ? "Record that you took it?" : pending === "skipped" ? "Record that you skipped it?" : "Record that you don’t remember?"}</h2>
        <p>Example medication A · Fictional morning dose. This records your statement, not verified ingestion. It does not change a prescription.</p>
        <div className="dialog-actions">
          <button className="btn btn-quiet" onClick={() => confirmation.current?.close()}>Go back</button>
          <button className="btn btn-primary" onClick={() => { if (mode === "demo" && pending) setReport(pending); confirmation.current?.close(); }}>Confirm demo self-report</button>
        </div>
      </dialog>
    </div>
  );
}

function LiveCareSections({ tab, patientId, timezone, canManageCare }: { tab: SectionId; patientId: string; timezone: string; canManageCare: boolean }) {
  const dashboard = useQuery(api.care.dashboard, { patientId });
  const pushConfig = useQuery(api.care.pushConfig, { patientId });
  const addContact = useMutation(api.care.addContact);
  const removeContact = useMutation(api.care.removeContact);
  const reviewProposal = useMutation(api.care.reviewProposal);
  const acknowledgeAlert = useMutation(api.care.acknowledgeAlert);
  const savePushSubscription = useMutation(api.care.savePushSubscription);
  const removePushSubscription = useMutation(api.care.removePushSubscription);
  const [permission, setPermission] = useState<"checking" | "unsupported" | NotificationPermission>("checking");
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState("");
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushSaving, setPushSaving] = useState(false);
  const knownAlertIds = useRef(new Set<string>());
  const loadedAlertsOnce = useRef(false);
  const backgroundPushEnabled = pushEnabled && Boolean(pushConfig?.subscribed);

  function saveReview(proposalId: string, decision: "confirm" | "dismiss", scheduledAt?: number) {
    const args = { proposalId, decision };
    return scheduledAt === undefined ? reviewProposal(args) : reviewProposal({ ...args, scheduledAt });
  }

  useEffect(() => {
    queueMicrotask(() => {
      if (!("Notification" in window)) {
        setPermission("unsupported");
        return;
      }
      const currentPermission = Notification.permission;
      setPermission(currentPermission);
      if (currentPermission === "granted") setNotificationsEnabled(true);
    });
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let mounted = true;
    void navigator.serviceWorker.getRegistration("/family/")
      .then((registration) => registration?.pushManager.getSubscription())
      .then((subscription) => {
        if (mounted) queueMicrotask(() => setPushEnabled(Boolean(subscription)));
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!dashboard) return;
    if (!loadedAlertsOnce.current) {
      dashboard.alerts.forEach((alert) => knownAlertIds.current.add(alert.id));
      loadedAlertsOnce.current = true;
      return;
    }

    const incoming = dashboard.alerts.filter((alert) => !knownAlertIds.current.has(alert.id));
    incoming.forEach((alert) => knownAlertIds.current.add(alert.id));
    if (notificationsEnabled && permission === "granted" && !backgroundPushEnabled && typeof Notification !== "undefined") {
      incoming.forEach((alert) => {
        try {
          new Notification("Hale care alert", {
            body: "There is a new care update to review in Hale.",
            tag: `hale-care-alert-${alert.id}`,
          });
        } catch {
          setNotificationMessage("This browser could not show the new web notification.");
        }
      });
    }
  }, [dashboard, notificationsEnabled, permission, backgroundPushEnabled]);

  async function enableWebNotifications() {
    if (!("Notification" in window)) {
      setPermission("unsupported");
      setNotificationMessage("This browser does not support web notifications.");
      return;
    }
    try {
      const nextPermission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
      setPermission(nextPermission);
      if (nextPermission !== "granted") {
        setNotificationMessage(nextPermission === "denied" ? "Notifications are blocked in browser settings." : "Notification permission was not granted.");
        return;
      }
      setNotificationsEnabled(true);
      if (!pushConfig?.publicKey) {
        setNotificationMessage("In-page notifications are enabled. Background push is not configured yet.");
        return;
      }
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setNotificationMessage("In-page notifications are enabled, but this browser does not support background push.");
        return;
      }

      setPushSaving(true);
      const registration = await navigator.serviceWorker.register("/family/sw.js", { scope: "/family/" });
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToArrayBuffer(pushConfig.publicKey),
        });
      }
      const serialized = subscription.toJSON();
      if (!serialized.endpoint || !serialized.keys?.p256dh || !serialized.keys.auth) {
        throw new Error("The browser returned an incomplete push subscription.");
      }
      await savePushSubscription({
        patientId,
        endpoint: serialized.endpoint,
        p256dh: serialized.keys.p256dh,
        auth: serialized.keys.auth,
      });
      setPushEnabled(true);
      setNotificationMessage("Background notifications are enabled on this device.");
    } catch {
      setNotificationMessage("In-page alerts are enabled, but background push could not be set up. Check this browser's notification settings and try again.");
    } finally {
      setPushSaving(false);
    }
  }

  async function disableWebNotifications() {
    setPushSaving(true);
    try {
      await removePushSubscription({ patientId });
      setNotificationMessage("Background push is off for this space. In-page alerts remain enabled while this page is open.");
    } catch {
      setNotificationMessage("Web notifications could not be turned off. Try again.");
    } finally {
      setPushSaving(false);
    }
  }

  if (tab === "rides" || tab === "medications") return null;
  if (!dashboard) return <p className={styles.loadingState} role="status">Loading care information…</p>;

  if (tab === "appointments") {
    const confirmedAppointments = dashboard.appointments
      .filter((appointment) => appointment.kind === "appointment" && appointment.status === "confirmed")
      .sort((a, b) => (a.scheduledAt ?? Number.MAX_SAFE_INTEGER) - (b.scheduledAt ?? Number.MAX_SAFE_INTEGER));
    const reviewable = dashboard.proposals.filter((proposal) => proposal.status === "needs_review");
    const urgentProposals = reviewable.filter((proposal) => proposal.priority === "urgent");
    const routineProposals = reviewable.filter((proposal) => proposal.priority !== "urgent");

    return <>
      <SectionHeading
        icon={<CalendarDays size={22} />}
        title="Appointments, with your review."
        description={`Confirming saves a reminder in Hale; it does not book or verify a clinic visit. Times shown in ${timezone}.`}
      />

      <section className={styles.appointmentGroup} aria-labelledby="confirmed-appointments-heading">
        <div className={styles.subsectionHeading}>
          <h3 id="confirmed-appointments-heading">Confirmed in Hale</h3>
          <span>{confirmedAppointments.length}</span>
        </div>
        {confirmedAppointments.length ? <ul className={styles.confirmedList}>
          {confirmedAppointments.map((appointment) => <li className={styles.confirmedItem} key={appointment.id}>
            <div className={styles.confirmedWhen}>
              <strong>{appointment.scheduledAt ? formatCareTimestamp(appointment.scheduledAt, timezone) : "Time not set"}</strong>
              <span>{timezone}</span>
            </div>
            <div className={styles.confirmedCopy}>
              <h4>{appointment.title}</h4>
              <p>{appointment.summary}</p>
              <EvidenceLinks conversationId={appointment.conversationId} turnIds={appointment.turnIds} />
            </div>
              <span className={styles.confirmedStatus}><Check size={14} />Saved in Hale</span>
          </li>)}
        </ul> : <p className={styles.quietEmpty}>No appointments have been confirmed yet.</p>}
      </section>

      <section className={styles.suggestionGroup} aria-labelledby="suggestions-heading">
        <div className={styles.subsectionHeading}>
          <div><h3 id="suggestions-heading">AI suggestions</h3><p>Unverified until you choose to confirm or dismiss.</p></div>
          <span>{reviewable.length} to review</span>
        </div>
        {urgentProposals.length > 0 && <div className={styles.urgentRail} aria-labelledby="urgent-proposals-heading">
          <div className={styles.urgentRailHeading}>
            <span className={styles.urgentIcon}><ShieldAlert size={18} /></span>
            <div><h4 id="urgent-proposals-heading">Urgent · review first</h4><p>These are best-effort alerts for a limited set of English trigger phrases in processed recordings, not verified emergencies. Hale does not monitor continuously or contact responders. If someone may be in immediate danger, call your local emergency number.</p></div>
          </div>
          <div className={styles.urgentProposalList}>
            {urgentProposals.map((proposal) => <ProposalReview key={proposal.id} proposal={proposal} timezone={timezone} canReview={canManageCare} onReview={(decision, scheduledAt) => saveReview(proposal.id, decision, scheduledAt)} />)}
          </div>
        </div>}

        {routineProposals.length > 0 ? <div className={styles.routineProposalList}>
          {routineProposals.map((proposal) => <ProposalReview key={proposal.id} proposal={proposal} timezone={timezone} canReview={canManageCare} onReview={(decision, scheduledAt) => saveReview(proposal.id, decision, scheduledAt)} />)}
        </div> : urgentProposals.length === 0 && <p className={styles.quietEmpty}>No AI event suggestions need review.</p>}
      </section>
    </>;
  }

  if (tab === "contacts") {
    return <LiveContacts canManage={canManageCare} contacts={dashboard.contacts} onAdd={addContact} onRemove={(contactId) => removeContact({ patientId, contactId })} />;
  }

  const urgentAlerts = dashboard.alerts.filter((alert) => alert.priority === "urgent").sort((a, b) => b.createdAt - a.createdAt);
  const routineAlerts = dashboard.alerts.filter((alert) => alert.priority !== "urgent").sort((a, b) => b.createdAt - a.createdAt);
  return <>
    <SectionHeading
      icon={<Bell size={22} />}
      title="Alert history"
      description="Review urgent alerts and appointment reminders for this space."
    />
    <NotificationControls
      permission={permission}
      enabled={notificationsEnabled}
      pushConfigured={pushConfig === undefined ? undefined : Boolean(pushConfig.publicKey)}
      pushEnabled={backgroundPushEnabled}
      busy={pushSaving}
      message={notificationMessage}
      onEnable={enableWebNotifications}
      onDisable={disableWebNotifications}
    />

    {urgentAlerts.length > 0 && <section className={styles.urgentRail} aria-labelledby="urgent-alerts-heading">
      <div className={styles.urgentRailHeading}>
        <span className={styles.urgentIcon}><AlertTriangle size={18} /></span>
        <div><h3 id="urgent-alerts-heading">Urgent alerts</h3><p>These are best-effort alerts for a limited set of English trigger phrases in processed recordings, not verified emergencies. Hale does not monitor continuously or contact responders. If someone may be in immediate danger, call your local emergency number.</p></div>
      </div>
      <div className={styles.alertList}>
        {urgentAlerts.map((alert) => <AlertHistoryItem key={alert.id} alert={alert} timezone={timezone} canAcknowledge={canManageCare} onAcknowledge={() => acknowledgeAlert({ alertId: alert.id })} />)}
      </div>
    </section>}

    <section className={styles.alertGroup} aria-labelledby="routine-alerts-heading">
      <div className={styles.subsectionHeading}>
        <div><h3 id="routine-alerts-heading">Routine reminders</h3><p>Appointment reminders and other routine updates.</p></div>
        <span>{routineAlerts.length}</span>
      </div>
      {routineAlerts.length ? <div className={styles.alertList}>
        {routineAlerts.map((alert) => <AlertHistoryItem key={alert.id} alert={alert} timezone={timezone} canAcknowledge={canManageCare} onAcknowledge={() => acknowledgeAlert({ alertId: alert.id })} />)}
      </div> : urgentAlerts.length === 0 && <p className={styles.quietEmpty}>No alerts or reminders have been recorded.</p>}
    </section>
  </>;
}

function DemoCareSection({ tab }: { tab: Extract<SectionId, "appointments" | "contacts" | "alerts"> }) {
  if (tab === "appointments") {
    return <>
      <SectionHeading icon={<CalendarDays size={22} />} title="Appointments, with your review." description="Confirmed visits and possible events from conversations." status="Live only" />
      <ConnectionState title="Appointment tracking is unavailable in demo mode." description="No appointment records or AI suggestions are fabricated for the demo." />
    </>;
  }
  if (tab === "contacts") {
    return <>
      <SectionHeading icon={<UsersRound size={22} />} title="People to reach." description="Manage the family contacts for urgent alerts." status="Live only" />
      <div className={styles.notice}><Info size={17} /><p>Contact management is unavailable in demo mode. No synthetic contacts are shown, and no reminder or urgent-alert emails are sent.</p></div>
      <ConnectionState title="Emergency contacts are not available here." description="Connect a live family space to add or remove real contacts." />
    </>;
  }
  return <>
    <SectionHeading icon={<Bell size={22} />} title="Alert history." description="Review email and web notification activity." status="Live only" />
    <div className={styles.notice}><Info size={17} /><p>Alert history is unavailable in demo mode. No synthetic alerts are shown; reminder and urgent-alert email delivery are unavailable.</p></div>
    <ConnectionState title="There are no demo alerts." description="Web notifications are not connected to demo data. Nothing is sent in this mode." />
  </>;
}

function LiveContacts({ canManage, contacts, onAdd, onRemove }: {
  canManage: boolean;
  contacts: CareContact[];
  onAdd: (contact: { patientId: string; name: string; email: string }) => Promise<unknown>;
  onRemove: (contactId: string) => Promise<unknown>;
}) {
  const { space } = useWorkspace();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim();
    const cleanEmail = email.trim();
    if (cleanName.length < 2 || !cleanEmail) {
      setFeedback({ kind: "error", message: "Enter a name with at least 2 characters and a valid email address." });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      await onAdd({ patientId: space.id, name: cleanName, email: cleanEmail });
      setName("");
      setEmail("");
      setFeedback({ kind: "success", message: `${cleanName} was added as an emergency contact.` });
    } catch {
      setFeedback({ kind: "error", message: "The contact could not be added. Check the details and try again." });
    } finally {
      setSaving(false);
    }
  }

  async function remove(contact: CareContact) {
    setRemovingId(contact.id);
    setFeedback(null);
    try {
      await onRemove(contact.id);
      setFeedback({ kind: "success", message: `${contact.name} was removed.` });
    } catch {
      setFeedback({ kind: "error", message: `${contact.name} could not be removed. Try again.` });
    } finally {
      setRemovingId(null);
    }
  }

  return <>
    <SectionHeading icon={<UsersRound size={22} />} title="Emergency contacts." description={canManage ? "People who can receive family alerts by email." : "The patient controls which family accounts can manage Care contacts."} />
    {canManage ? <>
      <form className={styles.contactForm} onSubmit={(event) => void submit(event)}>
        <div className={styles.formHeading}><h3>Add an emergency contact</h3><p>Use an address this person agrees to use. Saved contacts receive possible urgent alerts and confirmed-in-Hale appointment reminders by email.</p></div>
        <div className={styles.contactFields}>
          <label className={styles.fieldLabel}>Name
            <input autoComplete="name" maxLength={100} minLength={2} name="contact-name" required value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className={styles.fieldLabel}>Email address
            <input autoComplete="email" maxLength={254} name="contact-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Adding contact…" : "Add contact"}</button>
        </div>
        {feedback && <p className={feedback.kind === "error" ? styles.formError : styles.formSuccess} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.message}</p>}
      </form>

      <section className={styles.contactListSection} aria-labelledby="saved-contacts-heading">
        <div className={styles.subsectionHeading}><div><h3 id="saved-contacts-heading">Saved contacts</h3><p>These are the contacts configured for this family space.</p></div><span>{contacts.length}</span></div>
        {contacts.length ? <ul className={styles.contactList}>
          {contacts.map((contact) => <li className={styles.contactItem} key={contact.id}>
            <span className={styles.contactAvatar} aria-hidden="true">{contact.name.trim().charAt(0).toLocaleUpperCase()}</span>
            <div className={styles.contactCopy}><strong>{contact.name}</strong><span>{contact.email}</span><small>{contact.enabled ? "Email alerts enabled" : "Email alerts unavailable"}</small></div>
            <button className={`btn btn-quiet ${styles.removeButton}`} type="button" disabled={removingId === contact.id} aria-label={removingId === contact.id ? `Removing ${contact.name}` : `Remove ${contact.name}`} onClick={() => void remove(contact)}>
              <Trash2 size={15} />{removingId === contact.id ? "Removing…" : "Remove"}
            </button>
          </li>)}
        </ul> : <p className={styles.quietEmpty}>No emergency contacts have been added yet.</p>}
      </section>
    </> : <div className={styles.notice}><ShieldCheck size={17} /><p>The patient has not enabled Care controls for this account. Contact email addresses are hidden until they approve a family member to manage Care.</p></div>}
  </>;
}

function ProposalReview({ proposal, timezone, canReview, onReview }: {
  proposal: CareProposal;
  timezone: string;
  canReview: boolean;
  onReview: (decision: "confirm" | "dismiss", scheduledAt?: number) => Promise<unknown>;
}) {
  const urgent = proposal.priority === "urgent";
  const [scheduledValue, setScheduledValue] = useState(() => toDateTimeLocal(proposal.scheduledAt ?? proposal.proposedAt, timezone) ?? "");
  const [dateError, setDateError] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  async function review(decision: "confirm" | "dismiss", scheduledAt?: number) {
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      await onReview(decision, scheduledAt);
      setFeedback(decision === "confirm" ? "Confirmed. The tracker is updating." : "Suggestion dismissed.");
    } catch {
      setError("Your decision could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const scheduledAt = proposal.kind === "appointment" ? fromDateTimeLocal(scheduledValue, timezone) : undefined;
    if (proposal.kind === "appointment" && scheduledAt === null) {
      setDateError("That local time does not exist because of a clock change. Choose another time.");
      return;
    }
    setDateError("");
    void review("confirm", scheduledAt ?? undefined);
  }

  return <article className={`${styles.proposal} ${urgent ? styles.urgentProposal : ""}`}>
    <div className={styles.proposalHeader}>
      <div><span className={urgent ? styles.urgentLabel : styles.proposalLabel}>{urgent ? proposal.kind === "urgent" ? "Urgent event · needs your review" : "Urgent appointment · needs your review" : proposal.kind === "urgent" ? "Urgent event · unverified" : "Appointment suggestion · unverified"}</span><h4>{proposal.title}</h4></div>
      <time dateTime={new Date(proposal.createdAt).toISOString()}>{formatCareTimestamp(proposal.createdAt, timezone)}</time>
    </div>
    <p className={styles.proposalSummary}>{proposal.summary}</p>
    <details className={styles.evidenceDetails} open={urgent || undefined}>
      <summary>Original conversation words</summary>
      {proposal.sourceText ? <blockquote>{proposal.sourceText}</blockquote> : <p className={styles.quietEmpty}>No source text was attached to this suggestion.</p>}
      <EvidenceLinks conversationId={proposal.conversationId} turnIds={proposal.turnIds} />
    </details>
    {canReview ? <form className={styles.reviewForm} onSubmit={confirm}>
      {proposal.kind === "appointment" && <div className={styles.dateFieldWrap}>
        <label className={styles.fieldLabel} htmlFor={`schedule-${proposal.id}`}><span>Appointment date and time ({timezone})</span>
          <input id={`schedule-${proposal.id}`} type="datetime-local" required step={60} value={scheduledValue} onChange={(event) => { setScheduledValue(event.target.value); setDateError(""); }} />
        </label>
        <p className={styles.fieldHint}>Choose the local wall-clock time for this space. Hale emails saved contacts 24 hours and 2 hours before; if confirmed less than 2 hours ahead, the reminder is sent promptly.</p>
        {dateError && <p className={styles.formError} role="alert">{dateError}</p>}
      </div>}
      <div className={styles.reviewActions}>
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : proposal.kind === "urgent" ? "Confirm urgent alert" : "Confirm appointment in Hale"}</button>
        <button className="btn btn-quiet" type="button" disabled={busy} onClick={() => void review("dismiss")}>{busy ? "Saving…" : "Dismiss suggestion"}</button>
      </div>
      {feedback && <p className={styles.formSuccess} role="status">{feedback}</p>}
      {error && <p className={styles.formError} role="alert">{error}</p>}
    </form> : <p className={styles.fieldHint}>The patient has not enabled Care controls for this account, so this suggestion is view-only.</p>}
  </article>;
}

function AlertHistoryItem({ alert, timezone, canAcknowledge, onAcknowledge }: { alert: CareAlert; timezone: string; canAcknowledge: boolean; onAcknowledge: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const emailState: Record<CareAlert["emailStatus"], string> = {
    pending: "Email pending",
    sent: "Email sent",
    skipped: "Email skipped",
    failed: "Email delivery failed",
  };
  const pushState: Record<CareAlert["pushStatus"], string> = {
    pending: "Background push pending",
    sent: "Background push sent",
    skipped: "Background push not active",
    failed: "Background push failed",
  };

  async function acknowledge() {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await onAcknowledge();
      setSuccess("Alert acknowledged.");
    } catch {
      setError("This alert could not be acknowledged. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return <article className={styles.alertItem}>
    <div className={styles.alertItemTop}>
      <div><span className={alert.priority === "urgent" ? styles.urgentLabel : styles.proposalLabel}>{alert.priority === "urgent" ? "Urgent alert" : alert.kind === "appointment_reminder" ? "Appointment reminder" : "Care alert"}</span><h4>{alert.title}</h4></div>
      <time dateTime={new Date(alert.createdAt).toISOString()}>{formatCareTimestamp(alert.createdAt, timezone)}</time>
    </div>
    <p className={styles.alertBody}>{alert.body}</p>
    <div className={styles.alertMeta}>
      <span className={styles.emailState}><Mail size={14} />{emailState[alert.emailStatus]}</span>
      <span className={styles.emailState}><Bell size={14} />{pushState[alert.pushStatus]}</span>
      <span className={alert.acknowledged ? styles.acknowledged : styles.unacknowledged}>{alert.acknowledged ? "Acknowledged" : "Awaiting acknowledgement"}</span>
    </div>
    <EvidenceLinks conversationId={alert.conversationId} turnIds={alert.turnIds} />
    {!alert.acknowledged && canAcknowledge && <button className={`btn btn-quiet ${styles.acknowledgeButton}`} type="button" disabled={busy} onClick={() => void acknowledge()}>
      {busy ? "Saving…" : "Acknowledge alert"}
    </button>}
    {!alert.acknowledged && !canAcknowledge && <p className={styles.fieldHint}>Only a patient-approved Care manager can acknowledge this alert.</p>}
    {success && <p className={styles.formSuccess} role="status">{success}</p>}
    {error && <p className={styles.formError} role="alert">{error}</p>}
  </article>;
}

function NotificationControls({ permission, enabled, pushConfigured, pushEnabled, busy, message, onEnable, onDisable }: {
  permission: "checking" | "unsupported" | NotificationPermission;
  enabled: boolean;
  pushConfigured: boolean | undefined;
  pushEnabled: boolean;
  busy: boolean;
  message: string;
  onEnable: () => Promise<void>;
  onDisable: () => Promise<void>;
}) {
  const description = permission === "unsupported"
    ? "This browser does not support web notifications."
    : permission === "denied"
      ? "Notifications are blocked in browser settings."
      : pushConfigured === undefined
        ? "Checking background notification setup."
        : pushEnabled
          ? "Background push can arrive while this site is closed. Notifications contain only generic text."
          : pushConfigured
            ? "Enable background push to receive generic notifications when Hale is closed."
            : "In-page notifications work while this Care & Tasks page is open. Background push is not configured.";

  return <aside className={styles.notificationControls} aria-labelledby="web-notifications-heading">
    <span className={styles.notificationIcon}><Bell size={18} /></span>
    <div className={styles.notificationCopy}>
      <h3 id="web-notifications-heading">Web notifications</h3>
      <p>{description}</p>
      {message && <p className={enabled ? styles.formSuccess : styles.notificationMessage} role="status">{message}</p>}
    </div>
    {pushEnabled
      ? <button className="btn btn-quiet" type="button" disabled={busy} onClick={() => void onDisable()}>{busy ? "Turning off…" : "Turn off for this space"}</button>
      : permission !== "unsupported" && permission !== "denied" && <button className="btn btn-quiet" type="button" disabled={busy || permission === "checking" || pushConfigured === undefined || (enabled && !pushConfigured)} onClick={() => void onEnable()}>
        {busy ? "Enabling…" : permission === "checking" || pushConfigured === undefined ? "Checking…" : permission === "granted" && pushConfigured ? "Enable background push" : enabled ? "On-page notifications enabled" : "Allow web notifications"}
      </button>}
  </aside>;
}

function base64UrlToArrayBuffer(value: string): ArrayBuffer {
  const normalized = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const decoded = window.atob(padded);
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  return bytes.buffer as ArrayBuffer;
}

function EvidenceLinks({ conversationId, turnIds }: { conversationId: string | null; turnIds: string[] }) {
  if (!conversationId) return <p className={styles.noEvidence}>No source conversation is linked to this alert.</p>;
  if (!turnIds.length) return <Link className={styles.evidenceLink} href={`/family/conversations/${conversationId}`}><ExternalLink size={14} />Open source conversation</Link>;
  return <div className={styles.evidenceLinks} aria-label="Conversation source links">
    {turnIds.map((turnId, index) => <Link className={styles.evidenceLink} key={turnId} href={`/family/conversations/${conversationId}#${turnId}`}>
      <ExternalLink size={14} />Source turn {index + 1}
    </Link>)}
  </div>;
}

class CareDataBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <div className={styles.connectionState} role="alert">
      <span className={styles.connectionIcon}><Info size={20} /></span>
      <div><h3>Care information could not be loaded.</h3><p>Check your connection, then try loading this section again.</p><button className="btn btn-quiet" type="button" onClick={() => window.location.reload()}>Try again</button></div>
    </div>;
  }
}

function toDateTimeLocal(timestamp: number | null, timezone: string) {
  if (timestamp === null) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(timestamp));
    const part = (type: string) => parts.find((item) => item.type === type)?.value;
    return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
  } catch {
    return "";
  }
}

function fromDateTimeLocal(value: string, timezone: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const desired = [year, month, day, hour, minute].map(Number);
  const wallClock = Date.UTC(desired[0], desired[1] - 1, desired[2], desired[3], desired[4]);
  const normalized = new Date(wallClock);
  if (normalized.getUTCFullYear() !== desired[0] || normalized.getUTCMonth() !== desired[1] - 1 || normalized.getUTCDate() !== desired[2] || normalized.getUTCHours() !== desired[3] || normalized.getUTCMinutes() !== desired[4]) return null;

  try {
    const offsets = new Set<number>();
    for (const hours of [-36, -12, 0, 12, 36]) {
      const instant = wallClock + hours * 60 * 60 * 1000;
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date(instant));
      const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
      const represented = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"));
      offsets.add(represented - instant);
    }
    const matches = [...offsets]
      .map((offset) => wallClock - offset)
      .filter((instant) => toDateTimeLocal(instant, timezone) === value)
      .sort((a, b) => a - b);
    return matches[0] ?? null;
  } catch {
    return null;
  }
}

function formatCareTimestamp(timestamp: number, timezone: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(timestamp));
  } catch {
    return "Time unavailable";
  }
}

function SectionHeading({ icon, title, description, status }: { icon: React.ReactNode; title: string; description: string; status?: string }) {
  return <header className={styles.panelHeading}>
    <span className={styles.featureIcon}>{icon}</span>
    <span className={styles.headingCopy}><h2>{title}</h2><span>{description}</span></span>
    {status && <span className={styles.status}>{status}</span>}
  </header>;
}

function ConnectionState({ title, description, children }: { title: string; description: string; children?: React.ReactNode }) {
  return <div className={styles.connectionState}>
    <span className={styles.connectionIcon}><Leaf size={22} /></span>
    <div><h3>{title}</h3><p>{description}</p>{children && <div className={styles.connectionAction}>{children}</div>}</div>
  </div>;
}
