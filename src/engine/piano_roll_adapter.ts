/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ParsedScore, SolfaNote, Measure, VoiceLine, System } from '../types';
import { getKeyInfo, basePitchClass, resolveNoteSemantics, scaleDegreeToSyllable, calculateScaleDegree } from './solfa_semantics';
import { SolfaTransformer } from './solfa_transformer';

export interface FlatPianoRollNote {
  id: string;
  voiceId: string;
  startTick: number;       // Global offset in sixteenth-note ticks
  durationTicks: number;   // Duration in sixteenth-note ticks
  midiPitch: number;       // Standard MIDI note number (e.g. 60 = C4)
  isRest: boolean;
  syllable: string;        // Sol-fa syllable: 'd', 'r', 'm', etc.
  rawLetter?: string;
  rawAccidental?: string;
  octaveNum?: number;
  scaleDegree?: number;
  octaveRelativeToVoice?: number;
  measureNumber?: number;
  beatInMeasure?: number;
}

export interface MeasureGridInfo {
  measureIndex: number;    // 0-indexed
  measureNumber: number;   // 1-indexed
  startTick: number;
  durationTicks: number;
}

/**
 * Maps standard choral voice names/IDs to voice category.
 */
export function getVoiceCategory(voiceId: string): 'S' | 'A' | 'T' | 'B' | 'D' | 'other' {
  const v = voiceId.trim().toUpperCase();
  if (v.startsWith('S') || v === '1') return 'S';
  if (v.startsWith('A') || v === '2') return 'A';
  if (v.startsWith('T') || v === '3') return 'T';
  if (v.startsWith('B') || v === '4') return 'B';
  if (v.startsWith('D') || v === '5') return 'D';
  return 'other';
}

export interface VoiceTheme {
  name: string;
  channelKey: string;
  bgClass: string;
  borderClass: string;
  textClass: string;
  badgeBg: string;
  hex: string;
}

export const VOICE_THEMES: Record<string, VoiceTheme> = {
  S: {
    name: 'Soprano',
    channelKey: 'S',
    bgClass: 'bg-rose-500 hover:bg-rose-400',
    borderClass: 'border-rose-300 ring-rose-400/50',
    textClass: 'text-rose-100',
    badgeBg: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
    hex: '#F43F5E',
  },
  A: {
    name: 'Alto',
    channelKey: 'A',
    bgClass: 'bg-amber-500 hover:bg-amber-400',
    borderClass: 'border-amber-300 ring-amber-400/50',
    textClass: 'text-amber-100',
    badgeBg: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    hex: '#F59E0B',
  },
  T: {
    name: 'Tenor',
    channelKey: 'T',
    bgClass: 'bg-emerald-500 hover:bg-emerald-400',
    borderClass: 'border-emerald-300 ring-emerald-400/50',
    textClass: 'text-emerald-100',
    badgeBg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    hex: '#10B981',
  },
  B: {
    name: 'Bass',
    channelKey: 'B',
    bgClass: 'bg-indigo-500 hover:bg-indigo-400',
    borderClass: 'border-indigo-300 ring-indigo-400/50',
    textClass: 'text-indigo-100',
    badgeBg: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
    hex: '#6366F1',
  },
  D: {
    name: 'Descant',
    channelKey: 'D',
    bgClass: 'bg-purple-500 hover:bg-purple-400',
    borderClass: 'border-purple-300 ring-purple-400/50',
    textClass: 'text-purple-100',
    badgeBg: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    hex: '#A855F7',
  },
  other: {
    name: 'Voice',
    channelKey: 'other',
    bgClass: 'bg-cyan-500 hover:bg-cyan-400',
    borderClass: 'border-cyan-300 ring-cyan-400/50',
    textClass: 'text-cyan-100',
    badgeBg: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
    hex: '#06B6D4',
  },
};

export function getVoiceTheme(voiceId: string): VoiceTheme {
  const cat = getVoiceCategory(voiceId);
  return VOICE_THEMES[cat] || VOICE_THEMES.other;
}

/**
 * Calculates meter ticks per measure.
 * 4/4 = 64 ticks (16 ticks per quarter note)
 * 3/4 = 48 ticks
 * 2/4 = 32 ticks
 * 6/8 = 48 ticks (8 ticks per eighth note)
 */
export function getMeterTicksPerMeasure(meterStr: string | undefined): number {
  if (!meterStr) return 64;
  const m = meterStr.trim();
  if (m === 'C') return 64;
  if (m === 'C|') return 64;
  const parts = m.split('/');
  if (parts.length === 2) {
    const num = parseInt(parts[0], 10);
    const den = parseInt(parts[1], 10);
    if (!isNaN(num) && !isNaN(den) && den > 0) {
      // 16 ticks per quarter note = (16 * 4) / den ticks per beat
      return Math.round((num * 64) / den);
    }
  }
  return 64;
}

/**
 * Gets the primary beat length in sixteenth-note ticks, grouping compound
 * eighth-note meters into dotted-quarter beats.
 */
export function getMeterBeatTicks(meterStr: string | undefined): number {
  const meter = meterStr?.trim();
  if (meter === 'C|') return 32;
  if (meter === 'C') return 16;
  if (!meter) return 16;

  const parts = meter.split('/');
  if (parts.length !== 2) return 16;

  const numerator = Number.parseInt(parts[0], 10);
  const denominator = Number.parseInt(parts[1], 10);
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || numerator <= 0 || denominator <= 0) {
    return 16;
  }

  const denominatorBeatTicks = Math.max(1, Math.round(64 / denominator));
  return denominator === 8 && numerator > 3 && numerator % 3 === 0
    ? denominatorBeatTicks * 3
    : denominatorBeatTicks;
}

/**
 * Converts a MIDI note number into letter, accidental, and octave,
 * picking appropriate enharmonics according to the score's key signature.
 */
export function midiToNoteProperties(
  midiPitch: number,
  keyStr: string = 'C'
): { rawLetter: string; rawAccidental?: string; octaveNum: number } {
  const keyInfo = getKeyInfo(keyStr);
  const pc = ((midiPitch % 12) + 12) % 12;
  const octaveNum = Math.floor(midiPitch / 12) - 1;

  // Key with flats (sharpsFlats < 0) prefers flat spelling; sharps prefer sharp spelling.
  const prefersFlats = keyInfo.sharpsFlats < 0;

  const sharpMap: { [pc: number]: { letter: string; acc?: string } } = {
    0: { letter: 'C' },
    1: { letter: 'C', acc: '^' },
    2: { letter: 'D' },
    3: { letter: 'D', acc: '^' },
    4: { letter: 'E' },
    5: { letter: 'F' },
    6: { letter: 'F', acc: '^' },
    7: { letter: 'G' },
    8: { letter: 'G', acc: '^' },
    9: { letter: 'A' },
    10: { letter: 'A', acc: '^' },
    11: { letter: 'B' },
  };

  const flatMap: { [pc: number]: { letter: string; acc?: string } } = {
    0: { letter: 'C' },
    1: { letter: 'D', acc: '_' },
    2: { letter: 'D' },
    3: { letter: 'E', acc: '_' },
    4: { letter: 'E' },
    5: { letter: 'F' },
    6: { letter: 'G', acc: '_' },
    7: { letter: 'G' },
    8: { letter: 'A', acc: '_' },
    9: { letter: 'A' },
    10: { letter: 'B', acc: '_' },
    11: { letter: 'B' },
  };

  const mapping = prefersFlats ? flatMap[pc] : sharpMap[pc];
  return {
    rawLetter: mapping.letter,
    rawAccidental: mapping.acc,
    octaveNum,
  };
}

/**
 * Formats a MIDI pitch as standard scientific pitch name (e.g. 60 -> "C4", 61 -> "C#4" or "Db4")
 */
export function formatPitchLabel(midiPitch: number, keyStr: string = 'C'): string {
  const { rawLetter, rawAccidental, octaveNum } = midiToNoteProperties(midiPitch, keyStr);
  const accSymbol = rawAccidental === '^' ? '♯' : rawAccidental === '_' ? '♭' : '';
  return `${rawLetter}${accSymbol}${octaveNum}`;
}

/**
 * Returns full pitch semantics including Sol-fa syllable, scale degree, letter, accidental, and octave number.
 */
export function getPitchSemantics(
  midiPitch: number,
  keyStr: string = 'C'
): {
  rawLetter: string;
  rawAccidental?: string;
  octaveNum: number;
  scaleDegree: number;
  syllable: string;
} {
  const props = midiToNoteProperties(midiPitch, keyStr);
  const keyInfo = getKeyInfo(keyStr);
  const pc = ((midiPitch % 12) + 12) % 12;
  const scaleDegree = calculateScaleDegree(pc, keyInfo.tonic);
  const syllable = scaleDegreeToSyllable(scaleDegree);
  return {
    ...props,
    scaleDegree,
    syllable,
  };
}

/**
 * Returns a human-friendly duration name for sixteenth ticks.
 */
export function getNoteDurationLabel(ticks: number): string {
  switch (ticks) {
    case 2:
      return 'Thirty-second note (1/32)';
    case 4:
      return 'Sixteenth note (1/16)';
    case 6:
      return 'Dotted sixteenth note';
    case 8:
      return 'Eighth note (1/8)';
    case 12:
      return 'Dotted eighth note';
    case 16:
      return 'Quarter note (1/4)';
    case 24:
      return 'Dotted quarter note';
    case 32:
      return 'Half note (1/2)';
    case 48:
      return 'Dotted half note';
    case 64:
      return 'Whole note (1)';
    default:
      if (ticks % 16 === 0) return `${ticks / 16} beats`;
      return `${ticks} ticks`;
  }
}

/**
 * Formats a Sol-fa syllable with octave accents (e.g. d', d'', s,).
 */
export function formatSolfaOctaveLabel(syllable: string, octaveRel?: number): string {
  if (!octaveRel) return syllable;
  if (octaveRel === 1) return `${syllable}′`;
  if (octaveRel === 2) return `${syllable}″`;
  if (octaveRel > 2) return `${syllable}(+${octaveRel})`;
  if (octaveRel === -1) return `${syllable}₁`;
  if (octaveRel === -2) return `${syllable}₂`;
  return `${syllable}(${octaveRel})`;
}

/**
 * Calculates frequency in Hz for standard 12-TET A4=440Hz.
 */
export function midiToFrequency(midiPitch: number): number {
  return Math.round(440 * Math.pow(2, (midiPitch - 69) / 12) * 10) / 10;
}


/**
 * Extracts all notes from ParsedScore into a flat array of PianoRollNotes.
 */
export function flattenScoreToPianoRoll(score: ParsedScore): {
  notes: FlatPianoRollNote[];
  measures: MeasureGridInfo[];
  totalTicks: number;
} {
  const flatNotes: FlatPianoRollNote[] = [];
  const measureInfos: MeasureGridInfo[] = [];

  const meterTicks = getMeterTicksPerMeasure(score.meter);
  let globalMeasureIdx = 0;
  let currentMeasureStart = 0;
  let maxTick = 0;

  score.systems.forEach((system, sIdx) => {
    // Find number of measures in this system
    let systemMeasures = 0;
    score.voices.forEach((v) => {
      const vl = system.voices[v.id];
      if (vl && vl.measures.length > systemMeasures) {
        systemMeasures = vl.measures.length;
      }
    });

    for (let mIdx = 0; mIdx < systemMeasures; mIdx++) {
      // Find duration of this measure across voices
      measureInfos.push({
        measureIndex: globalMeasureIdx,
        measureNumber: globalMeasureIdx + 1,
        startTick: currentMeasureStart,
        durationTicks: meterTicks,
      });

      // Extract notes for each voice
      score.voices.forEach((v) => {
        const vl = system.voices[v.id];
        if (vl && vl.measures[mIdx]) {
          const m = vl.measures[mIdx];
          let noteOffset = 0;
          const beatTicks = getMeterBeatTicks(score.meter);
          m.notes.forEach((n, nIdx) => {
            const dur = Math.max(1, n.durationTicks || 16);
            const start = currentMeasureStart + noteOffset;
            const beatInMeasure = Math.floor(noteOffset / Math.max(1, beatTicks)) + 1;
            noteOffset += dur;
            const end = start + dur;
            if (end > maxTick) maxTick = end;

            flatNotes.push({
              id: `${v.id}_${sIdx}_${mIdx}_${nIdx}_${start}`,
              voiceId: v.id,
              startTick: start,
              durationTicks: dur,
              midiPitch: n.midiPitch,
              isRest: !!n.isRest,
              syllable: n.syllable || (n.isRest ? '·' : 'd'),
              rawLetter: n.rawLetter,
              rawAccidental: n.rawAccidental,
              octaveNum: n.octaveNum,
              scaleDegree: n.scaleDegree,
              octaveRelativeToVoice: n.octaveRelativeToVoice,
              measureNumber: globalMeasureIdx + 1,
              beatInMeasure,
            });
          });
        }
      });

      currentMeasureStart += meterTicks;
      globalMeasureIdx++;
    }
  });

  if (maxTick < currentMeasureStart) {
    maxTick = currentMeasureStart;
  }

  return {
    notes: flatNotes,
    measures: measureInfos,
    totalTicks: Math.max(maxTick, meterTicks * 4),
  };
}

/**
 * Strict monophony enforcement per channel:
 * For a given voice channel (e.g. Soprano), no two sounding notes can occupy the same time position.
 * If a note overlaps with another note in the same channel:
 * - The later or newly placed note takes precedence;
 * - Overlapping notes are truncated or removed so intervals are strictly non-overlapping.
 */
export function enforceMonophony(
  notes: FlatPianoRollNote[],
  targetVoiceId?: string
): FlatPianoRollNote[] {
  // Group notes by voice
  const byVoice: { [vId: string]: FlatPianoRollNote[] } = {};
  notes.forEach((n) => {
    if (!byVoice[n.voiceId]) byVoice[n.voiceId] = [];
    byVoice[n.voiceId].push({ ...n });
  });

  const result: FlatPianoRollNote[] = [];

  Object.keys(byVoice).forEach((vId) => {
    const vNotes = byVoice[vId];
    if (targetVoiceId && vId !== targetVoiceId) {
      result.push(...vNotes);
      return;
    }

    // Filter out 0 or negative duration
    const validNotes = vNotes
      .filter((n) => n.durationTicks > 0)
      .sort((a, b) => a.startTick - b.startTick);

    const monophonic: FlatPianoRollNote[] = [];

    for (let i = 0; i < validNotes.length; i++) {
      const cur = validNotes[i];
      if (monophonic.length === 0) {
        monophonic.push(cur);
        continue;
      }

      const prev = monophonic[monophonic.length - 1];
      const prevEnd = prev.startTick + prev.durationTicks;

      if (cur.startTick < prevEnd) {
        // Overlap detected in same channel!
        if (cur.startTick === prev.startTick) {
          // Exactly same start tick: current note overrides previous note
          monophonic[monophonic.length - 1] = cur;
        } else {
          // Truncate previous note so it ends when cur starts
          const truncatedDur = cur.startTick - prev.startTick;
          if (truncatedDur > 0) {
            prev.durationTicks = truncatedDur;
            monophonic.push(cur);
          } else {
            // cur completely shadowed prev
            monophonic[monophonic.length - 1] = cur;
          }
        }
      } else {
        monophonic.push(cur);
      }
    }

    result.push(...monophonic);
  });

  return result;
}

/**
 * Automatically formats and quantizes notes on blur to fit the standards of SolfaTunes:
 * 1. Snaps start ticks and durations to the grid subdivision.
 * 2. Strictly enforces monophony across all channels.
 * 3. Splits or bounds notes at measure boundaries.
 * 4. Fills gaps within measures with rests.
 * 5. Recomputes Tonic Sol-fa syllables, scale degrees, and ABC pitch representations.
 * 6. Returns a new synchronized ParsedScore.
 */
export function formatAndReconstructScore(
  baseScore: ParsedScore,
  flatNotes: FlatPianoRollNote[],
  snapTicks: number = 4
): ParsedScore {
  const keyInfo = getKeyInfo(baseScore.key);
  const meterTicks = getMeterTicksPerMeasure(baseScore.meter);

  // 1. Quantize startTick and durationTicks
  const quantizedNotes = flatNotes.map((n) => {
    const start = Math.max(0, Math.round(n.startTick / snapTicks) * snapTicks);
    const dur = Math.max(snapTicks, Math.round(n.durationTicks / snapTicks) * snapTicks);
    return {
      ...n,
      startTick: start,
      durationTicks: dur,
    };
  });

  // 2. Enforce monophony per channel
  const monophonicNotes = enforceMonophony(quantizedNotes);

  // 3. Determine maximum length in ticks and number of measures needed
  let maxTick = 0;
  monophonicNotes.forEach((n) => {
    const end = n.startTick + n.durationTicks;
    if (end > maxTick) maxTick = end;
  });

  const totalMeasures = Math.max(1, Math.ceil(maxTick / meterTicks));

  // 4. Group notes per voice and populate measure bins
  const voices = baseScore.voices;
  const newSystems: System[] = [];

  // Group measures into systems (e.g. 4 measures per system standard)
  const MEASURES_PER_SYSTEM = 4;
  const totalSystems = Math.ceil(totalMeasures / MEASURES_PER_SYSTEM);

  for (let sIdx = 0; sIdx < totalSystems; sIdx++) {
    const mStartIdx = sIdx * MEASURES_PER_SYSTEM;
    const mEndIdx = Math.min(totalMeasures, mStartIdx + MEASURES_PER_SYSTEM);
    const numMeasuresInSystem = mEndIdx - mStartIdx;

    const systemVoices: { [vId: string]: VoiceLine } = {};

    voices.forEach((voice) => {
      const voiceNotes = monophonicNotes
        .filter((n) => n.voiceId === voice.id && !n.isRest)
        .sort((a, b) => a.startTick - b.startTick);

      const measures: Measure[] = [];
      const barTypes: string[] = [];

      for (let m = mStartIdx; m < mEndIdx; m++) {
        const measureStartTick = m * meterTicks;
        const measureEndTick = measureStartTick + meterTicks;

        const measureNotes: SolfaNote[] = [];
        let curTick = measureStartTick;

        // Find notes that overlap with [measureStartTick, measureEndTick)
        const inMeasure = voiceNotes.filter((n) => {
          const nEnd = n.startTick + n.durationTicks;
          return n.startTick < measureEndTick && nEnd > measureStartTick;
        });

        inMeasure.forEach((n) => {
          const nEnd = n.startTick + n.durationTicks;
          const sliceStart = Math.max(measureStartTick, n.startTick);
          const sliceEnd = Math.min(measureEndTick, nEnd);
          const sliceDur = sliceEnd - sliceStart;

          // Fill rest gap before this note if needed
          if (sliceStart > curTick) {
            const restDur = sliceStart - curTick;
            measureNotes.push({
              syllable: '·',
              scaleDegree: 0,
              midiPitch: 0,
              octaveRelativeToVoice: 0,
              durationTicks: restDur,
              isRest: true,
              timestamp: curTick,
              rawLetter: 'z',
            });
            curTick = sliceStart;
          }

          // Generate note properties from pitch
          const props = midiToNoteProperties(n.midiPitch, baseScore.key);
          const pc = ((n.midiPitch % 12) + 12) % 12;
          const scaleDegree = calculateScaleDegree(pc, keyInfo.tonic);
          const syllable = scaleDegreeToSyllable(scaleDegree);

          measureNotes.push({
            syllable,
            scaleDegree,
            midiPitch: n.midiPitch,
            octaveRelativeToVoice: 0,
            durationTicks: sliceDur,
            isRest: false,
            timestamp: sliceStart,
            rawLetter: props.rawLetter,
            rawAccidental: props.rawAccidental,
            octaveNum: props.octaveNum,
          });

          curTick = sliceEnd;
        });

        // Fill trailing rest to complete the measure if needed
        if (curTick < measureEndTick) {
          const restDur = measureEndTick - curTick;
          measureNotes.push({
            syllable: '·',
            scaleDegree: 0,
            midiPitch: 0,
            octaveRelativeToVoice: 0,
            durationTicks: restDur,
            isRest: true,
            timestamp: curTick,
            rawLetter: 'z',
          });
        }

        // Fallback for totally empty measure
        if (measureNotes.length === 0) {
          measureNotes.push({
            syllable: '·',
            scaleDegree: 0,
            midiPitch: 0,
            octaveRelativeToVoice: 0,
            durationTicks: meterTicks,
            isRest: true,
            timestamp: measureStartTick,
            rawLetter: 'z',
          });
        }

        measures.push({
          notes: measureNotes,
          rawText: '',
        });

        barTypes.push(m === totalMeasures - 1 ? '|]' : '|');
      }

      systemVoices[voice.id] = {
        voiceId: voice.id,
        measures,
        barTypes,
      };
    });

    newSystems.push({
      systemIndex: sIdx,
      voices: systemVoices,
    });
  }

  const newScore: ParsedScore = {
    ...baseScore,
    systems: newSystems,
  };

  // Re-run transformer to ensure voice registers, octave dots, and timestamps are mathematically pristine
  const transformer = new SolfaTransformer();
  return transformer.transform(newScore);
}
