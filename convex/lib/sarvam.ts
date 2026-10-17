import {
  isSarvamLanguageCode,
  supportsSarvamTextToSpeech,
  type SarvamLanguageCode,
} from "@hale/contracts/languages";

const API_ORIGIN = "https://api.sarvam.ai";
const STT_MODEL = "saaras:v4";
const CHAT_MODEL = "sarvam-105b-conversations";
const TTS_MODEL = "bulbul:v3";
const TTS_MAX_CHARACTERS = 2_500;
const TRANSLATE_MAX_CHARACTERS = 2_000;
const STT_MAX_KEYTERMS = 50;
export const SARVAM_REALTIME_STT_MAX_SECONDS = 30;
export const SARVAM_BATCH_STT_MAX_SECONDS = 2 * 60 * 60;
const SARVAM_BATCH_FILE = "conversation.m4a";

export type SarvamTranscript = {
  transcript: string;
  languageCode: string | null;
  languageProbability: number | null;
  requestId: string | null;
  timestamps?: {
    segments: string[];
    startTimeSeconds: number[];
    endTimeSeconds: number[];
  };
};

export type SarvamChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export class SarvamApiError extends Error {
  readonly status?: number;

  constructor(operation: string, status?: number) {
    super(status ? `Sarvam ${operation} failed (HTTP ${status}).` : `Sarvam ${operation} returned an invalid response.`);
    this.name = "SarvamApiError";
    this.status = status;
  }
}

export type SarvamBatchPollResult =
  | { state: "pending" }
  | { state: "failed" }
  | { state: "completed"; transcript: SarvamTranscript };

function apiKey(): string {
  const key = process.env.SARVAM_API_KEY;
  if (!key) throw new Error("Sarvam AI is not configured.");
  return key;
}

async function jsonRequest<T>(operation: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    method: "POST",
    headers: { "api-subscription-key": apiKey(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new SarvamApiError(operation, response.status);
  try {
    return await response.json() as T;
  } catch {
    throw new SarvamApiError(operation);
  }
}

function validLanguageCode(code: string): code is SarvamLanguageCode {
  return isSarvamLanguageCode(code);
}

export async function transcribeAudio(
  audio: Blob,
  options: {
    durationSeconds: number;
    filename?: string;
    languageCode?: SarvamLanguageCode;
    mode?: "transcribe" | "translate" | "verbatim" | "translit" | "codemix";
    keyterms?: string[];
    withTimestamps?: boolean;
  },
): Promise<SarvamTranscript> {
  if (!(audio instanceof Blob) || audio.size === 0) throw new Error("Audio is required for transcription.");
  if (!Number.isFinite(options.durationSeconds) || options.durationSeconds <= 0 || options.durationSeconds > SARVAM_REALTIME_STT_MAX_SECONDS) {
    throw new Error("Sarvam real-time transcription accepts clips up to 30 seconds; use the batch API for longer recordings.");
  }
  if (options.languageCode && !validLanguageCode(options.languageCode)) throw new Error("Unsupported Sarvam transcription language.");
  if (options.keyterms && (options.keyterms.length > STT_MAX_KEYTERMS || options.keyterms.some((term) => !term.trim() || term.length > 64))) {
    throw new Error("Sarvam accepts up to 50 keyterms, each no longer than 64 characters.");
  }

  const form = new FormData();
  const mimeType = audio.type.split(";")[0]?.trim().toLowerCase();
  const extension = mimeType === "audio/wav" || mimeType === "audio/x-wav" ? "wav"
    : mimeType === "audio/mpeg" ? "mp3"
      : mimeType === "audio/mp4" || mimeType === "video/mp4" || mimeType === "audio/aac" ? "m4a"
        : mimeType === "audio/ogg" ? "ogg"
          : audio.type === "audio/flac" ? "flac"
            : "webm";
  form.set("file", audio, options.filename ?? `recording.${extension}`);
  form.set("model", STT_MODEL);
  form.set("mode", options.mode ?? "transcribe");
  form.set("with_timestamps", String(options.withTimestamps ?? true));
  if (options.languageCode) form.set("language_code", options.languageCode);
  if (options.keyterms?.length) form.set("keyterms", JSON.stringify(options.keyterms));

  const response = await fetch(`${API_ORIGIN}/speech-to-text`, {
    method: "POST",
    headers: { "api-subscription-key": apiKey() },
    body: form,
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new SarvamApiError("speech-to-text", response.status);

  try {
    const result = await response.json() as {
      transcript: unknown;
      language_code?: unknown;
      language_probability?: unknown;
      request_id?: unknown;
      timestamps?: { words?: unknown; start_time_seconds?: unknown; end_time_seconds?: unknown } | null;
    };
    if (typeof result.transcript !== "string") throw new Error("Invalid transcript.");
    const timestamps = result.timestamps;
    const validTimestamps = timestamps
      && Array.isArray(timestamps.words)
      && timestamps.words.every((word) => typeof word === "string")
      && Array.isArray(timestamps.start_time_seconds)
      && timestamps.start_time_seconds.every((time) => typeof time === "number" && Number.isFinite(time))
      && Array.isArray(timestamps.end_time_seconds)
      && timestamps.end_time_seconds.every((time) => typeof time === "number" && Number.isFinite(time))
      && timestamps.words.length === timestamps.start_time_seconds.length
      && timestamps.words.length === timestamps.end_time_seconds.length;
    return {
      transcript: result.transcript,
      languageCode: typeof result.language_code === "string" ? result.language_code : null,
      languageProbability: typeof result.language_probability === "number" ? result.language_probability : null,
      requestId: typeof result.request_id === "string" ? result.request_id : null,
      ...(validTimestamps
        ? { timestamps: { segments: timestamps.words as string[], startTimeSeconds: timestamps.start_time_seconds as number[], endTimeSeconds: timestamps.end_time_seconds as number[] } }
        : {}),
    };
  } catch (error) {
    if (error instanceof SarvamApiError) throw error;
    throw new SarvamApiError("speech-to-text");
  }
}

/** Start Sarvam's asynchronous batch API for clips longer than the REST limit. */
export async function startBatchTranscription(audio: Blob): Promise<string> {
  if (!(audio instanceof Blob) || audio.size === 0) throw new Error("Audio is required for transcription.");
  const mimeType = audio.type.split(";")[0]?.trim().toLowerCase() || "audio/mp4";
  const filename = batchFilename(mimeType);
  const initialized = await batchJson("batch job creation", "/speech-to-text/job/v1", "POST", {
    job_parameters: { model: STT_MODEL, mode: "transcribe", with_timestamps: true },
  });
  const jobId = stringField(initialized, "job_id");
  if (!jobId) throw new SarvamApiError("batch job creation");

  const uploadLinks = await batchJson("batch upload link", "/speech-to-text/job/v1/upload-files", "POST", {
    job_id: jobId,
    files: [filename],
  });
  const urls = objectField(uploadLinks, "upload_urls");
  const fileDetails = objectField(urls, filename);
  const uploadUrl = stringField(fileDetails, "file_url");
  if (!uploadUrl || !safeProviderUrl(uploadUrl)) throw new SarvamApiError("batch upload link");

  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": mimeType },
    body: audio,
    signal: AbortSignal.timeout(60_000),
  });
  if (!uploadResponse.ok) throw new SarvamApiError("batch audio upload", uploadResponse.status);

  const started = await batchJson("batch job start", `/speech-to-text/job/v1/${encodeURIComponent(jobId)}/start`, "POST");
  if (stringField(started, "job_id") !== jobId) throw new SarvamApiError("batch job start");
  return jobId;
}

/** Check a batch transcription and download the result only after completion. */
export async function pollBatchTranscription(jobId: string): Promise<SarvamBatchPollResult> {
  if (!jobId || jobId.length > 200) throw new SarvamApiError("batch job status");
  const status = await batchJson("batch job status", `/speech-to-text/job/v1/${encodeURIComponent(jobId)}/status`, "GET");
  if (stringField(status, "job_id") !== jobId) throw new SarvamApiError("batch job status");
  const jobState = stringField(status, "job_state")?.toLowerCase();
  if (jobState === "failed") return { state: "failed" };
  if (jobState !== "completed" && jobState !== "partiallycompleted") return { state: "pending" };

  const details = status.job_details;
  if (!Array.isArray(details) || details.length > 20) throw new SarvamApiError("batch job status");
  let outputFilename: string | undefined;
  for (const detail of details) {
    const entry = asRecord(detail);
    const outputs = entry?.outputs;
    if (entry?.state === "Success" && Array.isArray(outputs) && outputs.length) {
      outputFilename = stringField(asRecord(outputs[0]), "file_name");
      if (outputFilename) break;
    }
  }
  if (!outputFilename) return { state: "failed" };

  const downloadLinks = await batchJson("batch result link", "/speech-to-text/job/v1/download-files", "POST", {
    job_id: jobId,
    files: [outputFilename],
  });
  const downloads = objectField(downloadLinks, "download_urls");
  const outputDetails = objectField(downloads, outputFilename);
  const downloadUrl = stringField(outputDetails, "file_url");
  if (!downloadUrl || !safeProviderUrl(downloadUrl)) throw new SarvamApiError("batch result link");
  const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new SarvamApiError("batch result download", response.status);
  const text = await response.text();
  if (text.length > 1_000_000) throw new SarvamApiError("batch result download");
  let result: unknown;
  try { result = JSON.parse(text); }
  catch { throw new SarvamApiError("batch result download"); }
  const transcript = parseBatchTranscript(result);
  return transcript ? { state: "completed", transcript } : { state: "failed" };
}

async function batchJson(operation: string, path: string, method: "GET" | "POST", body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    method,
    headers: { "api-subscription-key": apiKey(), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new SarvamApiError(operation, response.status);
  try {
    const value: unknown = await response.json();
    const object = asRecord(value);
    if (!object) throw new SarvamApiError(operation);
    return object;
  } catch (error) {
    if (error instanceof SarvamApiError) throw error;
    throw new SarvamApiError(operation);
  }
}

function parseBatchTranscript(value: unknown): SarvamTranscript | null {
  const result = asRecord(value);
  if (!result || typeof result.transcript !== "string") return null;
  const timestamps = asRecord(result.timestamps);
  const chunks = timestamps?.chunks;
  const starts = timestamps?.start_time_seconds;
  const ends = timestamps?.end_time_seconds;
  const validTimestamps = Array.isArray(chunks) && chunks.every((item) => typeof item === "string")
    && Array.isArray(starts) && starts.every((item) => typeof item === "number" && Number.isFinite(item))
    && Array.isArray(ends) && ends.every((item) => typeof item === "number" && Number.isFinite(item))
    && chunks.length === starts.length && chunks.length === ends.length;
  return {
    transcript: result.transcript,
    languageCode: typeof result.language_code === "string" ? result.language_code : null,
    languageProbability: null,
    requestId: typeof result.request_id === "string" ? result.request_id : null,
    ...(validTimestamps ? { timestamps: { segments: chunks as string[], startTimeSeconds: starts as number[], endTimeSeconds: ends as number[] } } : {}),
  };
}

function batchFilename(mimeType: string): string {
  const extension = mimeType === "audio/wav" || mimeType === "audio/x-wav" ? "wav"
    : mimeType === "audio/mpeg" ? "mp3"
      : mimeType === "audio/aac" ? "aac"
        : mimeType === "audio/ogg" ? "ogg"
          : mimeType === "audio/flac" ? "flac"
            : "m4a";
  return SARVAM_BATCH_FILE.replace(/\.m4a$/, `.${extension}`);
}

function safeProviderUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function objectField(value: Record<string, unknown> | null | undefined, key: string): Record<string, unknown> | null {
  return asRecord(value?.[key]);
}

function stringField(value: Record<string, unknown> | null | undefined, key: string): string | undefined {
  const field = value?.[key];
  return typeof field === "string" ? field : undefined;
}

export async function completeChat(messages: SarvamChatMessage[], options: { maxTokens?: number; temperature?: number } = {}): Promise<string> {
  if (!messages.length || messages.some(({ content }) => !content.trim())) throw new Error("At least one non-empty chat message is required.");
  const result = await jsonRequest<{ choices?: Array<{ message?: { content?: unknown } }> }>("chat completion", "/v1/chat/completions", {
    model: CHAT_MODEL,
    messages,
    max_tokens: options.maxTokens ?? 1_024,
    temperature: options.temperature ?? 0.2,
    reasoning_effort: "low",
    stream: false,
    n: 1,
  });
  const content = result.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new SarvamApiError("chat completion");
  return content;
}

export async function translateText(input: string, sourceLanguageCode: SarvamLanguageCode, targetLanguageCode: SarvamLanguageCode): Promise<string> {
  if (!input.trim() || input.length > TRANSLATE_MAX_CHARACTERS) throw new Error("Sarvam Translate accepts 1–2,000 characters per request.");
  if (!validLanguageCode(sourceLanguageCode) || !validLanguageCode(targetLanguageCode)) throw new Error("Unsupported Sarvam translation language.");
  const result = await jsonRequest<{ translated_text?: unknown }>("translation", "/translate", {
    input,
    source_language_code: sourceLanguageCode,
    target_language_code: targetLanguageCode,
    model: "sarvam-translate:v1",
  });
  if (typeof result.translated_text !== "string") throw new SarvamApiError("translation");
  return result.translated_text;
}

function decodeBase64Audio(encoded: string): Uint8Array {
  if (!encoded || encoded.length > 32_000_000) throw new SarvamApiError("text-to-speech");
  try {
    const binary = atob(encoded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new SarvamApiError("text-to-speech");
  }
}

export async function synthesizeSpeech(text: string, languageCode: SarvamLanguageCode, speaker = "shubh"): Promise<Uint8Array> {
  if (!text.trim() || text.length > TTS_MAX_CHARACTERS) throw new Error("Sarvam text-to-speech accepts 1–2,500 characters per request.");
  if (!validLanguageCode(languageCode) || !supportsSarvamTextToSpeech(languageCode)) throw new Error("Sarvam text-to-speech does not support this language.");
  const result = await jsonRequest<{ audios?: unknown }>("text-to-speech", "/text-to-speech", {
    text,
    language_code: languageCode,
    model: TTS_MODEL,
    speaker,
  });
  const audio = Array.isArray(result.audios) ? result.audios[0] : undefined;
  if (typeof audio !== "string") throw new SarvamApiError("text-to-speech");
  return decodeBase64Audio(audio);
}
