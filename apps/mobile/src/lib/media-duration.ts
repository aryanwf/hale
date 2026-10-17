import { createAudioPlayer } from "expo-audio";
import { MAX_NATIVE_RECORDING_SECONDS } from "@hale/contracts/audio";

/** Finished native recorders can reset their counters; use the saved media's duration. */
export async function measureMediaDuration(uri: string): Promise<number> {
  const player = createAudioPlayer(uri, { updateInterval: 100 });
  try {
    const seconds = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => { subscription.remove(); reject(new Error("Saved recording could not be opened. Try again.")); }, 10_000);
      const subscription = player.addListener("playbackStatusUpdate", (status) => {
        if (status.isLoaded && status.duration > 0) { clearTimeout(timeout); subscription.remove(); resolve(status.duration); }
      });
      if (player.isLoaded && player.duration > 0) { clearTimeout(timeout); subscription.remove(); resolve(player.duration); }
    });
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_NATIVE_RECORDING_SECONDS + 1) throw new Error("Saved recording has an invalid duration.");
    return Math.min(Math.round(seconds * 1000), MAX_NATIVE_RECORDING_SECONDS * 1000);
  } finally { player.remove(); }
}
