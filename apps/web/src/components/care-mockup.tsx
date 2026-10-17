"use client";

import { useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CarFront,
  Check,
  Clock3,
  Info,
  Leaf,
  Pill,
  ShieldCheck,
} from "lucide-react";
import { useWorkspace } from "./providers";
import styles from "./care-mockup.module.css";

const sections = [
  { id: "rides", label: "Rides", detail: "Transportation", icon: CarFront },
  { id: "appointments", label: "Appointments", detail: "Plan a visit", icon: CalendarDays },
  { id: "medications", label: "Medication records", detail: "Your instructions", icon: Pill },
] as const;

type MedicationReport = "taken" | "skipped" | "unknown";

export function CareMockupView() {
  const { mode, space } = useWorkspace();
  const [tab, setTab] = useState<(typeof sections)[number]["id"]>("rides");
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
          Rides, appointments, and medication instructions you’ve recorded. Always with your say-so.
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

      <section key={tab} className={`${styles.panel} swap-in`} aria-label={sections.find((section) => section.id === tab)?.label}>
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

        {tab === "appointments" && <>
          <SectionHeading
            icon={<CalendarDays size={22} />}
            title="A little room in the calendar."
            description="Connected appointment types, available slots, and receipts."
            status="Not connected"
          />
          <ConnectionState
            title="No appointment calendar is connected."
            description="Cal.com test-calendar booking and the single-use approval gate are not enabled yet. There are no real clinic slots or bookings to show."
          />
          <div className={styles.notice}>
            <ShieldCheck size={18} />
            <p>A test-calendar booking is not a medical appointment. Hale will never claim attendance from a booking receipt.</p>
          </div>
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
