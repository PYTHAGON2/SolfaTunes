import { describe, expect, it } from 'vitest';
import { ParsedScore, SolfaNote } from '../types';
import { findActiveMeasureRange, getScoreMeasureRanges, audioTickToPianoRollTick, pianoRollTickToAudioTick } from './playback_timeline';

function makeMeasure(durationTicks: number) {
  const note: SolfaNote = {
    syllable: 'd',
    scaleDegree: 0,
    midiPitch: 60,
    octaveRelativeToVoice: 0,
    durationTicks,
    isRest: false,
    timestamp: 0,
  };
  return { notes: [note], rawText: 'C' };
}

function makeScore(): ParsedScore {
  return {
    title: 'Timeline test',
    composer: 'Test',
    key: 'C',
    meter: '4/4',
    defaultLength: '1/4',
    index: '1',
    voices: [
      { id: '1', name: 'Soprano', clef: 'treble', order: 0 },
      { id: '2', name: 'Alto', clef: 'treble', order: 1 },
    ],
    voicePairingGroups: [],
    systems: [
      {
        systemIndex: 0,
        voices: {
          '1': {
            voiceId: '1',
            measures: [makeMeasure(4), makeMeasure(8)],
            barTypes: ['|', '|'],
          },
          '2': {
            voiceId: '2',
            measures: [makeMeasure(12), makeMeasure(8)],
            barTypes: ['|', '|'],
          },
        },
      },
      {
        systemIndex: 1,
        voices: {
          '1': {
            voiceId: '1',
            measures: [makeMeasure(8)],
            barTypes: ['|'],
          },
          '2': {
            voiceId: '2',
            measures: [makeMeasure(4), makeMeasure(4)],
            barTypes: ['|', '|'],
          },
        },
      },
    ],
  };
}

describe('score playback measure timeline', () => {
  it('uses the longest voice in each measure and includes measures missing from the first voice', () => {
    expect(getScoreMeasureRanges(makeScore())).toEqual([
      { systemIndex: 0, measureIndex: 0, start: 0, end: 12 },
      { systemIndex: 0, measureIndex: 1, start: 12, end: 20 },
      { systemIndex: 1, measureIndex: 0, start: 20, end: 28 },
      { systemIndex: 1, measureIndex: 1, start: 28, end: 32 },
    ]);
  });

  it('moves to the next measure exactly at a boundary and stays on the final measure at the end', () => {
    const ranges = getScoreMeasureRanges(makeScore());

    expect(findActiveMeasureRange(ranges, 11.99)).toBe(ranges[0]);
    expect(findActiveMeasureRange(ranges, 12)).toBe(ranges[1]);
    expect(findActiveMeasureRange(ranges, 20)).toBe(ranges[2]);
    expect(findActiveMeasureRange(ranges, 32)).toBe(ranges[3]);
  });

  it('reserves a fallback measure duration for empty measures, matching the audio timeline', () => {
    const score = makeScore();
    score.systems[0].voices['2'].measures[0].notes = [];

    expect(getScoreMeasureRanges(score)[0]).toEqual({
      systemIndex: 0,
      measureIndex: 0,
      start: 0,
      end: 4,
    });
  });

  it('accurately maps audio playback ticks to piano roll canvas ticks with pickup measures', () => {
    const audioRanges = [
      { systemIndex: 0, measureIndex: 0, start: 0, end: 16 }, // 1-beat pickup
      { systemIndex: 0, measureIndex: 1, start: 16, end: 48 }, // 2-beat full measure
      { systemIndex: 0, measureIndex: 2, start: 48, end: 80 },
    ];
    const pianoMeasures = [
      { measureIndex: 0, startTick: 0, durationTicks: 32 },
      { measureIndex: 1, startTick: 32, durationTicks: 32 },
      { measureIndex: 2, startTick: 64, durationTicks: 32 },
    ];

    // At tick 0, matches start of measure 0
    expect(audioTickToPianoRollTick(0, audioRanges, pianoMeasures)).toBe(0);

    // At tick 16, audio enters measure 1 (which starts at tick 32 in piano roll)
    expect(audioTickToPianoRollTick(16, audioRanges, pianoMeasures)).toBe(32);

    // Inside measure 1 (offset 16 ticks in audio -> offset 16 ticks in piano roll)
    expect(audioTickToPianoRollTick(32, audioRanges, pianoMeasures)).toBe(48);

    // At tick 48, audio enters measure 2 (which starts at tick 64 in piano roll)
    expect(audioTickToPianoRollTick(48, audioRanges, pianoMeasures)).toBe(64);

    // Inverse mapping (clicking/scrubbing on piano roll)
    expect(pianoRollTickToAudioTick(0, audioRanges, pianoMeasures)).toBe(0);
    expect(pianoRollTickToAudioTick(32, audioRanges, pianoMeasures)).toBe(16);
    expect(pianoRollTickToAudioTick(48, audioRanges, pianoMeasures)).toBe(32);
    expect(pianoRollTickToAudioTick(64, audioRanges, pianoMeasures)).toBe(48);
  });
});
