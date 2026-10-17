import { Directory, File, Paths } from "expo-file-system";
import type { CaptureStore, LocalRecording } from "./capture";

const directory = new Directory(Paths.document, "hale-capture");

function readManifest(file: File): LocalRecording[] {
  if (!file.exists) return [];
  const value: unknown = JSON.parse(file.textSync());
  if (!Array.isArray(value) || !value.every(isLocalRecording)) throw new Error("Local recording index is unreadable. Do not clear app data; contact support to recover audio.");
  return value;
}

function isLocalRecording(value: unknown): value is LocalRecording {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return ["id", "owner", "patientId", "sessionId", "uri"].every((key) => typeof item[key] === "string")
    && typeof item.capturedAt === "number" && Number.isFinite(item.capturedAt)
    && typeof item.durationMs === "number" && Number.isFinite(item.durationMs)
    && (item.endedAt === undefined || typeof item.endedAt === "number");
}

export function createCaptureStore(): CaptureStore {
  directory.create({ intermediates: true, idempotent: true });
  const manifest = new File(directory, "recordings.json");
  const backup = new File(directory, "recordings.backup.json");
  return {
    load: () => {
      try { return readManifest(manifest); }
      catch (error) { if (!backup.exists) throw error; return readManifest(backup); }
    },
    save: (recordings) => {
      const contents = JSON.stringify(recordings);
      const temporary = new File(directory, "recordings.next.json");
      temporary.write(contents);
      if (manifest.exists) { if (backup.exists) backup.delete(); manifest.copy(backup); }
      temporary.move(manifest, { overwrite: true });
    },
    fileSize: (uri) => { const file = new File(uri); return file.exists ? file.size : 0; },
    removeFile: (uri) => { const file = new File(uri); if (file.exists) file.delete(); },
  };
}
