"use client";

import { AudioLines, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { useWorkspace } from "./providers";
import { PageIntro, PrivacyNote } from "./ui";

export function PeopleView() {
  const { space, mode } = useWorkspace();
  return <><PageIntro eyebrow="PATIENT-SPACE PROFILES" title="People" description="Review profiles linked to available conversations." /><div className="people-grid">{space.people.map((person) => {
    const count = space.conversations.filter((conversation) => conversation.people.includes(person.id)).length;
    return <article className="person-card" key={person.id}><span className={`avatar avatar-large avatar-${person.color}`}>{person.initials}</span><h2>{person.name}</h2><p className="muted">{person.relationship}</p><div className="person-enrollment"><AudioLines size={17} /><span>{mode === "demo" ? "Demo enrollment · no real voiceprint" : person.enrollment === "enrolled" ? "Voice enrolled with consent" : "Voice not enrolled"}</span></div><span className="small muted">{count} linked {count === 1 ? "conversation" : "conversations"}</span></article>;
  })}</div><div className="people-explainer"><div><Users size={22} /><h3>Profiles do not grant access</h3><p>A person profile does not create an account, give family access, record consent, or prove someone was physically present.</p></div><div><ShieldCheck size={22} /><h3>Voice enrollment & matching</h3><p>{mode === "demo" ? "Demo voice samples stay local and do not create a voiceprint." : "Voice enrollment is required after family connection. Speaker matching is separate and still needs the patient’s approval and each person’s consent."}</p><Link className="text-link" href="/signup/voice">{mode === "demo" ? "Preview voice setup" : "Manage voice profile"}<AudioLines size={15} /></Link></div></div><div className="bottom-callout"><PrivacyNote>Uncertain speakers stay unnamed. A name mentioned in a recording does not identify a voice.</PrivacyNote></div></>;
}
