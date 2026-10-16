#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Building an iPhone IPA requires macOS and Xcode. Use the iOS sideload GitHub workflow."
  exit 1
fi

SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIRECTORY="$(cd "$SCRIPT_DIRECTORY/.." && pwd)"
BUILD_DIRECTORY="$APP_DIRECTORY/build"
OUTPUT_DIRECTORY="$BUILD_DIRECTORY/unsigned"
WORKSPACE="$APP_DIRECTORY/ios/Hale.xcworkspace"

if [[ ! -d "$WORKSPACE" ]]; then
  echo "Generate the iOS project and run pod install before building."
  exit 1
fi

mkdir -p "$OUTPUT_DIRECTORY"

# The Clerk plugin adds a paid-account entitlement that this fictional demo does not use.
python3 - "$APP_DIRECTORY/ios/Hale/Hale.entitlements" <<'PY'
import pathlib
import plistlib
import sys

path = pathlib.Path(sys.argv[1])
with path.open("rb") as source:
    entitlements = plistlib.load(source)
entitlements.pop("com.apple.developer.applesignin", None)
with path.open("wb") as destination:
    plistlib.dump(entitlements, destination)
print("Omitted native Sign in with Apple entitlement from the unsigned sideload demo.")
PY

xcodebuild -version
xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme Hale \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$BUILD_DIRECTORY/DerivedData" \
  ARCHS=arm64 \
  ONLY_ACTIVE_ARCH=NO \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY= \
  DEVELOPMENT_TEAM= \
  build 2>&1 | tee "$BUILD_DIRECTORY/xcodebuild.log"

APP_BUNDLE="$BUILD_DIRECTORY/DerivedData/Build/Products/Release-iphoneos/Hale.app"
if [[ ! -d "$APP_BUNDLE" ]]; then
  echo "Xcode did not produce the expected iPhone app bundle."
  exit 1
fi

python3 - "$APP_BUNDLE" <<'PY'
import pathlib
import plistlib
import sys

app = pathlib.Path(sys.argv[1])
with (app / "Info.plist").open("rb") as source:
    info = plistlib.load(source)

assert "iPhoneOS" in info["CFBundleSupportedPlatforms"], "Not an iPhone device build"
assert "audio" in info.get("UIBackgroundModes", []), "Background audio mode missing"
assert info.get("NSMicrophoneUsageDescription"), "Microphone permission missing"
assert (app / "main.jsbundle").is_file(), "Standalone JavaScript bundle missing"
print(f"Verified device bundle: {info['CFBundleIdentifier']}")
print(f"Minimum iOS version: {info['MinimumOSVersion']}")
PY

lipo -archs "$APP_BUNDLE/Hale"
STAGING_DIRECTORY="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/hale-ipa.XXXXXX")"
mkdir -p "$STAGING_DIRECTORY/Payload"
ditto "$APP_BUNDLE" "$STAGING_DIRECTORY/Payload/Hale.app"
ditto -c -k --keepParent "$STAGING_DIRECTORY/Payload" "$OUTPUT_DIRECTORY/Hale-unsigned.ipa"
shasum -a 256 "$OUTPUT_DIRECTORY/Hale-unsigned.ipa" > "$OUTPUT_DIRECTORY/Hale-unsigned.ipa.sha256"

cat > "$OUTPUT_DIRECTORY/INSTALL.txt" <<'EOF'
Hale — unsigned iPhone demo build

This is a real iPhone device build, not a Simulator build.
Sign and install Hale-unsigned.ipa using your own sideloader and Apple account.
An unsigned IPA cannot be installed by opening it directly on the phone.
No Apple signing credentials or backend secrets are included.
Native Sign in with Apple is omitted from this free-account demo build.

The dashboard uses fictional demo data and opens without an Expo server.
Microphone permission and participant consent are still required to record.
Test with consented, non-sensitive audio only. Demo recordings stay on-device.
Background capture has not been certified on your physical iPhone.

With a free Apple account, signing normally expires after seven days.
Refresh through your sideloader. Enable iOS Developer Mode/trust if prompted.
An upload queued in this demo does not connect to the production backend.
EOF

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  cat >> "$GITHUB_STEP_SUMMARY" <<'EOF'
## Unsigned iPhone IPA built

Download the **Hale-iPhone-unsigned** artifact and extract `Hale-unsigned.ipa`.
Sign/install it with your Windows sideloader and free Apple account.
This standalone build uses fictional demo data; no Expo server is needed.
The unsigned file cannot be installed directly or through TestFlight.
Native background capture still needs physical-device verification.
EOF
fi
