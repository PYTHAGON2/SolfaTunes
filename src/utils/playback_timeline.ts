import { ParsedScore } from '../types';

export interface ScoreMeasureRange {
  systemIndex: number;
  measureIndex: number;
  start: number;
  end: number;
}

export function getScoreMeasureRanges(score: ParsedScore | null): ScoreMeasureRange[] {
  if (!score) return [];

  const ranges: ScoreMeasureRange[] = [];
  let timelineOffset = 0;

  score.systems.forEach(system => {
    const systemMeasureCount = Math.max(
      0,
      ...score.voices.map(voice => system.voices[voice.id]?.measures.length || 0)
    );

    for (let measureIndex = 0; measureIndex < systemMeasureCount; measureIndex++) {
      let measureDuration = 0;

      score.voices.forEach(voice => {
        const measure = system.voices[voice.id]?.measures[measureIndex];
        if (!measure) return;

        const voiceDuration = measure.notes.reduce(
          (duration, note) => duration + note.durationTicks,
          0
        );
        measureDuration = Math.max(measureDuration, voiceDuration);
      });

      if (measureDuration === 0) measureDuration = 16;

      ranges.push({
        systemIndex: system.systemIndex,
        measureIndex,
        start: timelineOffset,
        end: timelineOffset + measureDuration,
      });
      timelineOffset += measureDuration;
    }
  });

  return ranges;
}

export function findActiveMeasureRange(
  ranges: ScoreMeasureRange[],
  tick: number
): ScoreMeasureRange | undefined {
  const activeRange = ranges.find(range => tick >= range.start && tick < range.end);
  if (activeRange) return activeRange;

  const lastRange = ranges[ranges.length - 1];
  return lastRange && tick >= lastRange.end ? lastRange : undefined;
}

export interface PianoRollMeasureBounds {
  measureIndex: number;
  startTick: number;
  durationTicks: number;
}

/**
 * Maps an audio playback tick (from MidiPlayer, based on score measure durations)
 * to the exact corresponding tick on the Piano Roll canvas.
 * For scores where all measures match meter (e.g. Vienna), this is an identity.
 * For scores with pickup measures (anacrusis, e.g. Winchester New or Franconia),
 * this maps the active audio measure to the corresponding piano roll measure with perfect alignment.
 */
export function audioTickToPianoRollTick(
  audioTick: number,
  audioRanges: ScoreMeasureRange[],
  pianoMeasures: PianoRollMeasureBounds[]
): number {
  if (!audioRanges || audioRanges.length === 0 || !pianoMeasures || pianoMeasures.length === 0) {
    return audioTick;
  }

  if (audioTick <= 0) {
    return 0;
  }

  let measureIdx = audioRanges.findIndex(r => audioTick >= r.start && audioTick < r.end);

  if (measureIdx === -1) {
    const lastAudio = audioRanges[audioRanges.length - 1];
    const lastPiano = pianoMeasures[pianoMeasures.length - 1];
    if (audioTick >= lastAudio.end) {
      return lastPiano.startTick + lastPiano.durationTicks;
    }
    measureIdx = 0;
  }

  const audioRange = audioRanges[measureIdx];
  const pianoMeasure = pianoMeasures[measureIdx] || pianoMeasures[pianoMeasures.length - 1];
  const audioDuration = Math.max(1, audioRange.end - audioRange.start);
  const pianoDuration = Math.max(1, pianoMeasure.durationTicks);

  const offsetInAudio = audioTick - audioRange.start;

  if (audioDuration === pianoDuration) {
    return pianoMeasure.startTick + offsetInAudio;
  }

  const ratio = Math.min(1, Math.max(0, offsetInAudio / audioDuration));
  return pianoMeasure.startTick + ratio * pianoDuration;
}

/**
 * Maps a click/scrub tick on the Piano Roll canvas back to the exact audio playback tick in MidiPlayer.
 */
export function pianoRollTickToAudioTick(
  pianoTick: number,
  audioRanges: ScoreMeasureRange[],
  pianoMeasures: PianoRollMeasureBounds[]
): number {
  if (!audioRanges || audioRanges.length === 0 || !pianoMeasures || pianoMeasures.length === 0) {
    return pianoTick;
  }

  if (pianoTick <= 0) {
    return 0;
  }

  let measureIdx = pianoMeasures.findIndex(
    m => pianoTick >= m.startTick && pianoTick < m.startTick + m.durationTicks
  );

  if (measureIdx === -1) {
    const lastAudio = audioRanges[audioRanges.length - 1];
    const lastPiano = pianoMeasures[pianoMeasures.length - 1];
    if (pianoTick >= lastPiano.startTick + lastPiano.durationTicks) {
      return lastAudio.end;
    }
    measureIdx = 0;
  }

  const audioRange = audioRanges[measureIdx] || audioRanges[audioRanges.length - 1];
  const pianoMeasure = pianoMeasures[measureIdx];
  const audioDuration = Math.max(1, audioRange.end - audioRange.start);
  const pianoDuration = Math.max(1, pianoMeasure.durationTicks);

  const offsetInPiano = pianoTick - pianoMeasure.startTick;

  if (audioDuration === pianoDuration) {
    return audioRange.start + Math.min(offsetInPiano, audioDuration);
  }

  const ratio = Math.min(1, Math.max(0, offsetInPiano / pianoDuration));
  return Math.round(audioRange.start + ratio * audioDuration);
}

