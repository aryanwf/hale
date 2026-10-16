# Hale mobile

The reference Expo app now lives in `apps/mobile`, next to the web dashboard. The legacy Bloom API, task agent, insecure HTTP configuration, and `expo-av` recorder have been replaced with Hale’s shared contracts, Clerk authentication, Convex patient spaces, and `expo-audio` native capture. Expo SDK 57 provides document-directory recording and a microphone foreground service, with a React Native version that includes the Hermes memory-regression fix.

## Run

From the repository root:

```sh
bun install
cp apps/mobile/.env.example apps/mobile/.env.local
bun run mobile:android
# macOS with Xcode:
bun run mobile:ios
```

Subsequent Metro sessions: `bun run dev:mobile`. **Use a native development build, not Expo Go.** Android requires an Android SDK/JDK and a connected device or emulator; iOS requires macOS/Xcode or an EAS build. Bundle identifiers are `health.hale.mobile`; change them before store submission if your team uses another identifier. EAS profiles are supplied, but no paid cloud build or store deployment is performed automatically.

Demo mode uses labeled fictional dashboard data. Recording still requests microphone permission and participant consent; use only consented test audio. Demo audio is not uploaded.

For live mode, set in `apps/mobile/.env.local`:

- `EXPO_PUBLIC_APP_MODE=live`
- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`: the same publishable key used by the web dashboard (never a Clerk secret key).
- `EXPO_PUBLIC_CONVEX_URL`: the deployment’s `.convex.cloud` URL.
- `EXPO_PUBLIC_CONVEX_SITE_URL`: the deployment’s `.convex.site` HTTP URL.
- `EXPO_PUBLIC_WEB_URL`: the web dashboard’s reachable URL, for voice-profile management.

Enable Clerk’s **Native API** under Dashboard → Native applications. The native sign-in/sign-up UI uses enabled instance factors and supports session tasks; it is a beta SDK surface. Keep the existing `convex` JWT template and deployment issuer configuration. Tokens persist using Clerk’s SecureStore token cache. A physical device cannot reach your computer’s `localhost`; use a reachable web URL. No patient API or AI-provider secret belongs in an `EXPO_PUBLIC_*` variable.

Live mode never substitutes demo data for a connection or authorization failure. Patient creation, account memberships, capability checks, searches, source-bound recall, audio playback, and evidence deletion use the same backend as the web dashboard. Apply the accompanying Convex changes to your chosen development deployment before testing native uploads. Native requests omit `Origin` but must pass bearer authentication, session ownership, membership, and recording consent checks. Arbitrary browser origins remain rejected.

## Windows + iPhone without a paid Apple membership

The `Build unsigned iPhone IPA` GitHub Actions workflow compiles a standalone **demo** app on a standard macOS runner. It requires no Apple signing credentials. Download the workflow artifact, extract `Hale-unsigned.ipa`, then sign/install it using a compatible sideloader on Windows and your own Apple account. Free-account signing normally expires after seven days; refresh through the sideloader. Enable iOS Developer Mode/trust if prompted.

This path produces a real arm64 iPhone app, not a Simulator archive. It bundles its JavaScript, opens without Metro, and retains microphone permission and background audio configuration. The unsigned demo omits the paid-account native Sign in with Apple entitlement from the generated project; normal app configuration is unchanged. Demo data is fictional and recordings stay on-device. Sideloading is not proof that background capture works; complete the physical-device checks below.

The workflow runs automatically only on the `build/ios-sideload` branch, has a 45-minute job limit, and retains artifacts for one day. It can also be manually dispatched once registered on the default branch. Private-repository macOS jobs consume Actions allowance and may incur charges after the free quota. Do not upload signing credentials, patient audio, or `.env` files.

## Patient features

- **Today:** consented recording, today’s memories, recent conversations, recall and care shortcuts.
- **Memories:** patient-timezone day navigation, date selection, conversation/transcript search, linked source records, bounded-result notices.
- **Ask Hale:** source-bound text recall, original transcript citations and audio offsets, scoped-day questions, honest abstention. Questions are not stored as evidence.
- **Care:** the same explicitly disconnected ride/calendar/medication integrations as the web app, with labeled demo quotes and confirmed fictional self-reports. No live booking or dosing advice.
- **Your space:** people, enrollment status, patient switching, voice-profile handoff to the web, retention, privacy, and sign-out.

Geist is used for the UI, Libre Baskerville for editorial headings, and IBM Plex Mono for metadata. Fonts ship with the app. The warm neutral/burgundy palette is centralized in `src/theme.ts`.

## Background microphone capture

Both `enableBackgroundRecording` in the native config plugin and `allowsBackgroundRecording` at runtime are required. The app starts capture only after an explicit tap while foregrounded and participant consent. Native audio capture—not a JavaScript timer—continues while the screen is locked or the app is backgrounded.

- **Android:** Expo’s microphone foreground service and OS recording indicator/stop action. With notification permission denied, the service can appear in the system Task Manager rather than the notification drawer.
- **iOS:** audio background mode, microphone permission, and the system privacy indicator.
- The recorder is above tab navigation, so moving between dashboard screens does not stop capture. Playback is disabled while capturing.
- Native `forDuration` stops each file at one hour, even when JavaScript is suspended. Mono AAC targets 24 kbps/24 kHz; the server additionally rejects files over 20 MB. Web sessions keep their existing two-minute limit.
- Pause finalizes a file and session. Resume starts a fresh segment; pause gaps are not represented as recorded audio.
- Files are written directly into app documents. A small journal records ownership, patient space, session ID, URI, timestamps, and last measured native duration. At most three local files may be queued across accounts/spaces.
- Capture and uploads are separate: review, upload/retry, or discard saved files from Today. Uploads use stable `(sessionId, sequence=0)` idempotency keys. Successful uploads remove local queue entries and files; failures preserve audio. Pending audio is visible only to its owning account and patient space. Sign back into that account/space to clear its queue.
- Calls, route changes, native errors, OS battery policies, force-stop, and termination can interrupt capture. There is no automatic restart. After restart, journal recovery uses the last measured duration; final audio may be incomplete or unplayable. Recovery is best effort, not guaranteed coverage.
- Local files are sandboxed, **not application-encrypted**. Android backup is disabled. iOS device backups may include files. Uninstalling or clearing app data destroys unsent audio. Do not use real patient data in this prototype.

Audio uploads still appear as **queued**: transcription, extraction, speaker matching, and nightly summaries are not connected in the current backend. The mobile app does not invent them.

## Verification

```sh
bun run --cwd apps/mobile typecheck
bun run --cwd apps/mobile test
bun run --cwd apps/mobile check:native
bun run test
```

Before claiming on-device background support is verified, use consented test audio on **both physical platforms**:

1. Enable microphone access, confirm everyone’s consent, and start from Today.
2. Speak, switch tabs/apps, lock the screen for at least 3 minutes, then return. Verify native duration and recorded audio include the locked-screen speech.
3. Pause, wait, resume, then stop. Confirm separate files, no silently restarted capture, and no pause-gap audio claim.
4. Test an incoming call, route/headphone changes, denied microphone permission, Android notification stop, and battery restrictions. Confirm truthful interruption state.
5. Save offline, restart the app, review retained audio, reconnect, and explicitly upload. Retry after a simulated failed response; verify only one server conversation is created per file.
6. Sign in/out, restart, and switch patient spaces. Confirm session persistence, disabled switching during capture, and account/patient isolation of queued files.
7. Test deletion, consent revocation, expired playback links, empty search results, and source citations.
8. Test the one-hour native stop while locked; verify media duration and accepted upload size.

Automated controller/backend tests cannot prove OS background execution or microphone hardware behavior. That device matrix remains a release gate.

Expo Doctor also reports the repository’s two root lockfiles and the intentional web/native React version split. Both lockfiles are maintained; Bun remains the root package manager. `metro.config.js` pins native React resolution to the mobile workspace so web React cannot enter the native bundle. Do not remove this resolver without aligning the two applications’ React versions. Audit transitive dependency advisories before production use; this migration is not a production security certification.
