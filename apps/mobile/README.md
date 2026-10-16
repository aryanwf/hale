# Hale for Android

The Android patient app lives in `apps/mobile`, next to the web dashboard, and uses Hale’s shared contracts, Clerk authentication, Convex patient spaces, and `expo-audio` native capture. Expo SDK 57 provides document-directory recording and a microphone foreground service. The mobile target, build commands, and CI workflow are Android-only; no Mac, Apple account, signing subscription, or Play Store account is needed for local development.

## Windows setup (once)

For a Windows-native toolchain, use **Windows PowerShell**. For WSL2, use the separate Linux setup below; do not mix Linux Gradle with Windows SDK executables. Install:

1. Node.js 22.12 or newer and Bun 1.3.14 or newer.
2. Android Studio, including Android SDK Platform-Tools and the SDK/Build-Tools requested by the generated Gradle project. Accept the SDK licenses in Android Studio. Let Gradle install any additional SDK/NDK versions it requests.
3. JDK 17. Set `JAVA_HOME` to that JDK. Android Studio’s bundled runtime is usable only if compatible with the generated Gradle version.
4. Set `ANDROID_HOME` to your SDK folder (usually `$env:LOCALAPPDATA\Android\Sdk`), and add its `platform-tools` folder to `PATH`. Restart PowerShell after changing environment variables. Check `java -version` and `adb version`.
5. On a **real Android phone**, enable Developer options → USB debugging, connect by USB, approve the computer, and check that `adb devices` lists it as `device` rather than `unauthorized`. Some Windows devices require the manufacturer’s USB driver. Alternatively, start an Android Studio emulator; use a physical phone for background microphone verification.

From the repository root in PowerShell:

```powershell
bun install
Copy-Item apps/mobile/.env.example apps/mobile/.env.local
bun run mobile:android
```

`mobile:android` generates the Android project, builds and installs a debug-signed **development app**, and starts Metro. If more than one device is connected, run `bun run mobile:android -- --device` to choose one. The first native build can take several minutes. The application ID is `health.hale.mobile`.

**Use this development app, not Expo Go.** Expo Go cannot provide this app’s background microphone configuration. Debug signing is automatic and does not expire after seven days. Android Studio and local builds do not require a paid membership.

## WSL2 setup

WSL2 can build, install, and run Metro directly from this checkout. It needs a **Linux** JDK 17 and Linux Android command-line tools, SDK Platform 36, Build-Tools 36.0.0, NDK 27.1.12297006, and CMake. The generated project and Gradle determine the final required versions. Keep the checkout in the Linux filesystem, not under `/mnt/c`, for build performance.

Set `JAVA_HOME` to the Linux JDK and `ANDROID_HOME`/`ANDROID_SDK_ROOT` to the Linux SDK; add its `platform-tools` and command-line tools `bin` folders to `PATH`. This machine’s setup is in `~/.config/hale/android-env.sh`; source it in an already-open WSL shell:

```sh
source ~/.config/hale/android-env.sh
java -version
sdkmanager --version
```

To connect a physical USB phone, install `usbipd-win` on Windows. Plug the phone in with a data-capable cable and enable USB debugging. In **administrator Windows PowerShell**, find the phone’s bus ID and share only that device:

```powershell
usbipd list
usbipd bind --busid <PHONE-BUS-ID>
```

Then attach it to the running WSL distribution (normal PowerShell is sufficient):

```powershell
usbipd attach --wsl --busid <PHONE-BUS-ID>
```

Back in WSL, run `adb devices`, unlock the phone, and approve the RSA debugging prompt. Do not bind a keyboard, webcam, storage disk, or an unidentified USB device. The phone is temporarily unavailable to Windows while attached to WSL; `usbipd detach --busid <PHONE-BUS-ID>` returns it to Windows. Attachment may need repeating after reconnect/reboot.

Once `adb devices` shows the phone as `device`, use the same commands **inside WSL**:

```sh
bun run mobile:android
# Later Metro sessions, after stopping the previous one:
bun run dev:mobile:usb
```

`bun run mobile:apk` can build without a connected phone. Install the resulting APK with `adb install -r apps/mobile/build/android/Hale-development.apk` once the phone is attached. No Windows Android Studio SDK is required for this Linux build path.

### Alternative: Windows ADB, Linux builds and Metro

If USB sharing fails, leave the phone connected to Windows and use Windows Platform-Tools for the USB transport instead. Do not attach the phone with `usbipd` in this mode. Linux Gradle and the Linux SDK still compile the APK; Linux ADB communicates with the Windows ADB server over localhost.

Set `HALE_WINDOWS_ADB` to the WSL path of Windows `adb.exe`. This machine’s `~/.config/hale/android-env.sh` configures the bridge at port 5038, separate from the usual port 5037. `bun run dev:mobile:usb` starts that Windows server automatically, forwards port 8081, and opens Hale. Approve the phone’s USB-debugging authorization prompt for the Windows server. WSL mirrored networking or working Windows localhost forwarding is required.

After reboot, source the environment file and run `bun run dev:mobile:usb` again. Stop any existing Metro session first. For a native Linux USB setup instead, unset `HALE_WINDOWS_ADB` and `ADB_SERVER_SOCKET` and attach the phone to WSL.

## Fast Refresh (everyday development)

After the first installation, stop any previous Metro process and run from the repository root:

```powershell
bun run dev:mobile:usb
```

The USB command forwards device port 8081 to your computer using `adb reverse`, starts Metro on localhost, and opens the installed development app. It works without shared Wi-Fi. Re-run it after reconnecting USB. Connect only one device, or set `$env:ANDROID_SERIAL` to the desired ID from `adb devices`. If needed, open the development launcher and enter `http://127.0.0.1:8081`.

For Wi-Fi instead:

```powershell
bun run dev:mobile
```

Keep the computer and phone on the same network, allow Node.js through Windows Firewall on **private networks only**, and scan the development-client QR code with the phone’s camera/QR scanner or enter the printed server URL in Hale’s launcher. Do not open it in Expo Go. If discovery fails, use USB rather than exposing Metro to the internet.

- Save an edit to `apps/mobile/App.tsx` or a screen: **Fast Refresh** updates the installed app, often preserving UI state. Some edits cause a full reload; state preservation is not guaranteed.
- Shake the device (emulator: Ctrl+M) to open the developer menu and enable Fast Refresh. Press `r` in Metro to force a reload.
- **Stop and save recordings before editing/reloading.** Fast Refresh can remount providers; full reloads, stopping Metro, or disconnecting the debugger can interrupt capture. Recovery is best effort.
- Changes to native packages, plugins, permissions, or `app.json` require `bun run mobile:android` again. Environment changes may require restarting Metro with `bun run dev:mobile -- --clear`.
- Metro must run on the machine containing your current source files. A Windows phone connection cannot use `localhost` to reach a separate Linux/remote development machine; use a reachable LAN address or run the checkout and Metro on Windows.

## Build an installable development APK

With the same SDK/JDK setup, no connected phone is required:

```powershell
bun run mobile:apk
adb install -r apps/mobile/build/android/Hale-development.apk
bun run dev:mobile:usb
```

The APK is debug-signed, includes the native development client and recording service, and targets arm64 phones and x86_64 emulators. **It needs Metro for JavaScript and Fast Refresh; it is not a standalone release.** Installing a differently signed build over an existing app may fail. Do not uninstall or clear app data without first dealing with unsent recordings.

`.github/workflows/android-development.yml` offers the same APK build on a standard **Linux** GitHub runner, with manual dispatch only, a 45-minute job limit, fictional demo mode, and three-day artifact retention. Once the workflow is on the repository’s default branch, use Actions → Build Android development APK → Run workflow. Private repositories consume the owner’s Actions allowance and may incur charges beyond it. No cloud build is automatically started by these local commands.

EAS is optional: `development` produces an APK with a development client, `preview` produces a standalone APK without Fast Refresh, and `production` produces a Play Store app bundle. EAS cloud usage has separate account/quota requirements.

## Demo and live accounts

Demo mode uses labeled fictional dashboard data. Recording still requests microphone permission and participant consent; use only consented test audio. Demo audio is not uploaded.

For live mode, set in `apps/mobile/.env.local`:

- `EXPO_PUBLIC_APP_MODE=live`
- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`: the same publishable key used by the web dashboard (never a Clerk secret key).
- `EXPO_PUBLIC_CONVEX_URL`: the deployment’s `.convex.cloud` URL.
- `EXPO_PUBLIC_CONVEX_SITE_URL`: the deployment’s `.convex.site` HTTP URL.
- `EXPO_PUBLIC_WEB_URL`: the web dashboard’s reachable URL, for voice-profile management.

Enable Clerk’s **Native API** under Dashboard → Native applications. The native sign-in/sign-up UI uses enabled instance factors and supports session tasks; it is a beta SDK surface. Keep the existing `convex` JWT template and deployment issuer configuration. Tokens persist using Clerk’s SecureStore token cache. A physical device cannot reach your computer’s `localhost`; use a reachable web URL. No patient API or AI-provider secret belongs in an `EXPO_PUBLIC_*` variable.

Live mode never substitutes demo data for a connection or authorization failure. Patient creation, account memberships, capability checks, searches, source-bound recall, audio playback, and evidence deletion use the same backend as the web dashboard. Apply the accompanying Convex changes to your chosen development deployment before testing native uploads. Native requests omit `Origin` but must pass bearer authentication, session ownership, membership, and recording consent checks. Arbitrary browser origins remain rejected.

## Patient features

- **Today:** consented recording, today’s memories, recent conversations, recall and care shortcuts.
- **Memories:** patient-timezone day navigation, date selection, conversation/transcript search, linked source records, bounded-result notices.
- **Ask Hale:** source-bound text recall, original transcript citations and audio offsets, scoped-day questions, honest abstention. Questions are not stored as evidence.
- **Care:** the same explicitly disconnected ride/calendar/medication integrations as the web app, with labeled demo quotes and confirmed fictional self-reports. No live booking or dosing advice.
- **Your space:** people, enrollment status, patient switching, voice-profile handoff to the web, retention, privacy, and sign-out.

Geist is used for the UI, Libre Baskerville for editorial headings, and IBM Plex Mono for metadata. Fonts ship with the app. The warm neutral/burgundy palette is centralized in `src/theme.ts`.

## Background microphone capture

Both `enableBackgroundRecording` in the native config plugin and `allowsBackgroundRecording` at runtime are required. The app starts capture only after an explicit tap while foregrounded and participant consent. Native audio capture—not a JavaScript timer—continues while the screen is locked or the app is backgrounded.

- **Android:** Expo’s microphone foreground service and OS recording indicator/stop action. This installed `expo-audio` version requires notification permission on Android 13+ before preparing background capture. Hale requests microphone access first, then notifications; denial blocks recording with a settings explanation rather than silently dropping the foreground service.
- The recorder is above tab navigation, so moving between dashboard screens does not stop capture. Playback is disabled while capturing.
- Native `forDuration` stops each file at one hour, even when JavaScript is suspended. Mono AAC targets 24 kbps/24 kHz; the server additionally rejects files over 20 MB. Web sessions keep their existing two-minute limit.
- Pause finalizes a file and session. Resume starts a fresh segment; pause gaps are not represented as recorded audio.
- Files are written directly into app documents. A small journal records ownership, patient space, session ID, URI, timestamps, and last measured native duration. At most three local files may be queued across accounts/spaces.
- Capture and uploads are separate: review, upload/retry, or discard saved files from Today. Uploads use stable `(sessionId, sequence=0)` idempotency keys. Successful uploads remove local queue entries and files; failures preserve audio. Pending audio is visible only to its owning account and patient space. Sign back into that account/space to clear its queue.
- Calls, route changes, native errors, OS battery policies, force-stop, and termination can interrupt capture. There is no automatic restart. After restart, journal recovery uses the last measured duration; final audio may be incomplete or unplayable. Recovery is best effort, not guaranteed coverage.
- Local files are sandboxed, **not application-encrypted**. Android app backup is disabled. Uninstalling or clearing app data destroys unsent audio. Do not use real patient data in this prototype.

Audio uploads still appear as **queued**: transcription, extraction, speaker matching, and nightly summaries are not connected in the current backend. The mobile app does not invent them.

## Verification

```sh
bun run --cwd apps/mobile typecheck
bun run --cwd apps/mobile test
bun run --cwd apps/mobile check:native
bun run test
```

Before claiming on-device background support is verified, use consented test audio on a **physical Android phone**, leaving Metro connected and making no source edits during each test:

1. Enable microphone access and, on Android 13+, notifications, confirm everyone’s consent, and start from Today.
2. Speak, switch tabs/apps, lock the screen for at least 3 minutes, then return. Verify native duration and recorded audio include the locked-screen speech.
3. Pause, wait, resume, then stop. Confirm separate files, no silently restarted capture, and no pause-gap audio claim.
4. Test an incoming call, route/headphone changes, denied microphone/notification permission, Android notification stop, and battery restrictions. Confirm truthful denial/interruption state.
5. Save offline, restart the app, review retained audio, reconnect, and explicitly upload. Retry after a simulated failed response; verify only one server conversation is created per file.
6. Sign in/out, restart, and switch patient spaces. Confirm session persistence, disabled switching during capture, and account/patient isolation of queued files.
7. Test deletion, consent revocation, expired playback links, empty search results, and source citations.
8. Test the one-hour native stop while locked; verify media duration and accepted upload size.
9. Stop and save audio, edit a screen label, and confirm Fast Refresh updates the phone. Then fully reload/restart and confirm durable queued audio remains available.

Automated controller/backend tests cannot prove OS background execution or microphone hardware behavior. That device matrix remains a release gate.

Expo Doctor also reports the repository’s two root lockfiles and the intentional web/native React version split. Both lockfiles are maintained; Bun remains the root package manager. Clerk imports React DOM even on native, so the mobile workspace installs matching React/React DOM versions. `metro.config.js` pins both to the mobile workspace so web React packages cannot enter the native bundle; `check:native` checks that their versions match. Do not remove this resolver without aligning the two applications’ React versions. Audit transitive dependency advisories before production use; this migration is not a production security certification.
