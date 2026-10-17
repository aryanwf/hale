"use client";

import { AudioLines, MessageSquareText } from "lucide-react";
import { useWorkspace } from "./providers";
import { PageIntro } from "./ui";
import styles from "./people-mockup.module.css";

export function PeopleMockupView() {
  const { space, mode } = useWorkspace();

  return (
    <div className={styles.peopleMockup}>
      <PageIntro
        eyebrow="YOUR CIRCLE"
        title={<>The voices <span className="heading-light">you know.</span></>}
        description="Familiar people, their connection to you, and the conversations you share."
      />

      <section aria-labelledby="circle-heading">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="circle-heading">People</h2>
          </div>
          <span>{space.people.length} {space.people.length === 1 ? "person" : "people"}</span>
        </div>

        <div className={styles.peopleGrid}>
        {space.people.map((person) => {
          const count = space.conversations.filter((conversation) => conversation.people.includes(person.id)).length;

          return (
            <article className={styles.personCard} key={person.id}>
              <div className={styles.personIdentity}>
                <span className={`avatar avatar-large avatar-${person.color} ${styles.personAvatar}`} aria-hidden="true">{person.initials}</span>
                <div>
                  <h3>{person.name}</h3>
                  <p>{person.relationship}</p>
                </div>
              </div>
              <div className={styles.profileDetails}>
                <div className={styles.profileDetail}>
                  <AudioLines size={17} />
                  <span>{mode === "demo" ? "Demo enrollment · no real voiceprint" : person.enrollment === "enrolled" ? "Voice enrolled with consent" : "Voice not enrolled"}</span>
                </div>
                <div className={styles.profileDetail}>
                  <MessageSquareText size={16} />
                  <span><strong>{count}</strong> linked {count === 1 ? "conversation" : "conversations"}</span>
                </div>
              </div>
            </article>
          );
        })}
        </div>
      </section>

    </div>
  );
}
