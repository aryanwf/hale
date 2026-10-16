export const MAX_NATIVE_RECORDING_SECONDS = 60 * 60;
export const MAX_WEB_SEGMENT_SECONDS = 120;
export const MAX_AUDIO_BYTES = 20_000_000;

export function audioDurationLimit(captureMode?: "native" | "web"): number {
  return (captureMode === "native" ? MAX_NATIVE_RECORDING_SECONDS : MAX_WEB_SEGMENT_SECONDS) * 1000;
}
