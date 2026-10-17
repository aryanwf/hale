# hale

> /heɪl/ – HAIL

> *n.* – from Old English *hāl*, meaning “whole” or “healthy.”

> *Hale* takes its name from the idea of whole-person health. It is a healthcare memory aid that helps people and families keep care conversations and important details within reach. It supports remembering—not diagnosis or treatment—and does not replace professional care.

> *healthcare, remembered.*

## apps

- `apps/web`: family-only web dashboard
- `apps/mobile`: android Expo patient companion

### Connect a family account to a patient

1. The family member signs up on the web and receives a private QR code and family code.
2. The patient signs in with their own account in the Android app and creates their patient space.
3. During Android signup, choose **Scan family QR code** or enter the family code, then approve sharing. You can also connect later under **More → Connect family**.
4. The family dashboard automatically opens the linked patient’s shared memories and conversations.

Codes are single-use and expire after seven days. Family access is read-only; patients can remove it under **More → Connect family**. Voice setup is optional and does not authorize access. Both apps must use the same Convex deployment and Clerk instance. Old patient web routes redirect to the family dashboard.

QR codes are generated locally in the browser; no pairing secrets go to an external QR service. The Android scanner asks for camera permission only when opened. Manual entry works without camera permission. After adding `expo-camera`, rebuild/install the Android development app with `bun run mobile:android` (or build an APK with `bun run mobile:apk`); a Metro reload alone cannot add the native camera module.

Use `bun install` for this workspace. `bunfig.toml` isolates dependencies so the web and Android apps keep their respective React versions.

Start development with `bun run dev` and validate with `bun run check`. Do not mix `npm install` or `npm ci` with Bun installs. If startup reports missing TypeScript types, an esbuild platform mismatch, or npm `ENOTEMPTY`, stop the dev processes, move the root and app `node_modules` directories aside, then run `bun install --frozen-lockfile`. A forced install alone may leave stale npm packages that shadow Bun’s isolated dependencies. After changing Next.js versions, also move `apps/web/.next` aside to regenerate cached route types.

### Delete an account

In web **Settings → Delete account**, review the signed-in email and type `DELETE`. The Android **Your space → Delete account** button opens the same confirmation screen. It removes Hale profiles, voiceprints, retained samples, consent records, family codes, and memberships; patient-owned spaces and their evidence/audio are deleted too. Other patients’ original conversations remain, with account-linked speaker labels anonymized. The screen then deletes the Clerk account, with reverification if required. If Clerk deletion fails or is cancelled, the screen explains that Hale data is already gone and lets the user retry the sign-in-account deletion.

A one-way identity hash is retained to block old sessions from recreating deleted data. Local-only phone recordings and independent provider records are not removed by the database operation. Very large accounts fail atomically with an assisted-deletion message rather than silently deleting only part of the account. For a development onboarding reset without deleting the Clerk login, an administrator can call the internal `accounts:deleteDataForSubject` function through Convex MCP with an exact Clerk user ID and `confirmation: "DELETE"`; never use fuzzy name matching for the deletion itself.

## todo

- [x] account signup, patient and family flows

### patient dashboard

- [x] patient dashboard
- [x] patient-space onboarding
- [x] patient recording in the Android app
- [x] audio upload
- [x] searchable conversations
- [x] calendar timeline
- [x] source-linked recall
- [x] patient-space access checks
- [ ] audio transcription
- [ ] memory extraction
- [ ] speaker matching
- [ ] nightly summaries
- [x] Expo Android capture implementation
- [x] native background recording configuration and durable upload queue
- [ ] physical-device background capture verification
- [ ] smartwatch and wearable capture

### family dashboard

- [x] family dashboard
- [x] family profile onboarding
- [x] consented voice enrollment
- [x] family code pairing with the patient Android app
