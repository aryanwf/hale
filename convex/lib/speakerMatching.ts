export const MATCH_CONFIDENCE_THRESHOLD = 70;
export const MATCH_CONFIDENCE_MARGIN = 15;
export const MIN_SPEAKER_SPEECH_SECONDS = 2;

export interface MatchTurn { id: string; start: number; end: number }
export interface MatchCandidate { label: string; personId: string }
export interface TurnMatch { turnId: string; label?: string }

interface DiarizationSegment { speaker: string; start: number; end: number }
interface SpeakerScores { speaker: string; scores: Record<string, number> }

/**
 * Attribute a transcript turn only when exactly one diarized speaker covers most
 * of it and that speaker clears all score and usable-speech safeguards.
 * The thresholds are conservative starting gates, not calibrated certainty.
 */
export function matchTranscriptTurns(
  turns: MatchTurn[],
  output: unknown,
  candidates: MatchCandidate[],
  durationSeconds: number,
): TurnMatch[] {
  const root = asRecord(output);
  const diarizationRaw = root?.diarization;
  const voiceprintsRaw = root?.voiceprints;
  if (!Array.isArray(diarizationRaw) || diarizationRaw.length > 10_000 || !Array.isArray(voiceprintsRaw) || voiceprintsRaw.length > 500) {
    throw new Error("pyannote identification returned an invalid result.");
  }

  const segments: DiarizationSegment[] = diarizationRaw.map((item) => {
    const segment = asRecord(item);
    if (!segment || typeof segment.speaker !== "string" || !isValidInterval(segment.start, segment.end, durationSeconds)) {
      throw new Error("pyannote identification returned an invalid diarization segment.");
    }
    return { speaker: segment.speaker, start: segment.start as number, end: segment.end as number };
  });

  const candidateLabels = new Set(candidates.map((candidate) => candidate.label));
  const scoreRows: SpeakerScores[] = voiceprintsRaw.map((item) => {
    const voiceprint = asRecord(item);
    const rawScores = asRecord(voiceprint?.confidence);
    if (!voiceprint || typeof voiceprint.speaker !== "string" || !rawScores) {
      throw new Error("pyannote identification returned invalid confidence scores.");
    }
    const scores: Record<string, number> = {};
    for (const [label, score] of Object.entries(rawScores)) {
      if (!candidateLabels.has(label)) continue;
      if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 100) {
        throw new Error("pyannote identification returned an invalid confidence score.");
      }
      scores[label] = score;
    }
    return { speaker: voiceprint.speaker, scores };
  });

  const speechSeconds = new Map<string, number>();
  for (const speaker of new Set(segments.map((segment) => segment.speaker))) {
    const intervals = segments.filter((segment) => segment.speaker === speaker).map(({ start, end }) => [start, end] as const).sort((a, b) => a[0] - b[0]);
    let total = 0;
    let start: number | undefined;
    let end = 0;
    for (const [nextStart, nextEnd] of intervals) {
      if (start === undefined) { start = nextStart; end = nextEnd; }
      else if (nextStart <= end) end = Math.max(end, nextEnd);
      else { total += end - start; start = nextStart; end = nextEnd; }
    }
    if (start !== undefined) total += end - start;
    speechSeconds.set(speaker, total);
  }

  const acceptedLabels = new Map<string, string>();
  for (const row of scoreRows) {
    if ((speechSeconds.get(row.speaker) ?? 0) < MIN_SPEAKER_SPEECH_SECONDS) continue;
    const ranked = Object.entries(row.scores).sort((a, b) => b[1] - a[1]);
    const best = ranked[0];
    const runnerUp = ranked[1];
    if (!best || best[1] < MATCH_CONFIDENCE_THRESHOLD || (runnerUp && best[1] - runnerUp[1] < MATCH_CONFIDENCE_MARGIN)) continue;
    acceptedLabels.set(row.speaker, best[0]);
  }

  return turns.map((turn) => {
    const overlapping = new Map<string, number>();
    for (const segment of segments) {
      const overlap = Math.min(segment.end, turn.end) - Math.max(segment.start, turn.start);
      if (overlap > 0) overlapping.set(segment.speaker, (overlapping.get(segment.speaker) ?? 0) + overlap);
    }
    if (overlapping.size !== 1 || turn.end <= turn.start) return { turnId: turn.id };
    const [[speaker, overlap]] = [...overlapping.entries()];
    if (overlap / (turn.end - turn.start) < 0.8) return { turnId: turn.id };
    const label = acceptedLabels.get(speaker);
    return label ? { turnId: turn.id, label } : { turnId: turn.id };
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function isValidInterval(start: unknown, end: unknown, durationSeconds: number): boolean {
  return typeof start === "number" && Number.isFinite(start) && start >= 0
    && typeof end === "number" && Number.isFinite(end) && end > start && end <= durationSeconds + 1;
}
