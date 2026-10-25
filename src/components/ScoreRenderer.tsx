/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState, useRef, useEffect } from 'react';
import { ParsedScore, System, VoiceLine, Measure, SolfaNote, SelectedNoteLocation, ParseWarning } from '../types';
import { SolfaTransformer, analyzeMeasureCells } from '../engine/solfa_transformer';
import { serializeScoreToSolfa } from '../engine/solfa_serializer';
import { parseSolfaToAbc } from '../engine/solfa_parser';
import { alignSolfaGrid } from '../engine/solfa_aligner';
import { findActiveMeasureRange, getScoreMeasureRanges } from '../utils/playback_timeline';
import {
  ZoomIn,
  ZoomOut,
  Type,
  Music,
  X,
  HelpCircle,
  Eye,
  Edit2,
  Code,
  Sparkles,
  AlertTriangle,
  FileText,
  CheckSquare,
  Square,
  ChevronDown,
  ChevronUp,
  Settings,
  Maximize2,
  Minimize2,
  Columns,
} from 'lucide-react';
import { PianoRoll } from './PianoRoll';
import { MidiPlayer } from '../audio/midi_player';
import { AppSettings } from '../utils/settings';
import { Tooltip } from './Tooltip';
import { TICKS_PER_WHOLE_NOTE } from '../engine/timing';

export type StudioWorkspaceMode = 'read' | 'lyrics' | 'interactive' | 'source' | 'pianoroll' | 'split';

interface ScoreRendererProps {
  score: ParsedScore | null;
  abcText: string;
  setAbcText: (text: string) => void;
  warnings?: ParseWarning[];
  currentTick?: number;
  currentEighth?: number;
  fontSize: number;
  setFontSize: (size: number) => void;
  scale: number;
  setScale: (scale: number) => void;
  mutedVoices: { [voiceId: string]: boolean };
  toggleMute: (voiceId: string) => void;
  selectedNote: SelectedNoteLocation | null;
  onSelectNote: (location: SelectedNoteLocation | null) => void;
  onUpdateScore: (score: ParsedScore) => void;
  studioMode: StudioWorkspaceMode;
  setStudioMode: (val: StudioWorkspaceMode) => void;
  playerRef?: React.RefObject<MidiPlayer | null>;
  onSeekTick?: (tick: number) => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  settings?: AppSettings;
  onOpenSettings?: () => void;
  onUpdateSettings?: (newSettings: AppSettings) => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  isPlaying?: boolean;
  onPlay?: () => void;
  onPause?: () => void;
  onStop?: () => void;
}

/**
 * Simple syntax highlighter for ABC notation.
 * Parses lines and returns React elements with styled spans.
 */
const highlightAbc = (text: string): React.ReactNode => {
  const lines = text.split('\n');
  return lines.map((line, lineIdx) => {
    // 1. Comment check
    if (line.trimStart().startsWith('%')) {
      return (
        <span key={lineIdx} className="text-stone-500 italic">
          {line}
          {lineIdx < lines.length - 1 && '\n'}
        </span>
      );
    }

    // 2. Header check: starts with [A-Za-z]:
    const headerMatch = line.match(/^([A-Za-z]):(.*)$/);
    if (headerMatch) {
      const [_, field, content] = headerMatch;
      return (
        <span key={lineIdx}>
          <span className="text-[#818CF8] font-bold">{field}:</span>
          <span className="text-stone-300">{content}</span>
          {lineIdx < lines.length - 1 && '\n'}
        </span>
      );
    }

    // 3. Regular music lines: parse token by token
    const tokens: React.ReactNode[] = [];
    let i = 0;
    let key = 0;

    while (i < line.length) {
      const restLine = line.substring(i);

      // Inline voice specifier like [V:S] or [V:1] or any inline tag
      if (line[i] === '[' && restLine.startsWith('[V:')) {
        const closeIdx = line.indexOf(']', i);
        if (closeIdx !== -1) {
          const vSpec = line.substring(i, closeIdx + 1);
          tokens.push(
            <span key={key++} className="text-indigo-400 font-bold">
              {vSpec}
            </span>
          );
          i = closeIdx + 1;
          continue;
        }
      }

      // Bar lines: ||, |], [|, :|, |:, ::, |
      const barMatch = restLine.match(/^(?:\|\||\|\]|\[\||:\||\|:|::|\|)/);
      if (barMatch) {
        tokens.push(
          <span key={key++} className="text-amber-500 font-extrabold">
            {barMatch[0]}
          </span>
        );
        i += barMatch[0].length;
        continue;
      }

      // Accidentals: ^, _, = (and double sharps/flats ^^, __)
      const accMatch = restLine.match(/^(?:\^\^|__|\^|_|=)/);
      if (accMatch) {
        tokens.push(
          <span key={key++} className="text-emerald-400 font-bold">
            {accMatch[0]}
          </span>
        );
        i += accMatch[0].length;
        continue;
      }

      // Notes and octave indicators: [A-Ga-gzx] followed by possible octave marks or lengths
      const noteMatch = restLine.match(/^[A-Ga-gzx]/);
      if (noteMatch) {
        let noteLen = 1;
        // Collect octave marks
        while (i + noteLen < line.length && /[',]/.test(line[i + noteLen])) {
          noteLen++;
        }
        const fullNote = line.substring(i, i + noteLen);
        tokens.push(
          <span key={key++} className="text-stone-100 font-semibold">
            {fullNote}
          </span>
        );
        i += noteLen;
        continue;
      }

      // Durations/numbers: /2, 2, / etc.
      const durMatch = restLine.match(/^(?:\/[0-9]*|[0-9]+)/);
      if (durMatch) {
        tokens.push(
          <span key={key++} className="text-sky-400 font-medium">
            {durMatch[0]}
          </span>
        );
        i += durMatch[0].length;
        continue;
      }

      // Rhythms/Chords/Guitar chords: "C" or similar
      if (line[i] === '"') {
        const endQuote = line.indexOf('"', i + 1);
        if (endQuote !== -1) {
          tokens.push(
            <span key={key++} className="text-pink-400 italic font-semibold">
              {line.substring(i, endQuote + 1)}
            </span>
          );
          i = endQuote + 1;
          continue;
        }
      }

      // Any other characters (whitespace, punctuation, etc.)
      tokens.push(line[i]);
      i++;
    }

    return (
      <span key={lineIdx}>
        {tokens}
        {lineIdx < lines.length - 1 && '\n'}
      </span>
    );
  });
};

/**
 * High-fidelity syntax highlighter for Tonic Sol-fa notation.
 */
const highlightSolfa = (text: string): React.ReactNode => {
  const lines = text.split('\n');
  return lines.map((line, lineIdx) => {
    const trimmed = line.trim();

    // 1. Comments
    if (trimmed.startsWith('%')) {
      return (
        <span key={lineIdx} className="text-stone-500 italic">
          {line}
          {lineIdx < lines.length - 1 && '\n'}
        </span>
      );
    }

    // 2. Header / Key line
    if (/^KEY\s+/i.test(trimmed) || /^(?:TITLE|METER|COMPOSER):/i.test(trimmed)) {
      return (
        <span key={lineIdx}>
          <span className="text-amber-400 font-bold">{line}</span>
          {lineIdx < lines.length - 1 && '\n'}
        </span>
      );
    }

    // 3. Lyrics
    if (/^W:/i.test(trimmed)) {
      return (
        <span key={lineIdx} className="text-emerald-400 font-serif">
          {line}
          {lineIdx < lines.length - 1 && '\n'}
        </span>
      );
    }

    // 4. Music lines
    const tokens: React.ReactNode[] = [];
    let i = 0;

    // Check voice prefix at start (e.g. "S: ", "A: ")
    const prefixMatch = line.match(/^([A-Za-z0-9_]+:)\s*/);
    if (prefixMatch) {
      tokens.push(
        <span key="prefix" className="text-[#818CF8] font-bold">
          {prefixMatch[0]}
        </span>
      );
      i += prefixMatch[0].length;
    }

    while (i < line.length) {
      // Double/Final barlines
      if (line.slice(i, i + 2) === '||' || line.slice(i, i + 2) === '|]' || line.slice(i, i + 2) === ':|' || line.slice(i, i + 2) === '|:') {
        tokens.push(
          <span key={i} className="text-cyan-400 font-black">
            {line.slice(i, i + 2)}
          </span>
        );
        i += 2;
        continue;
      }

      // Single barline
      if (line[i] === '|') {
        tokens.push(
          <span key={i} className="text-cyan-400/90 font-bold">
            |
          </span>
        );
        i++;
        continue;
      }

      // Pulse divider colon
      if (line[i] === ':') {
        tokens.push(
          <span key={i} className="text-amber-300 font-black">
            :
          </span>
        );
        i++;
        continue;
      }

      // Continuation dash
      if (line[i] === '-') {
        tokens.push(
          <span key={i} className="text-rose-400 font-bold">
            -
          </span>
        );
        i++;
        continue;
      }

      // Half-pulse and quarter-pulse dividers
      if (line[i] === '.' || line[i] === ',') {
        tokens.push(
          <span key={i} className="text-indigo-400 font-bold">
            {line[i]}
          </span>
        );
        i++;
        continue;
      }

      // Syllables and notes
      if (/[A-Za-z]/.test(line[i])) {
        let noteWord = '';
        const startIdx = i;
        while (i < line.length && /[A-Za-z0-9_₀₁₂₃₄₅⁶⁷⁸⁹⁰¹²³⁴'*^]/.test(line[i])) {
          noteWord += line[i];
          i++;
        }
        tokens.push(
          <span key={startIdx} className="text-stone-100 font-semibold">
            {noteWord}
          </span>
        );
        continue;
      }

      // Whitespace and other characters
      tokens.push(line[i]);
      i++;
    }

    return (
      <span key={lineIdx}>
        {tokens}
        {lineIdx < lines.length - 1 && '\n'}
      </span>
    );
  });
};

/**
 * Custom formatter that aligns measure bar lines ('|') vertically across lines.
 */
function alignAbcBarLines(abcText: string): string {
  const lines = abcText.split('\n');
  const formattedLines: string[] = [];
  
  let currentBlock: string[] = [];
  
  const flushBlock = () => {
    if (currentBlock.length === 0) return;
    
    if (currentBlock.length === 1) {
      formattedLines.push(currentBlock[0]);
      currentBlock = [];
      return;
    }
    
    const barRegex = /(\|\]|\|\||::|:\||\|:|\|)/;
    const parsedLines = currentBlock.map(line => {
      const parts = line.split(barRegex);
      return parts.map((part, index) => {
        if (index % 2 === 0) {
          let trimmed = part.trimEnd();
          if (index > 0 && trimmed.length > 0 && !trimmed.startsWith(' ')) {
            trimmed = ' ' + trimmed.trimStart();
          }
          return trimmed;
        } else {
          return part;
        }
      });
    });
    
    const maxPartsCount = Math.max(...parsedLines.map(p => p.length));
    const maxPartLengths: number[] = Array.from({ length: maxPartsCount }, () => 0);
    
    for (let partIdx = 0; partIdx < maxPartsCount; partIdx++) {
      let maxLen = 0;
      parsedLines.forEach(parts => {
        if (partIdx < parts.length) {
          maxLen = Math.max(maxLen, parts[partIdx].length);
        }
      });
      maxPartLengths[partIdx] = maxLen;
    }
    
    const alignedLines = parsedLines.map(parts => {
      let reconstructed = '';
      for (let partIdx = 0; partIdx < parts.length; partIdx++) {
        const part = parts[partIdx];
        const maxLen = maxPartLengths[partIdx];
        
        if (partIdx % 2 === 0) {
          if (partIdx === parts.length - 1 && part === '') {
            reconstructed += '';
          } else {
            reconstructed += part.padEnd(maxLen, ' ');
          }
        } else {
          reconstructed += part.padEnd(maxLen, ' ');
        }
      }
      return reconstructed;
    });
    
    formattedLines.push(...alignedLines);
    currentBlock = [];
  };
  
  lines.forEach((line) => {
    const trimmedLine = line.trim();
    const isHeader = /^[A-Z]:/i.test(trimmedLine);
    const isComment = trimmedLine.startsWith('%');
    const isEmpty = trimmedLine === '';
    
    if (isHeader || isComment || isEmpty) {
      flushBlock();
      formattedLines.push(line);
    } else {
      currentBlock.push(line);
    }
  });
  
  flushBlock();
  return formattedLines.join('\n');
}

const solfaSyllables = [
  'd', 'di', 'r', 'ri', 'm', 'f', 'fi', 's', 'si', 'l', 'li', 't'
];

/**
 * Computes the pitch class of "d" (Do) for the given key signature,
 * handling major/minor (La-based minor) correctly.
 */
function getTonicPitchClass(key: string): number {
  const clean = key.trim();
  const base = clean.charAt(0).toUpperCase();
  let modifier = '';
  if (clean.length > 1 && (clean.charAt(1) === '#' || clean.charAt(1).toLowerCase() === 'b')) {
    modifier = clean.charAt(1).toLowerCase() === 'b' ? 'b' : '#';
  }
  
  let basePc = 0;
  switch (base) {
    case 'C': basePc = 0; break;
    case 'D': basePc = 2; break;
    case 'E': basePc = 4; break;
    case 'F': basePc = 5; break;
    case 'G': basePc = 7; break;
    case 'A': basePc = 9; break;
    case 'B': basePc = 11; break;
  }
  
  if (modifier === '#') basePc = (basePc + 1) % 12;
  if (modifier === 'b') basePc = (basePc + 11) % 12;
  
  const isMinor = /m|min|minor/i.test(clean);
  if (isMinor) {
    // Relative major tonic is 3 semitones above relative minor root
    return (basePc + 3) % 12;
  }
  return basePc;
}

/**
 * Maps a pitch class 0-11 to a standard note letter and raw accidental.
 */
function getLetterAndAccidentalForPitch(pc: number): { letter: string; accidental?: string } {
  const mappings: { [pc: number]: { letter: string; accidental?: string } } = {
    0: { letter: 'C' },
    1: { letter: 'C', accidental: '^' },
    2: { letter: 'D' },
    3: { letter: 'D', accidental: '^' },
    4: { letter: 'E' },
    5: { letter: 'F' },
    6: { letter: 'F', accidental: '^' },
    7: { letter: 'G' },
    8: { letter: 'G', accidental: '^' },
    9: { letter: 'A' },
    10: { letter: 'A', accidental: '^' },
    11: { letter: 'B' }
  };
  return mappings[pc];
}

/**
 * Parses default note length, e.g., "1/4" -> 0.25
 */
function parseDefaultLength(lengthStr: string): number {
  if (!lengthStr || !lengthStr.includes('/')) return 0.25;
  const parts = lengthStr.split('/');
  const num = parseFloat(parts[0]);
  const den = parseFloat(parts[1]);
  return isNaN(num) || isNaN(den) ? 0.25 : num / den;
}

interface InteractiveRhythmLineProps {
  measure: Measure;
  meter?: string;
  meterDenominator?: number;
  systemIndex: number;
  voiceId: string;
  measureIndex: number;
  selectedNote: SelectedNoteLocation | null;
  onSelectNote: (location: SelectedNoteLocation | null) => void;
  isPlaying: boolean;
  isMuted: boolean;
  isEditorMode: boolean;
  currentTick?: number;
}

const InteractiveRhythmLineComponent: React.FC<InteractiveRhythmLineProps> = ({
  measure,
  meter,
  meterDenominator,
  systemIndex,
  voiceId,
  measureIndex,
  selectedNote,
  onSelectNote,
  isPlaying,
  isMuted,
  isEditorMode,
  currentTick,
}) => {
  const meterStr = meter || (meterDenominator ? `4/${meterDenominator}` : '4/4');
  const cellsData = useMemo(() => analyzeMeasureCells(measure, meterStr), [measure, meterStr]);
  if (cellsData.length === 0) return <>{"\u00A0"}</>;

  const renderedElements: React.ReactNode[] = [];

  cellsData.forEach((cell, cellIdx) => {
    const partElements: React.ReactNode[] = [];

    cell.parts.forEach((part, partIdx) => {
      const itemElements: React.ReactNode[] = [];

      part.items.forEach((item, itemIdx) => {
        const isSelected =
          selectedNote &&
          selectedNote.systemIndex === systemIndex &&
          selectedNote.voiceId === voiceId &&
          selectedNote.measureIndex === measureIndex &&
          item.noteIndex !== undefined &&
          selectedNote.noteIndex === item.noteIndex;

        if (item.noteIndex !== undefined) {
          const noteObj = measure.notes[item.noteIndex];
          const isNoteSounding =
            isPlaying &&
            !isMuted &&
            noteObj &&
            !noteObj.isRest &&
            currentTick !== undefined &&
            currentTick >= noteObj.timestamp &&
            currentTick < noteObj.timestamp + noteObj.durationTicks;

          itemElements.push(
            <button
              key={`item-${cellIdx}-${partIdx}-${itemIdx}`}
              onClick={isEditorMode ? (e) => {
                e.stopPropagation();
                onSelectNote({
                  systemIndex,
                  voiceId,
                  measureIndex,
                  noteIndex: item.noteIndex!
                });
              } : undefined}
              disabled={!isEditorMode}
              className={`inline-block px-1 rounded font-serif font-black text-center ${
                isMuted ? 'pointer-events-none' : ''
              } ${
                isEditorMode && !isMuted ? 'cursor-pointer hover:bg-indigo-100' : ''
              } ${
                isSelected
                  ? 'bg-[#6366F1] text-white ring-2 ring-[#818CF8]/80 font-extrabold z-10 shadow-md'
                  : isNoteSounding
                  ? 'bg-indigo-600 text-white font-extrabold shadow-sm rounded-sm z-10'
                  : isPlaying
                  ? 'text-indigo-900 font-black'
                  : 'text-black'
              }`}
              style={{ minWidth: item.type === 'note' ? undefined : '1.25rem' }}
              title={
                isEditorMode
                  ? `${item.type === 'note' ? `Note: ${item.text}` : item.type === 'rest' ? 'Rest' : 'Sustained note'}. Click to edit.`
                  : item.type === 'note'
                  ? `Note: ${item.text}`
                  : item.type === 'rest'
                  ? 'Rest'
                  : 'Sustained note'
              }
            >
              {item.text}
            </button>
          );
        } else {
          itemElements.push(
            <span
              key={`item-${cellIdx}-${partIdx}-${itemIdx}`}
              className="text-black/20 font-light select-none px-1"
            >
              {item.text}
            </span>
          );
        }

        // Sub-beat separator within half-pulse: comma ','
        if (itemIdx < part.items.length - 1) {
          itemElements.push(
            <span
              key={`comma-${cellIdx}-${partIdx}-${itemIdx}`}
              className="text-black/30 font-light select-none px-0.5"
            >
              ,
            </span>
          );
        }
      });

      partElements.push(
        <span key={`part-${cellIdx}-${partIdx}`} className="inline-flex items-center">
          {itemElements}
        </span>
      );

      // Half-pulse boundary separator across halves: period '.'
      if (partIdx < cell.parts.length - 1) {
        partElements.push(
          <span
            key={`dot-${cellIdx}-${partIdx}`}
            className="text-black/30 font-light select-none px-0.5"
          >
            .
          </span>
        );
      }
    });

    renderedElements.push(
      <span key={`cell-${cellIdx}`} className="inline-flex items-center">
        {partElements}
      </span>
    );

    // Pulse separator: colon ':'
    if (cellIdx < cellsData.length - 1) {
      renderedElements.push(
        <span key={`sep-${cellIdx}`} className="mx-2 text-black/30 font-light select-none">
          :
        </span>
      );
    }
  });

  return <div className="inline-flex items-center select-none">{renderedElements}</div>;
};

const InteractiveRhythmLine = React.memo(InteractiveRhythmLineComponent);

/**
 * Custom visual representation of a barline.
 */
const BarlineGraphic: React.FC<{ type: string; height: number }> = ({ type, height }) => {
  const lineStyle = { height: `${height}px` };

  switch (type) {
    case '||': // Section boundary
      return (
        <div className="flex items-center justify-center gap-1 px-1.5 h-full">
          <div className="w-[2px] bg-black" style={lineStyle} />
          <div className="w-[2px] bg-black" style={lineStyle} />
        </div>
      );
    case '|]': // Final bar
      return (
        <div className="flex items-center justify-center gap-1.5 px-2 h-full">
          <div className="w-[1.5px] bg-black" style={lineStyle} />
          <div className="w-[5px] bg-black rounded-sm" style={lineStyle} />
        </div>
      );
    case ':|': // Repeat end
      return (
        <div className="flex items-center justify-center gap-1 px-1.5 h-full relative">
          <div className="flex flex-col gap-1.5 justify-center mr-1">
            <div className="w-1.5 h-1.5 rounded-full bg-black" />
            <div className="w-1.5 h-1.5 rounded-full bg-black" />
          </div>
          <div className="w-[1.5px] bg-black" style={lineStyle} />
          <div className="w-[4px] bg-black" style={lineStyle} />
        </div>
      );
    case '|:': // Repeat start
      return (
        <div className="flex items-center justify-center gap-1 px-1.5 h-full relative">
          <div className="w-[4px] bg-black" style={lineStyle} />
          <div className="w-[1.5px] bg-black" style={lineStyle} />
          <div className="flex flex-col gap-1.5 justify-center ml-1">
            <div className="w-1.5 h-1.5 rounded-full bg-black" />
            <div className="w-1.5 h-1.5 rounded-full bg-black" />
          </div>
        </div>
      );
    case '::': // Dual repeat
      return (
        <div className="flex items-center justify-center gap-1 px-2 h-full">
          <div className="flex flex-col gap-1.5 justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-black" />
            <div className="w-1.5 h-1.5 rounded-full bg-black" />
          </div>
          <div className="w-[1.5px] bg-black" style={lineStyle} />
          <div className="w-[1.5px] bg-black" style={lineStyle} />
          <div className="flex flex-col gap-1.5 justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-black" />
            <div className="w-1.5 h-1.5 rounded-full bg-black" />
          </div>
        </div>
      );
    case '|': // Standard barline
    default:
      return (
        <div className="flex items-center justify-center px-1.5 h-full">
          <div className="w-[1.5px] bg-black/20" style={lineStyle} />
        </div>
      );
  }
};

/**
 * Container that enforces single-row display and automatically scales
 * measures down if they overflow the available width.
 */
interface AutoscalingMeasuresProps {
  systemHeight: number;
  children: React.ReactNode;
}

const AutoscalingMeasures: React.FC<AutoscalingMeasuresProps> = ({ systemHeight, children }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const updateScale = () => {
      const containerWidth = container.getBoundingClientRect().width;
      
      const prevTransform = content.style.transform;
      content.style.transform = 'none';
      const contentWidth = content.scrollWidth || content.getBoundingClientRect().width;
      content.style.transform = prevTransform;

      if (contentWidth > containerWidth && containerWidth > 0) {
        const newScale = containerWidth / contentWidth;
        setScale(newScale);
        content.style.transform = `scale(${newScale})`;
      } else {
        setScale(1);
        content.style.transform = 'none';
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      updateScale();
    });

    resizeObserver.observe(container);
    resizeObserver.observe(content);

    updateScale();

    return () => {
      resizeObserver.disconnect();
    };
  }, [children]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-hidden relative"
      style={{ height: `${systemHeight * scale}px`, transition: 'height 150ms ease-out' }}
    >
      <div
        ref={contentRef}
        className="flex flex-row flex-nowrap justify-between w-max min-w-full origin-top-left transition-transform duration-150 ease-out"
        style={{ height: `${systemHeight}px` }}
      >
        {children}
      </div>
    </div>
  );
};

export const ScoreRenderer: React.FC<ScoreRendererProps> = ({
  score,
  abcText,
  setAbcText,
  warnings,
  currentTick,
  currentEighth,
  fontSize,
  setFontSize,
  scale,
  setScale,
  mutedVoices,
  toggleMute,
  selectedNote,
  onSelectNote,
  onUpdateScore,
  studioMode,
  setStudioMode,
  playerRef,
  onSeekTick,
  isExpanded,
  onToggleExpand,
  settings,
  onOpenSettings,
  onUpdateSettings,
  isFullscreen = false,
  onToggleFullscreen,
  isPlaying = false,
  onPlay,
  onPause,
  onStop,
}) => {
  const [showHelp, setShowHelp] = useState<boolean>(false);

  // Split View Resizer state (clamped between 20% and 80%, default 50%)
  const [splitRatio, setSplitRatio] = useState<number>(50);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const isDraggingSplitRef = useRef<boolean>(false);

  const handleSplitDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingSplitRef.current = true;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingSplitRef.current || !splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      const currentY = moveEvent.clientY - rect.top;
      const percentage = (currentY / rect.height) * 100;
      const clamped = Math.max(20, Math.min(80, percentage));
      setSplitRatio(clamped);
    };

    const handleMouseUp = () => {
      isDraggingSplitRef.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Piano Roll state (respects settings if provided)
  const [localShowPianoRoll, setLocalShowPianoRoll] = useState<boolean>(false);
  const showPianoRoll = studioMode === 'pianoroll' || (settings ? settings.showPianoRoll : localShowPianoRoll);
  const setShowPianoRoll = (val: boolean | ((prev: boolean) => boolean)) => {
    const nextVal = typeof val === 'function' ? val(showPianoRoll) : val;
    setLocalShowPianoRoll(nextVal);
    if (nextVal) {
      setStudioMode('pianoroll');
    } else if (studioMode === 'pianoroll') {
      setStudioMode('read');
    }
    if (onUpdateSettings && settings) {
      onUpdateSettings({ ...settings, showPianoRoll: nextVal });
    }
  };

  // Tonic Sol-fa Legend state (respects settings if provided)
  const [localShowLegend, setLocalShowLegend] = useState<boolean>(false);
  const showLegend = settings ? settings.showReferenceLegend : localShowLegend;
  const setShowLegend = (val: boolean | ((prev: boolean) => boolean)) => {
    const nextVal = typeof val === 'function' ? val(showLegend) : val;
    setLocalShowLegend(nextVal);
    if (onUpdateSettings && settings) {
      onUpdateSettings({ ...settings, showReferenceLegend: nextVal });
    }
  };

  const layoutRows = useMemo<({ type: 'voice'; voice: any } | { type: 'divider' })[]>(() => {
    if (!score) return [];
    
    const rows: ({ type: 'voice'; voice: any } | { type: 'divider' })[] = [];
    const groupedVoiceIds = new Set<string>();
    
    // Process groups
    score.voicePairingGroups.forEach((group, gIdx) => {
      let groupHasVoices = false;
      group.forEach(voiceId => {
        const voice = score.voices.find(v => v.id === voiceId);
        if (voice) {
          rows.push({ type: 'voice', voice });
          groupedVoiceIds.add(voiceId);
          groupHasVoices = true;
        }
      });
      
      if (groupHasVoices && gIdx < score.voicePairingGroups.length - 1) {
        rows.push({ type: 'divider' });
      }
    });
    
    // Add remaining ungrouped voices
    const ungrouped = score.voices.filter(v => !groupedVoiceIds.has(v.id));
    if (ungrouped.length > 0) {
      if (rows.length > 0) {
        rows.push({ type: 'divider' });
      }
      ungrouped.forEach(voice => {
        rows.push({ type: 'voice', voice });
      });
    }
    
    return rows;
  }, [score]);

  // Source Editor Tab: 'solfa' or 'abc'
  const [sourceTab, setSourceTab] = useState<'solfa' | 'abc'>('solfa');
  // Live Preview is OFF by default (as requested) and can be toggled via Settings menu
  const [localShowLivePreview, setLocalShowLivePreview] = useState<boolean>(false);
  const showLivePreview = settings ? settings.showLivePreview : localShowLivePreview;
  const [solfaText, setSolfaText] = useState<string>(() => score ? serializeScoreToSolfa(score) : '');
  const [localAutoFormatOnBlur, setLocalAutoFormatOnBlur] = useState<boolean>(false);
  const autoFormatOnBlur = settings ? settings.autoFormatOnBlur : localAutoFormatOnBlur;
  const setAutoFormatOnBlur = (val: boolean) => {
    setLocalAutoFormatOnBlur(val);
    if (settings && onUpdateSettings) {
      onUpdateSettings({ ...settings, autoFormatOnBlur: val });
    }
  };
  const isEditingSolfaRef = useRef<boolean>(false);
  const solfaEditTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Synchronized scrolling for ABC IDE
  const editorTextareaRef = useRef<HTMLTextAreaElement>(null);
  const editorHighlightRef = useRef<HTMLPreElement>(null);
  const editorGutterRef = useRef<HTMLDivElement>(null);

  // Synchronized scrolling for Solfa IDE
  const solfaTextareaRef = useRef<HTMLTextAreaElement>(null);
  const solfaHighlightRef = useRef<HTMLPreElement>(null);
  const solfaGutterRef = useRef<HTMLDivElement>(null);

  // Clean up any pending solfa editing timer on unmount
  useEffect(() => {
    return () => {
      if (solfaEditTimerRef.current) {
        clearTimeout(solfaEditTimerRef.current);
      }
    };
  }, []);

  const handleEditorScroll = () => {
    if (editorTextareaRef.current) {
      const { scrollTop, scrollLeft } = editorTextareaRef.current;
      if (editorHighlightRef.current) {
        editorHighlightRef.current.scrollTop = scrollTop;
        editorHighlightRef.current.scrollLeft = scrollLeft;
      }
      if (editorGutterRef.current) {
        editorGutterRef.current.scrollTop = scrollTop;
      }
    }
  };

  const handleSolfaScroll = () => {
    if (solfaTextareaRef.current) {
      const { scrollTop, scrollLeft } = solfaTextareaRef.current;
      if (solfaHighlightRef.current) {
        solfaHighlightRef.current.scrollTop = scrollTop;
        solfaHighlightRef.current.scrollLeft = scrollLeft;
      }
      if (solfaGutterRef.current) {
        solfaGutterRef.current.scrollTop = scrollTop;
      }
    }
  };

  // Sync solfa text when score changes from external sources (e.g. interactive editor or example switch)
  useEffect(() => {
    if (score && !isEditingSolfaRef.current) {
      setSolfaText(serializeScoreToSolfa(score));
    }
  }, [score]);

  useEffect(() => {
    if (studioMode === 'source') {
      if (sourceTab === 'abc' && editorTextareaRef.current) {
        handleEditorScroll();
      } else if (sourceTab === 'solfa' && solfaTextareaRef.current) {
        handleSolfaScroll();
      }
    }
  }, [abcText, solfaText, studioMode, sourceTab]);

  const handleSolfaChange = (newText: string) => {
    isEditingSolfaRef.current = true;
    if (solfaEditTimerRef.current) {
      clearTimeout(solfaEditTimerRef.current);
    }
    setSolfaText(newText);
    try {
      const { abcText: newAbc } = parseSolfaToAbc(newText);
      if (newAbc) {
        setAbcText(newAbc);
      }
    } catch (e) {
      // In-progress typing syntax errors handled gracefully
    }
    solfaEditTimerRef.current = setTimeout(() => {
      isEditingSolfaRef.current = false;
      solfaEditTimerRef.current = null;
    }, 1200);
  };

  const handleAlignSolfa = () => {
    isEditingSolfaRef.current = true;
    if (solfaEditTimerRef.current) {
      clearTimeout(solfaEditTimerRef.current);
    }
    const aligned = alignSolfaGrid(solfaText);
    setSolfaText(aligned);
    try {
      const { abcText: newAbc } = parseSolfaToAbc(aligned);
      if (newAbc) {
        setAbcText(newAbc);
      }
    } catch (e) {}
    solfaEditTimerRef.current = setTimeout(() => {
      isEditingSolfaRef.current = false;
      solfaEditTimerRef.current = null;
    }, 800);
  };

  const handleSolfaBlur = () => {
    if (solfaEditTimerRef.current) {
      clearTimeout(solfaEditTimerRef.current);
      solfaEditTimerRef.current = null;
    }
    isEditingSolfaRef.current = false;
    if (autoFormatOnBlur) {
      handleAlignSolfa();
    }
  };

  // 1. Calculate measure tick ranges to highlight active measures
  const measureRanges = useMemo(() => getScoreMeasureRanges(score), [score]);

  // Find currently active measure
  const activeMeasure = useMemo(() => {
    const playhead = currentTick !== undefined ? currentTick : (currentEighth || 0);
    return findActiveMeasureRange(measureRanges, playhead);
  }, [measureRanges, currentTick, currentEighth]);

  const selectedNoteObj = useMemo(() => {
    if (!score || !selectedNote) return null;
    try {
      const system = score.systems[selectedNote.systemIndex];
      const voice = system?.voices[selectedNote.voiceId];
      const measure = voice?.measures[selectedNote.measureIndex];
      const note = measure?.notes[selectedNote.noteIndex];
      return note || null;
    } catch {
      return null;
    }
  }, [score, selectedNote]);

  const handleUpdateNoteSyllable = (syllable: string) => {
    if (!score || !selectedNote) return;
    
    const newScore = JSON.parse(JSON.stringify(score)) as ParsedScore;
    const note = newScore.systems[selectedNote.systemIndex]
      .voices[selectedNote.voiceId]
      .measures[selectedNote.measureIndex]
      .notes[selectedNote.noteIndex];
      
    if (syllable === 'rest') {
      note.isRest = true;
      note.rawLetter = 'z';
      note.rawAccidental = undefined;
      note.syllable = '·';
    } else {
      note.isRest = false;
      note.syllable = syllable;
      const tonicPc = getTonicPitchClass(score.key);
      const degreeIdx = solfaSyllables.indexOf(syllable);
      if (degreeIdx !== -1) {
        const targetPc = (tonicPc + degreeIdx) % 12;
        const mapping = getLetterAndAccidentalForPitch(targetPc);
        note.rawLetter = mapping.letter;
        note.rawAccidental = mapping.accidental;
      }
    }
    
    onUpdateScore(newScore);
  };

  const handleUpdateNoteOctave = (direction: number) => {
    if (!score || !selectedNote || !selectedNoteObj) return;
    
    const currentOct = selectedNoteObj.octaveNum !== undefined ? selectedNoteObj.octaveNum : 4;
    const newOct = Math.min(7, Math.max(2, currentOct + direction));
    if (newOct === currentOct) return;
    
    const newScore = JSON.parse(JSON.stringify(score)) as ParsedScore;
    const note = newScore.systems[selectedNote.systemIndex]
      .voices[selectedNote.voiceId]
      .measures[selectedNote.measureIndex]
      .notes[selectedNote.noteIndex];
      
    note.octaveNum = newOct;
    onUpdateScore(newScore);
  };

  const handleUpdateNoteDuration = (mult: number) => {
    if (!score || !selectedNote) return;
    
    const newScore = JSON.parse(JSON.stringify(score)) as ParsedScore;
    const note = newScore.systems[selectedNote.systemIndex]
      .voices[selectedNote.voiceId]
      .measures[selectedNote.measureIndex]
      .notes[selectedNote.noteIndex];
      
    const defaultLengthVal = parseDefaultLength(score.defaultLength);
    note.durationTicks = Math.round(mult * defaultLengthVal * TICKS_PER_WHOLE_NOTE);
    if (note.durationTicks <= 0) note.durationTicks = 1;
    
    onUpdateScore(newScore);
  };

  if (!score || !score.voices || score.voices.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-stone-500 p-8 bg-[#0F1115]">
        <p className="text-xl font-serif italic text-white/40">No score loaded</p>
        <p className="text-xs text-white/20 mt-1">Enter ABC notation or load a score on the left.</p>
      </div>
    );
  }

  // Parse time signature denominator for rhythm subdivision (default to 4)
  const meterDen = parseInt(score.meter.split('/')[1], 10) || 4;

  // Render bracket groupings on the left of systems
  const renderBrackets = (system: System, group: string[], index: number) => {
    const presentVoiceIds = score.voices
      .map((v) => v.id)
      .filter((vid) => group.includes(vid) && system.voices[vid]);

    if (presentVoiceIds.length <= 1) return null;

    // Curly bracket grouping
    return (
      <div
        className="absolute -left-4 top-1 bottom-1 w-2.5 text-black transition-all"
        key={`bracket-group-${index}`}
      >
        <svg
          className="w-full h-full"
          viewBox="0 0 10 100"
          preserveAspectRatio="none"
        >
          <path
            d="M8,2 C4,2 2,6 2,12 L2,44 C2,48 5,50 8,50 C5,50 2,52 2,56 L2,88 C2,94 4,98 8,98"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
    );
  };

  const renderNoteInspector = () => {
    if (!selectedNote || !selectedNoteObj || !score) return null;
    return (
      <div className="mx-auto max-w-4xl mb-6 bg-[#161920] border border-white/10 rounded-2xl p-5 shadow-2xl relative text-white sticky top-0 z-30 transition-all duration-300">
        {/* Header info */}
        <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400">
              <Music size={18} />
            </div>
            <div>
              <h3 className="font-sans font-bold text-sm tracking-tight">
                Inline Note Inspector & Visual Editor
              </h3>
              <p className="text-[11px] text-stone-400 mt-0.5">
                Editing <span className="text-indigo-400 font-semibold">{score.voices.find(v => v.id === selectedNote.voiceId)?.name || selectedNote.voiceId}</span> voice | Measure <span className="text-indigo-400 font-semibold">{selectedNote.measureIndex + 1}</span>, Note <span className="text-indigo-400 font-semibold">{selectedNote.noteIndex + 1}</span>
              </p>
            </div>
          </div>
          <button
            onClick={() => onSelectNote(null)}
            className="p-1.5 hover:bg-white/10 rounded-full text-stone-400 hover:text-white transition-colors cursor-pointer"
            title="Close Inspector"
          >
            <X size={16} />
          </button>
        </div>

        {/* Editing grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Col 1: Solfa Syllables Select */}
          <div className="lg:col-span-2">
            <label className="block text-xs font-semibold text-stone-400 uppercase tracking-wider mb-2.5">
              Tonic Sol-fa Syllable (Scale Degree)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {solfaSyllables.map((syl) => {
                const isSelected = !selectedNoteObj.isRest && selectedNoteObj.syllable === syl;
                return (
                  <button
                    key={`syl-btn-${syl}`}
                    onClick={() => handleUpdateNoteSyllable(syl)}
                    className={`px-3.5 py-2 rounded-xl text-sm font-bold transition-all duration-150 cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-600 text-white shadow-lg ring-2 ring-indigo-400/50 scale-[1.04]'
                        : 'bg-white/5 text-stone-300 border border-white/5 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {syl}
                  </button>
                );
              })}
              <button
                onClick={() => handleUpdateNoteSyllable('rest')}
                className={`px-3.5 py-2 rounded-xl text-sm font-bold transition-all duration-150 cursor-pointer ${
                  selectedNoteObj.isRest
                    ? 'bg-red-600 text-white shadow-lg ring-2 ring-red-400/50 scale-[1.04]'
                    : 'bg-white/5 text-stone-300 border border-white/5 hover:bg-white/10 hover:text-white'
                }`}
              >
                Rest (·)
              </button>
            </div>
          </div>

          {/* Col 2: Octave and Duration */}
          <div className="space-y-4">
            {/* Octave Controls */}
            <div>
              <label className="block text-xs font-semibold text-stone-400 uppercase tracking-wider mb-2">
                Octave Register
              </label>
              <div className="flex items-center gap-2 bg-black/30 p-1.5 rounded-xl border border-white/5 max-w-[180px]">
                <button
                  onClick={() => handleUpdateNoteOctave(-1)}
                  className="flex-1 py-1.5 hover:bg-white/5 rounded-lg text-stone-300 hover:text-white font-black text-sm cursor-pointer"
                  title="Lower octave"
                >
                  -
                </button>
                <span className="px-3 font-mono font-bold text-xs text-indigo-400">
                  Octave {selectedNoteObj.octaveNum !== undefined ? selectedNoteObj.octaveNum : 4}
                </span>
                <button
                  onClick={() => handleUpdateNoteOctave(1)}
                  className="flex-1 py-1.5 hover:bg-white/5 rounded-lg text-stone-300 hover:text-white font-black text-sm cursor-pointer"
                  title="Raise octave"
                >
                  +
                </button>
              </div>
            </div>

            {/* Duration Controls */}
            <div>
              <label className="block text-xs font-semibold text-stone-400 uppercase tracking-wider mb-2">
                Note Duration (Beats)
              </label>
              <select
                value={selectedNoteObj ? (selectedNoteObj.durationTicks / (parseDefaultLength(score.defaultLength) * TICKS_PER_WHOLE_NOTE)) : 1.0}
                onChange={(e) => handleUpdateNoteDuration(parseFloat(e.target.value))}
                className="w-full max-w-[200px] bg-black/40 border border-white/10 text-stone-200 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none cursor-pointer font-sans"
              >
                <option value="4.0">Whole Note (4 beats)</option>
                <option value="3.0">Dotted Half (3 beats)</option>
                <option value="2.0">Half Note (2 beats)</option>
                <option value="1.5">Dotted Quarter (1.5 beats)</option>
                <option value="1.0">Quarter Note (1 beat)</option>
                <option value="0.75">Dotted Eighth (0.75 beats)</option>
                <option value="0.5">Eighth Note (0.5 beats)</option>
                <option value="0.25">Sixteenth Note (0.25 beats)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Tip/Info footer */}
        <div className="mt-4 pt-3 border-t border-white/5 flex items-center gap-2 text-[11px] text-stone-400">
          <HelpCircle size={12} className="text-indigo-400" />
          <span>
            Tip: Changes here will automatically update the raw ABC text on the left, sync the player, and re-draw the solfas.
          </span>
        </div>
      </div>
    );
  };

  const renderPaperSheet = (isInteractive: boolean) => {
    if (!score) return null;
    return (
      <div
        className="mx-auto max-w-4xl bg-[#FDFCF8] text-black border border-black/5 shadow-2xl rounded-2xl p-6 sm:p-10 font-sans relative transition-all overflow-hidden"
        style={{
          transform: `scale(${scale})`,
          transformOrigin: 'top center',
          marginBottom: `${(scale - 1) * 100}%`
        }}
      >
        {/* Subtle Watermark */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.03] select-none z-0">
          <h1 className="text-[14rem] md:text-[20rem] font-black tracking-tighter">SOLFA</h1>
        </div>

        <div className="relative z-10">
          {/* Piece Headers */}
          <div className="mb-12 border-b-2 border-black/10 pb-4 flex justify-between items-end">
            <div>
              <h1 className="font-serif italic font-medium text-3xl tracking-tight text-black">
                {score.title}
              </h1>
              {score.composer && (
                <p className="font-serif italic text-black/60 text-sm mt-1">
                  Composer: {score.composer}
                </p>
              )}
            </div>
            <div className="text-right uppercase tracking-widest font-bold text-[10px] text-black/40">
              <p>Key: {score.key}</p>
              <p>Meter: {score.meter}</p>
            </div>
          </div>

          {/* Voice Mute / Solo Practice Panel */}
          <div className="mb-8 p-4 bg-black/5 border border-black/5 rounded-xl flex flex-wrap items-center gap-3 text-xs text-black/60">
            <span className="font-bold uppercase tracking-wider text-[10px] mr-2 text-black/50">Practice Tracks:</span>
            {score.voices.map((v) => {
              const active = !mutedVoices[v.id];
              return (
                <button
                  key={`practice-voice-${v.id}`}
                  onClick={() => toggleMute(v.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 ${
                    active
                      ? 'bg-indigo-600 border border-indigo-700 text-white shadow-sm'
                      : 'bg-black/5 border border-black/10 text-black/40'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      active ? 'bg-white' : 'bg-black/30'
                    }`}
                  />
                  {v.name}
                </button>
              );
            })}
          </div>

          {/* Systems Loop */}
          <div className="flex flex-col gap-12 select-none">
            {score.systems.map((system) => {
              const refVoice = score.voices[0]?.id || '';
              const systemMeasuresCount = Math.max(
                0,
                ...score.voices.map(voice => system.voices[voice.id]?.measures.length || 0)
              );

              const rowHeight = fontSize * 2.2;
              const dividerHeight = 12;
              const voiceCount = layoutRows.filter(r => r.type === 'voice').length;
              const dividerCount = layoutRows.filter(r => r.type === 'divider').length;
              const systemHeight = (voiceCount * rowHeight) + (dividerCount * dividerHeight);

              return (
                <div
                  key={`system-${system.systemIndex}`}
                  className="flex flex-col border-b border-dashed border-black/10 pb-8 last:border-b-0"
                >
                  {/* System Header with Index */}
                  <div className="text-[10px] font-mono uppercase tracking-widest text-black/30 mb-2 font-bold">
                    System {system.systemIndex + 1}
                  </div>

                  {/* Main Alignment Block with Autoscale wrapping both labels and measures */}
                  <div className="flex items-start w-full">
                    <AutoscalingMeasures systemHeight={systemHeight}>
                      {/* Bracing & Voice Labels block */}
                      <div className="w-20 flex-shrink-0 relative mr-6" style={{ height: `${systemHeight}px` }}>
                        {score.voicePairingGroups.map((group, gIdx) =>
                          renderBrackets(system, group, gIdx)
                        )}

                        <div className="flex flex-col h-full justify-start pr-2 text-right">
                          {layoutRows.map((row, rIdx) => {
                            if (row.type === 'divider') {
                              return (
                                <div 
                                  key={`label-div-${system.systemIndex}-${rIdx}`} 
                                  style={{ height: `${dividerHeight}px` }}
                                />
                              );
                            }
                            const voice = row.voice;
                            const isMuted = !!mutedVoices[voice.id];
                            return (
                              <div
                                key={`label-${system.systemIndex}-${voice.id}`}
                                className="font-serif italic font-bold transition-opacity duration-200 text-black/80"
                                style={{
                                  fontSize: `${fontSize * 0.85}px`,
                                  height: `${rowHeight}px`,
                                  lineHeight: `${rowHeight}px`,
                                  opacity: isMuted ? 0.25 : 1.0
                                }}
                              >
                                {voice.name}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Measures Block */}
                      {Array.from({ length: systemMeasuresCount }).map((_, mIndex) => {
                        const isPlaying =
                          activeMeasure &&
                          activeMeasure.systemIndex === system.systemIndex &&
                          activeMeasure.measureIndex === mIndex;

                        const barType = (refVoice && system.voices[refVoice]?.barTypes?.[mIndex]) || '|';

                        return (
                          <div
                            key={`measure-${system.systemIndex}-${mIndex}`}
                            className={`flex items-stretch rounded-lg border transition-colors duration-150 ${
                              isPlaying
                                ? 'bg-indigo-50/80 border-indigo-300 ring-2 ring-indigo-500/20 shadow-sm'
                                : 'border-transparent'
                            }`}
                          >
                            <div className="flex flex-col justify-start px-2" style={{ height: `${systemHeight}px` }}>
                              {layoutRows.map((row, rIdx) => {
                                if (row.type === 'divider') {
                                  return (
                                    <div 
                                      key={`notes-div-${system.systemIndex}-${mIndex}-${rIdx}`}
                                      className="flex items-center w-full px-4" 
                                      style={{ height: `${dividerHeight}px` }}
                                    >
                                      <div className="w-full border-t border-black/15" />
                                    </div>
                                  );
                                }
                                const voice = row.voice;
                                const voiceLine = system.voices[voice.id];
                                const measure = voiceLine?.measures[mIndex];
                                const isMuted = !!mutedVoices[voice.id];

                                return (
                                  <div
                                    key={`notes-${system.systemIndex}-${mIndex}-${voice.id}`}
                                    className="font-serif font-black text-center whitespace-nowrap px-4"
                                    style={{
                                      fontSize: `${fontSize}px`,
                                      height: `${rowHeight}px`,
                                      lineHeight: `${rowHeight}px`,
                                      opacity: isMuted ? 0.15 : 1.0
                                    }}
                                  >
                                    {measure ? (
                                      <InteractiveRhythmLine
                                        measure={measure}
                                        meter={score.meter}
                                        meterDenominator={meterDen}
                                        systemIndex={system.systemIndex}
                                        voiceId={voice.id}
                                        measureIndex={mIndex}
                                        selectedNote={selectedNote}
                                        onSelectNote={onSelectNote}
                                        isPlaying={isPlaying}
                                        isMuted={isMuted}
                                        isEditorMode={isInteractive}
                                        currentTick={currentTick}
                                      />
                                    ) : (
                                      '\u00A0'
                                    )}
                                  </div>
                                );
                              })}
                            </div>

                            <BarlineGraphic type={barType} height={systemHeight} />
                          </div>
                        );
                      })}
                    </AutoscalingMeasures>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Symbol Legend Box (Collapsible to keep interface clean and easy to scan) */}
          <div className="mt-12 pt-6 border-t border-black/10 select-none">
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => setShowLegend((prev) => !prev)}
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-black/5 hover:bg-black/10 text-black/70 hover:text-black rounded-full text-xs font-serif italic transition-colors cursor-pointer"
                title={showLegend ? 'Hide Sol-fa Reference Legend' : 'Show Sol-fa Reference Legend'}
              >
                <span>Tonic Sol-fa Reference Legend</span>
                {showLegend ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            </div>
            {showLegend && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-4 bg-black/5 p-5 rounded-xl border border-black/5 text-[11px] text-black/60 font-sans transition-all">
                <div>
                  <span className="font-mono font-bold text-black">d r m f s l t</span>
                  <p className="mt-1">Movable-Do scale degrees. Tonic = d.</p>
                </div>
                <div>
                  <span className="font-mono font-bold text-black">di ri fi si li</span>
                  <p className="mt-1">Raised passing chromatic degrees.</p>
                </div>
                <div>
                  <span className="font-mono font-bold text-black">ḋ (d&#x307;) / ḍ (d&#x323;)</span>
                  <p className="mt-1">Octave marks: dot above = high, dot below = low.</p>
                </div>
                <div>
                  <span className="font-mono font-bold text-black">:  ·  -  |  ‖</span>
                  <p className="mt-1">
                    : divides beats. · rest. - held beat. | bar. ‖ section end.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-[#13151A] border border-white/5 rounded-xl overflow-hidden shadow-2xl">
      {/* Renderer Controls Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5 bg-[#0F1115] border-b border-white/5">
        <div>
          <h2 className="text-white font-sans font-black text-xs uppercase tracking-wider">
            Sol-fa Sheet Music
          </h2>
          <p className="text-[11px] text-stone-400 font-sans mt-0.5">
            Key: <span className="font-bold text-[#6366F1]">{score.key}</span> | Meter:{' '}
            <span className="font-semibold text-stone-300">{score.meter}</span> | L:{' '}
            <span className="font-semibold text-stone-300">{score.defaultLength}</span>
          </p>
        </div>

        {/* Workspace Switcher & Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Unified Workspace Segmented Control */}
          <div className="flex items-center bg-black/50 p-1 rounded-xl border border-white/10 shadow-inner overflow-x-auto max-w-full">
            <Tooltip content="Score View" description="Clean Tonic Sol-fa performance score layout" side="bottom">
              <button
                onClick={() => {
                  if (solfaEditTimerRef.current) {
                    clearTimeout(solfaEditTimerRef.current);
                    solfaEditTimerRef.current = null;
                  }
                  isEditingSolfaRef.current = false;
                  setShowPianoRoll(false);
                  setStudioMode('read');
                  onSelectNote(null);
                }}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-sans font-black uppercase tracking-wider transition-all duration-200 flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                  studioMode === 'read' && !showPianoRoll
                    ? 'bg-indigo-600 text-white shadow-md ring-1 ring-indigo-400/30'
                    : 'text-stone-400 hover:text-white'
                }`}
                aria-label="Score View"
              >
                <Eye size={12} />
                <span>Score</span>
              </button>
            </Tooltip>

            <Tooltip content="Piano Roll" description="Interactive 4-voice chromatic sequencer editor" side="bottom">
              <button
                onClick={() => {
                  if (solfaEditTimerRef.current) {
                    clearTimeout(solfaEditTimerRef.current);
                    solfaEditTimerRef.current = null;
                  }
                  isEditingSolfaRef.current = false;
                  onSelectNote(null);
                  setStudioMode('pianoroll');
                  setShowPianoRoll(true);
                }}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-sans font-black uppercase tracking-wider transition-all duration-200 flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                  studioMode === 'pianoroll' || (showPianoRoll && studioMode !== 'split')
                    ? 'bg-indigo-600 text-white shadow-md ring-1 ring-indigo-400/30'
                    : 'text-stone-400 hover:text-white'
                }`}
                aria-label="Piano Roll View"
              >
                <span className="text-xs">🎹</span>
                <span>Piano Roll</span>
              </button>
            </Tooltip>

            <Tooltip content="Split View" description="Simultaneous sheet music and Piano Roll with resizer" side="bottom">
              <button
                onClick={() => {
                  if (solfaEditTimerRef.current) {
                    clearTimeout(solfaEditTimerRef.current);
                    solfaEditTimerRef.current = null;
                  }
                  isEditingSolfaRef.current = false;
                  onSelectNote(null);
                  setStudioMode('split');
                }}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-sans font-black uppercase tracking-wider transition-all duration-200 flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                  studioMode === 'split'
                    ? 'bg-indigo-600 text-white shadow-md ring-1 ring-indigo-400/30'
                    : 'text-stone-400 hover:text-white'
                }`}
                aria-label="Split View"
              >
                <Columns size={12} />
                <span>Split View</span>
              </button>
            </Tooltip>

            <Tooltip content="Visual Edit" description="Click on notes to inspect pitches and syllables" side="bottom">
              <button
                onClick={() => {
                  if (solfaEditTimerRef.current) {
                    clearTimeout(solfaEditTimerRef.current);
                    solfaEditTimerRef.current = null;
                  }
                  isEditingSolfaRef.current = false;
                  setShowPianoRoll(false);
                  setStudioMode('interactive');
                }}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-sans font-black uppercase tracking-wider transition-all duration-200 flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                  studioMode === 'interactive' && !showPianoRoll
                    ? 'bg-indigo-600 text-white shadow-md ring-1 ring-indigo-400/30'
                    : 'text-stone-400 hover:text-white'
                }`}
                aria-label="Visual Edit"
              >
                <Edit2 size={12} />
                <span>Visual Edit</span>
              </button>
            </Tooltip>

            <Tooltip content="Source Code" description="Directly edit Tonic Sol-fa and ABC text notation" side="bottom">
              <button
                onClick={() => {
                  setShowPianoRoll(false);
                  setStudioMode('source');
                  onSelectNote(null);
                  if (score && !isEditingSolfaRef.current) {
                    setSolfaText(serializeScoreToSolfa(score));
                  }
                }}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-sans font-black uppercase tracking-wider transition-all duration-200 flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                  studioMode === 'source'
                    ? 'bg-indigo-600 text-white shadow-md ring-1 ring-indigo-400/30'
                    : 'text-stone-400 hover:text-white'
                }`}
                aria-label="Source Editor"
              >
                <Code size={12} />
                <span>Source</span>
              </button>
            </Tooltip>

            <Tooltip content="Lyrics View" description="View hymn poetry and stanzas" side="bottom">
              <button
                onClick={() => {
                  if (solfaEditTimerRef.current) {
                    clearTimeout(solfaEditTimerRef.current);
                    solfaEditTimerRef.current = null;
                  }
                  isEditingSolfaRef.current = false;
                  setShowPianoRoll(false);
                  setStudioMode('lyrics');
                  onSelectNote(null);
                }}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-sans font-black uppercase tracking-wider transition-all duration-200 flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                  studioMode === 'lyrics'
                    ? 'bg-indigo-600 text-white shadow-md ring-1 ring-indigo-400/30'
                    : 'text-stone-400 hover:text-white'
                }`}
                aria-label="Lyrics View"
              >
                <FileText size={12} />
                <span>Lyrics</span>
              </button>
            </Tooltip>
          </div>
          
          {/* Zoom Controls */}
          <div className="flex items-center gap-2 bg-black/40 px-2 py-1 rounded-xl border border-white/10 shadow-inner">
            <Tooltip content="Zoom Out" description="Reduce score display scale" side="bottom">
              <button
                onClick={() => setScale(Math.max(0.6, scale - 0.1))}
                className="p-1 hover:bg-white/10 rounded-lg text-stone-300 hover:text-white transition-colors cursor-pointer"
                aria-label="Zoom Out"
              >
                <ZoomOut size={13} />
              </button>
            </Tooltip>
            <span className="text-[11px] font-mono font-bold text-[#6366F1] w-9 text-center">
              {Math.round(scale * 100)}%
            </span>
            <Tooltip content="Zoom In" description="Enlarge score display scale" side="bottom">
              <button
                onClick={() => setScale(Math.min(1.8, scale + 0.1))}
                className="p-1 hover:bg-white/10 rounded-lg text-stone-300 hover:text-white transition-colors cursor-pointer"
                aria-label="Zoom In"
              >
                <ZoomIn size={13} />
              </button>
            </Tooltip>
          </div>

          {/* Font Size Controls */}
          <div className="flex items-center gap-1.5 bg-black/40 px-2 py-1 rounded-xl border border-white/10 shadow-inner">
            <Tooltip content="Decrease Font" description="Reduce notation font size" side="bottom">
              <button
                onClick={() => setFontSize(Math.max(12, fontSize - 2))}
                className="p-1 hover:bg-white/10 rounded-lg text-stone-300 hover:text-white transition-colors cursor-pointer"
                aria-label="Decrease Font Size"
              >
                <Type size={11} className="scale-75" />
              </button>
            </Tooltip>
            <span className="text-[11px] font-mono font-bold text-[#6366F1] w-10 text-center">
              {fontSize}px
            </span>
            <Tooltip content="Increase Font" description="Enlarge notation font size" side="bottom">
              <button
                onClick={() => setFontSize(Math.min(28, fontSize + 2))}
                className="p-1 hover:bg-white/10 rounded-lg text-stone-300 hover:text-white transition-colors cursor-pointer"
                aria-label="Increase Font Size"
              >
                <Type size={13} />
              </button>
            </Tooltip>
          </div>

          {/* Complete Full Screen Toggle */}
          {onToggleFullscreen && (
            <Tooltip content={isFullscreen ? 'Exit Full Screen' : 'Full Screen'} shortcut="F" description="Expand workspace to full display" side="bottom">
              <button
                type="button"
                onClick={onToggleFullscreen}
                className={`p-2 rounded-xl cursor-pointer transition-all border shadow-sm ${
                  isFullscreen
                    ? 'bg-indigo-600 border-indigo-400 text-white shadow-[0_0_12px_rgba(99,102,241,0.5)]'
                    : 'bg-black/40 hover:bg-white/10 text-stone-300 hover:text-white border-white/10'
                }`}
                aria-label="Toggle Full Screen"
              >
                {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
            </Tooltip>
          )}

          {/* Settings Menu Button */}
          {onOpenSettings && (
            <Tooltip content="Settings" shortcut="⌘," description="View preferences and layout" side="bottom">
              <button
                type="button"
                onClick={onOpenSettings}
                className="p-2 hover:bg-white/10 rounded-xl text-stone-300 hover:text-white transition-colors cursor-pointer border border-white/10 bg-black/40 shadow-inner"
                aria-label="Settings"
              >
                <Settings size={14} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {studioMode === 'pianoroll' && score ? (
        <div className="flex-1 overflow-hidden">
          <PianoRoll
            score={score}
            gridOpacity={settings?.pianoRollGridOpacity}
            onUpdateScore={onUpdateScore}
            autoFormatOnBlur={autoFormatOnBlur}
            onToggleAutoFormatOnBlur={setAutoFormatOnBlur}
            currentTick={currentTick}
            playerRef={playerRef}
            onSeekTick={onSeekTick}
            onClose={() => setStudioMode('read')}
            isExpanded={isExpanded}
            onToggleExpand={onToggleExpand}
            isFullscreen={isFullscreen}
            onToggleFullscreen={onToggleFullscreen}
            isPlaying={isPlaying}
            onPlay={onPlay}
            onPause={onPause}
            onStop={onStop}
            mutedVoices={mutedVoices}
          />
        </div>
      ) : studioMode === 'split' && score ? (
        /* Split View: Sheet Music on top, Draggable Resizer, Piano Roll on bottom */
        <div ref={splitContainerRef} className="flex-1 flex flex-col overflow-hidden bg-[#0A0A0B]">
          {/* Top Pane: Sheet Music */}
          <div
            className="overflow-auto p-4 sm:p-6 pb-12 relative bg-[#0A0A0B]"
            style={{ height: `${splitRatio}%`, minHeight: '140px' }}
          >
            {renderPaperSheet(false)}
          </div>

          {/* Draggable Resizer Handle */}
          <div
            onMouseDown={handleSplitDragStart}
            className="h-3 bg-[#111319] hover:bg-indigo-600 active:bg-indigo-500 cursor-row-resize flex items-center justify-center transition-colors border-y border-white/10 group select-none shrink-0"
            title="Drag vertically to resize split (Double-click to reset 50/50)"
            onDoubleClick={() => setSplitRatio(50)}
          >
            <div className="flex items-center gap-2 opacity-60 group-hover:opacity-100">
              <div className="w-10 h-1 rounded-full bg-white/40 group-hover:bg-white" />
              <span className="text-[9px] font-mono text-stone-400 group-hover:text-white uppercase font-bold tracking-wider">
                {Math.round(splitRatio)}% / {Math.round(100 - splitRatio)}%
              </span>
            </div>
          </div>

          {/* Bottom Pane: Piano Roll */}
          <div
            className="flex-1 overflow-hidden"
            style={{ height: `${100 - splitRatio}%`, minHeight: '180px' }}
          >
            <PianoRoll
              score={score}
              gridOpacity={settings?.pianoRollGridOpacity}
              onUpdateScore={onUpdateScore}
              autoFormatOnBlur={autoFormatOnBlur}
              onToggleAutoFormatOnBlur={setAutoFormatOnBlur}
              currentTick={currentTick}
              playerRef={playerRef}
              onSeekTick={onSeekTick}
              isExpanded={isExpanded}
              onToggleExpand={onToggleExpand}
              isFullscreen={isFullscreen}
              onToggleFullscreen={onToggleFullscreen}
              isPlaying={isPlaying}
              onPlay={onPlay}
              onPause={onPause}
              onStop={onStop}
              mutedVoices={mutedVoices}
            />
          </div>
        </div>
      ) : studioMode === 'source' ? (
        <div className="flex-1 flex flex-col overflow-hidden bg-[#0F1115]">
          {/* Editor Header Toolbar */}
          <div className="flex items-center justify-between px-6 py-2.5 bg-[#161920] border-b border-white/5 text-xs text-stone-400 select-none">
            {/* Left: Tab Switcher */}
            <div className="flex items-center gap-3">
              <div className="flex items-center bg-black/60 p-0.5 rounded-lg border border-white/10 shadow-inner">
                <button
                  onClick={() => {
                    setSourceTab('solfa');
                    if (score) {
                      setSolfaText(serializeScoreToSolfa(score));
                    }
                  }}
                  className={`px-3 py-1.5 rounded-md text-[10px] font-sans font-black uppercase tracking-wider transition-all duration-200 cursor-pointer flex items-center gap-1.5 ${
                    sourceTab === 'solfa'
                      ? 'bg-indigo-600 text-white shadow'
                      : 'text-stone-400 hover:text-white'
                  }`}
                  title="Switch to Tonic Sol-fa Plain Text Editor"
                >
                  <Music size={12} />
                  Tonic Sol-fa Editor
                </button>
                <button
                  onClick={() => setSourceTab('abc')}
                  className={`px-3 py-1.5 rounded-md text-[10px] font-sans font-black uppercase tracking-wider transition-all duration-200 cursor-pointer flex items-center gap-1.5 ${
                    sourceTab === 'abc'
                      ? 'bg-indigo-600 text-white shadow'
                      : 'text-stone-400 hover:text-white'
                  }`}
                  title="Switch to ABC Notation Editor"
                >
                  <Code size={12} />
                  ABC Notation Editor
                </button>
              </div>

              <span className="text-stone-600">|</span>

              <span className="font-sans font-semibold text-[#818CF8] text-[11px] flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {sourceTab === 'solfa'
                  ? 'Two-Way Live Sync & Forgiving Octaves (s1 / s₁ / d¹)'
                  : 'Dynamic Auto-formatting & Grid Alignment enabled'}
              </span>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-2.5">
              {sourceTab === 'solfa' ? (
                <>
                  {/* Format on Blur Toggle */}
                  <label
                    className="flex items-center gap-1.5 text-[10px] text-stone-300 font-sans font-bold cursor-pointer select-none px-2.5 py-1.5 bg-white/5 rounded-lg border border-white/10 hover:bg-white/10 transition-colors"
                    title="Automatically format and align grid when leaving the editor"
                  >
                    <input
                      type="checkbox"
                      checked={autoFormatOnBlur}
                      onChange={(e) => setAutoFormatOnBlur(e.target.checked)}
                      className="w-3.5 h-3.5 text-indigo-600 rounded focus:ring-0 cursor-pointer accent-indigo-500"
                    />
                    <span>Format on Blur</span>
                  </label>

                  {/* Auto Grid Alignment Button */}
                  <button
                    onClick={handleAlignSolfa}
                    className="px-3.5 py-1.5 bg-[#4F46E5] hover:bg-[#5A52FF] text-white rounded-lg active:scale-95 transition-all font-sans font-bold text-[10px] uppercase tracking-wider flex items-center gap-1.5 cursor-pointer shadow-md"
                    title="Align beat pulses (':') and measure bars ('|') across all vocal parts and normalize octaves"
                  >
                    <Sparkles size={12} />
                    Format & Align Grid
                  </button>
                </>
              ) : (
                /* Align Bar Lines Button for ABC */
                <button
                  onClick={() => {
                    const aligned = alignAbcBarLines(abcText);
                    setAbcText(aligned);
                  }}
                  className="px-3.5 py-1.5 bg-[#4F46E5] hover:bg-[#5A52FF] text-white rounded-lg active:scale-95 transition-all font-sans font-bold text-[10px] uppercase tracking-wider flex items-center gap-1.5 cursor-pointer shadow-md"
                  title="Align vertical measure bar lines ('|') across different voices"
                >
                  <Sparkles size={12} />
                  Align Bar Lines
                </button>
              )}

              {/* Split Preview Active Indicator (if enabled in settings) */}
              {showLivePreview && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 rounded-lg text-[10px] font-sans font-bold">
                  <Eye size={12} />
                  <span>Split Preview</span>
                  <button
                    onClick={() => {
                      if (onUpdateSettings && settings) {
                        onUpdateSettings({ ...settings, showLivePreview: false });
                      } else {
                        setLocalShowLivePreview(false);
                      }
                    }}
                    className="ml-1 text-indigo-400 hover:text-white p-0.5 rounded cursor-pointer"
                    title="Hide Split Preview (or toggle in Settings)"
                  >
                    <X size={11} />
                  </button>
                </div>
              )}

              {/* Settings shortcut button */}
              {onOpenSettings && (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="px-2.5 py-1.5 rounded-lg border border-white/5 bg-white/5 hover:bg-white/10 text-stone-300 hover:text-white text-[10px] font-sans font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5"
                  title="Open Workspace Settings (live preview, panels, editor preferences)"
                >
                  <Settings size={12} />
                  <span className="hidden sm:inline">Settings</span>
                </button>
              )}

              {/* Cheat Sheet Toggle */}
              <button
                onClick={() => setShowHelp(!showHelp)}
                className={`px-3 py-1.5 rounded-lg border text-[10px] font-sans font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 ${
                  showHelp
                    ? 'bg-white/10 border-white/20 text-white'
                    : 'bg-white/5 border-white/5 text-stone-300 hover:bg-white/10'
                }`}
                title="Toggle Reference Cheat Sheet"
              >
                <HelpCircle size={12} />
                Cheat Sheet
              </button>

              {/* Complete Full Screen Toggle */}
              {onToggleFullscreen && (
                <button
                  type="button"
                  onClick={onToggleFullscreen}
                  className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-sans font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 ${
                    isFullscreen
                      ? 'bg-indigo-600 border-indigo-400 text-white shadow-md'
                      : 'bg-white/5 border-white/5 text-stone-300 hover:bg-white/10 hover:text-white'
                  }`}
                  title={isFullscreen ? 'Exit Full Screen (Esc or F)' : 'Enter Complete Full Screen (F)'}
                >
                  {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                  <span className="hidden sm:inline">{isFullscreen ? 'Exit Full' : 'Full Screen'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Cheat Sheet Panel (Conditional) */}
          {showHelp && (
            sourceTab === 'solfa' ? (
              <div className="px-6 py-4 bg-[#4F46E5]/10 border-b border-[#4F46E5]/20 text-[11px] text-indigo-200 font-sans leading-relaxed flex flex-col md:flex-row gap-6 md:items-start select-none">
                <div className="flex-1">
                  <p className="font-black text-white uppercase tracking-wider text-[10px] text-indigo-400 mb-2 font-sans">
                    Score Headers & Voices
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-indigo-100/80 font-medium">
                    <li><span className="font-bold font-mono text-white">KEY Bb</span> or <span className="font-bold font-mono text-white">KEY F</span> at start of score.</li>
                    <li><span className="font-bold font-mono text-white">M:3/4</span>, <span className="font-bold font-mono text-white">M:4/4</span>, <span className="font-bold font-mono text-white">M:6/8</span>.</li>
                    <li><span className="font-bold font-mono text-white">S:</span> Soprano, <span className="font-bold font-mono text-white">A:</span> Alto, <span className="font-bold font-mono text-white">T:</span> Tenor, <span className="font-bold font-mono text-white">B:</span> Bass, <span className="font-bold font-mono text-white">D:</span> Descant.</li>
                    <li><span className="font-bold font-mono text-white">% --- System N ---</span> System section breaks.</li>
                  </ul>
                </div>
                <div className="flex-1">
                  <p className="font-black text-white uppercase tracking-wider text-[10px] text-indigo-400 mb-2 font-sans">
                    Syllables & Forgiving Octaves
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-indigo-100/80 font-medium">
                    <li>Diatonic: <span className="font-mono text-white font-bold">d r m f s l t</span>.</li>
                    <li>Lower Octave: Type <span className="font-mono text-white font-bold">s1</span>, <span className="font-mono text-white font-bold">s_1</span>, <span className="font-mono text-white font-bold">s,</span>, or <span className="font-mono text-white font-bold">s₁</span>.</li>
                    <li>Two Below: Type <span className="font-mono text-white font-bold">d2</span>, <span className="font-mono text-white font-bold">d_2</span>, <span className="font-mono text-white font-bold">d,,</span>, or <span className="font-mono text-white font-bold">d₂</span>.</li>
                    <li>Upper Octave: Type <span className="font-mono text-white font-bold">d'</span>, <span className="font-mono text-white font-bold">d^1</span>, or <span className="font-mono text-white font-bold">d¹</span>.</li>
                  </ul>
                </div>
                <div className="flex-1">
                  <p className="font-black text-white uppercase tracking-wider text-[10px] text-indigo-400 mb-2 font-sans">
                    Rhythm & Punctuation
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-indigo-100/80 font-medium">
                    <li><span className="font-mono text-white font-bold">|</span> Barline, <span className="font-mono text-white font-bold">||</span> Double/Phrase bar, <span className="font-mono text-white font-bold">|]</span> End bar.</li>
                    <li><span className="font-mono text-white font-bold">:</span> Separates beats (e.g. <span className="font-mono text-white bg-black/30 px-1">d : m : s</span>).</li>
                    <li><span className="font-mono text-white font-bold">-</span> Sustained beat (e.g. <span className="font-mono text-white bg-black/30 px-1">d : -</span>).</li>
                    <li><span className="font-mono text-white font-bold">.</span> Half-pulse (<span className="font-mono text-white bg-black/30 px-1">r.d</span>). <span className="font-mono text-white font-bold">:-.r</span> = sustained + late starter.</li>
                    <li><span className="font-mono text-white font-bold">,</span> Quarter-pulse sixteenths (<span className="font-mono text-white bg-black/30 px-1">d,r.m</span>).</li>
                  </ul>
                </div>
                <div className="flex-1">
                  <p className="font-black text-white uppercase tracking-wider text-[10px] text-indigo-400 mb-2 font-sans">
                    Auto-Align Grid & Tips
                  </p>
                  <p className="text-indigo-100/80 font-medium font-sans">
                    Click <span className="font-bold text-white bg-indigo-600 px-1.5 py-0.5 rounded">Format & Align Grid</span> to normalize octaves to unicode subscripts (<span className="font-mono text-white">s₁</span>, <span className="font-mono text-white">d₂</span>) and perfectly align vertical choir bars and colons. Enable <span className="font-bold text-white">Format on Blur</span> to align automatically as you edit!
                  </p>
                </div>
              </div>
            ) : (
              <div className="px-6 py-4 bg-[#4F46E5]/10 border-b border-[#4F46E5]/20 text-[11px] text-indigo-200 font-sans leading-relaxed flex flex-col md:flex-row gap-6 md:items-start select-none">
                <div className="flex-1">
                  <p className="font-black text-white uppercase tracking-wider text-[10px] text-indigo-400 mb-2 font-sans">
                    ABC Headers & Voices
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-indigo-100/80 font-medium">
                    <li><span className="font-bold font-mono text-white">T: Title</span>, <span className="font-bold font-mono text-white">C: Composer</span>.</li>
                    <li><span className="font-bold font-mono text-white">K: Key</span> (e.g., <span className="font-mono text-white bg-black/30 px-1 py-0.2 rounded">K:G</span>, <span className="font-mono text-white bg-black/30 px-1 py-0.2 rounded">K:C</span>).</li>
                    <li><span className="font-bold font-mono text-white">M: Meter</span> (e.g., <span className="font-mono text-white bg-black/30 px-1 py-0.2 rounded">M:4/4</span>).</li>
                    <li><span className="font-bold font-mono text-white">V:S name="Soprano"</span> Voice declaration header.</li>
                  </ul>
                </div>
                <div className="flex-1">
                  <p className="font-black text-white uppercase tracking-wider text-[10px] text-indigo-400 mb-2 font-sans">
                    Pitches & Accidentals
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-indigo-100/80 font-medium">
                    <li>Uppercase <span className="font-mono font-semibold text-white">C..B</span> (octave 4), lowercase <span className="font-mono font-semibold text-white">c..b</span> (octave 5).</li>
                    <li>Comma <span className="font-mono text-white font-bold">,</span> lowers pitch, apostrophe <span className="font-mono text-white font-bold">'</span> raises pitch.</li>
                    <li>Accidentals: <span className="font-mono text-white bg-black/30 px-1 py-0.2 rounded">^</span> sharp, <span className="font-mono text-white bg-black/30 px-1 py-0.2 rounded">_</span> flat, <span className="font-mono text-white bg-black/30 px-1 py-0.2 rounded">=</span> natural.</li>
                    <li>Rest is <span className="font-mono text-white font-bold bg-black/30 px-1 py-0.2 rounded">z</span> or <span className="font-mono text-white font-bold bg-black/30 px-1 py-0.2 rounded">x</span>.</li>
                  </ul>
                </div>
                <div className="flex-1">
                  <p className="font-black text-white uppercase tracking-wider text-[10px] text-indigo-400 mb-2 font-sans">
                    Grid Aligner Hint
                  </p>
                  <p className="text-indigo-100/80 font-medium font-sans">
                    Write notes for different voices (e.g., <span className="font-mono text-white bg-black/30 px-1">V:S</span>, <span className="font-mono text-white bg-black/30 px-1">V:A</span>, etc.) in consecutive lines. Use <span className="font-mono text-white">|</span> for measure lines. Click <span className="font-bold text-white bg-indigo-600 px-1.5 py-0.5 rounded">Align Bar Lines</span> to instantly make them line up vertically for a beautiful choir grid layout!
                  </p>
                </div>
              </div>
            )
          )}

          {/* Editor Main Area (Lines & Scrollable Panel) */}
          <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
            {/* Left: Code Editor Pane */}
            <div className={`flex flex-col overflow-hidden ${showLivePreview ? 'w-full lg:w-1/2 border-b lg:border-b-0 lg:border-r border-white/10' : 'w-full flex-1'}`}>
              <div className="flex-1 flex overflow-hidden relative">
                {sourceTab === 'solfa' ? (
                  <>
                    {/* Gutter with line numbers for Solfa */}
                    <div
                      ref={solfaGutterRef}
                      className="w-12 flex-shrink-0 bg-[#0A0A0B] border-r border-white/5 py-4 font-mono text-[11px] leading-relaxed text-stone-600 text-right pr-3 select-none overflow-hidden"
                    >
                      {solfaText.split('\n').map((_, i) => (
                        <div key={`solfa-ln-${i}`} className="h-[21px] leading-[21px]">
                          {i + 1}
                        </div>
                      ))}
                    </div>

                    {/* Solfa Textarea/Highlight overlays */}
                    <div className="flex-1 relative bg-[#0D0E12] overflow-hidden">
                      {/* Background Highlighted Pre */}
                      <pre
                        ref={solfaHighlightRef}
                        className="absolute inset-0 w-full h-full p-4 pb-36 font-mono text-[11px] leading-relaxed text-indigo-100/30 whitespace-pre break-all overflow-hidden pointer-events-none select-none border border-transparent"
                        aria-hidden="true"
                        style={{ lineHeight: '21px' }}
                      >
                        {highlightSolfa(solfaText)}
                      </pre>

                      {/* Foreground Textarea */}
                      <textarea
                        ref={solfaTextareaRef}
                        value={solfaText}
                        onChange={(e) => handleSolfaChange(e.target.value)}
                        onBlur={handleSolfaBlur}
                        onScroll={handleSolfaScroll}
                        className="absolute inset-0 w-full h-full p-4 pb-36 font-mono text-[11px] leading-relaxed bg-transparent text-transparent caret-white focus:outline-none resize-none whitespace-pre break-all overflow-auto border border-transparent"
                        placeholder="Type or paste Tonic Sol-fa notation here (e.g. KEY Bb, S: | s1 : s1 : f1 | m1 : s1 : d | ...)"
                        spellCheck="false"
                        style={{ lineHeight: '21px' }}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    {/* Gutter with line numbers for ABC */}
                    <div
                      ref={editorGutterRef}
                      className="w-12 flex-shrink-0 bg-[#0A0A0B] border-r border-white/5 py-4 pb-36 font-mono text-[11px] leading-relaxed text-stone-600 text-right pr-3 select-none overflow-hidden"
                    >
                      {abcText.split('\n').map((_, i) => (
                        <div key={`abc-ln-${i}`} className="h-[21px] leading-[21px]">
                          {i + 1}
                        </div>
                      ))}
                    </div>

                    {/* Code Textarea/Highlight overlays */}
                    <div className="flex-1 relative bg-[#0D0E12] overflow-hidden">
                      {/* Background Highlighted Pre */}
                      <pre
                        ref={editorHighlightRef}
                        className="absolute inset-0 w-full h-full p-4 pb-36 font-mono text-[11px] leading-relaxed text-indigo-100/30 whitespace-pre break-all overflow-hidden pointer-events-none select-none border border-transparent"
                        aria-hidden="true"
                        style={{ lineHeight: '21px' }}
                      >
                        {highlightAbc(abcText)}
                      </pre>

                      {/* Foreground Textarea */}
                      <textarea
                        ref={editorTextareaRef}
                        value={abcText}
                        onChange={(e) => setAbcText(e.target.value)}
                        onScroll={handleEditorScroll}
                        className="absolute inset-0 w-full h-full p-4 pb-36 font-mono text-[11px] leading-relaxed bg-transparent text-transparent caret-white focus:outline-none resize-none whitespace-pre break-all overflow-auto border border-transparent"
                        placeholder="Type or paste ABC notation here..."
                        spellCheck="false"
                        style={{ lineHeight: '21px' }}
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Problems/Warnings Panel at the bottom */}
              {warnings && warnings.length > 0 && (settings?.showCompilationWarnings ?? true) && (
                <div className="border-t border-red-500/20 bg-red-500/5 max-h-[140px] overflow-auto select-none">
                  <div className="flex items-center gap-2 px-6 py-2 bg-red-500/10 border-b border-red-500/10 text-red-200 text-[10px] font-sans font-black uppercase tracking-wider">
                    <AlertTriangle size={12} className="text-red-400" />
                    <span>Compilation Warnings & Problems ({warnings.length})</span>
                  </div>
                  <div className="px-6 py-2.5 divide-y divide-red-500/10">
                    {warnings.map((warn, wIdx) => (
                      <div key={`ide-warning-${wIdx}`} className="py-1.5 text-[10px] text-red-200/80 font-sans">
                        <span className="font-bold text-red-400">
                          {warn.voiceId ? `Voice [${warn.voiceId}]: ` : ''}
                        </span>
                        {warn.reason}
                        {warn.rawText && (
                          <code className="inline-block ml-2 bg-red-500/20 px-1 py-0.2 rounded text-red-300 font-mono text-[9px]">
                            "{warn.rawText}"
                          </code>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right: Live Interactive Score Preview (Instant Sync on every keystroke) */}
            {showLivePreview && (
              <div className="w-full lg:w-1/2 flex flex-col overflow-auto bg-[#14161C] p-4 lg:p-6 pb-36">
                <div className="mb-4 flex items-center justify-between bg-black/40 px-3.5 py-2 rounded-xl border border-white/10 text-xs shrink-0">
                  <div className="flex items-center gap-2 text-indigo-300 font-semibold text-[11px]">
                    <Sparkles size={13} className="text-indigo-400" />
                    <span>Interactive Score (Live Real-Time Sync)</span>
                  </div>
                  <span className="text-[10px] font-mono text-stone-400">
                    Click notes to inspect or edit
                  </span>
                </div>
                {renderNoteInspector()}
                {renderPaperSheet(true)}
              </div>
            )}
          </div>
        </div>
      ) : studioMode === 'lyrics' ? (
        /* Hymn Lyrics View */
        <div className="flex-1 overflow-auto p-8 pb-36 relative bg-[#0A0A0B]">
          <div
            className="mx-auto max-w-2xl bg-[#FDFCF8] text-black border border-black/5 shadow-2xl rounded-2xl p-10 font-sans relative transition-all overflow-hidden"
            style={{
              transform: `scale(${scale})`,
              transformOrigin: 'top center',
              marginBottom: `${(scale - 1) * 100}%`
            }}
          >
            {/* Subtle Watermark */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.02] select-none z-0">
              <h1 className="text-[12rem] font-black tracking-tighter font-serif">LYRICS</h1>
            </div>

            <div className="relative z-10">
              {/* Hymn Headers */}
              {score && (
                <div className="mb-8 border-b-2 border-black/10 pb-4 text-center">
                  <h1 className="font-serif italic font-black text-3xl tracking-tight text-stone-900">
                    {score.hymnName || score.title}
                  </h1>
                  {score.tuneName && (
                    <p className="font-serif italic text-black/60 text-sm mt-1">
                      Tune: <span className="font-bold">{score.tuneName}</span>
                    </p>
                  )}
                  <div className="flex justify-center gap-4 mt-2 text-stone-500 uppercase tracking-widest font-bold text-[10px]">
                    {score.hymnMeter && <span>Meter: {score.hymnMeter}</span>}
                    {score.verses !== undefined && <span>Verses: {score.verses}</span>}
                  </div>
                </div>
              )}

              {/* Render the lyrics verses nicely */}
              {score && score.lyrics && score.lyrics.length > 0 ? (
                <div className="space-y-6 max-w-md mx-auto text-center font-serif text-base leading-relaxed text-stone-800">
                  {(() => {
                    // Group lyrics into verses separated by blank lines
                    const versesList: string[][] = [];
                    let currentVerse: string[] = [];
                    
                    score.lyrics.forEach(line => {
                      if (line.trim() === '') {
                        if (currentVerse.length > 0) {
                          versesList.push(currentVerse);
                          currentVerse = [];
                        }
                      } else {
                        currentVerse.push(line);
                      }
                    });
                    
                    if (currentVerse.length > 0) {
                      versesList.push(currentVerse);
                    }

                    if (versesList.length === 0) {
                      return <p className="italic text-stone-400">No lyrics available.</p>;
                    }

                    return versesList.map((verse, vIdx) => (
                      <div key={`verse-${vIdx}`} className="p-4 bg-stone-50/50 rounded-xl border border-stone-100">
                        {verse.map((line, lIdx) => {
                          const numMatch = line.match(/^(\d+\.?\s*)(.*)$/);
                          if (numMatch) {
                            return (
                              <p key={`line-${vIdx}-${lIdx}`} className="my-1">
                                <span className="font-bold text-stone-400 mr-1">{numMatch[1]}</span>
                                {numMatch[2]}
                              </p>
                            );
                          }
                          return (
                            <p key={`line-${vIdx}-${lIdx}`} className="my-1">
                              {line}
                            </p>
                          );
                        })}
                      </div>
                    ));
                  })()}
                </div>
              ) : (
                <div className="text-center py-12 text-stone-400 italic">
                  <p>No lyrics (W: lines) found in this ABC score.</p>
                  <p className="text-[11px] font-sans mt-2">
                    Add lyrics lines at the end of the ABC file with the <code className="bg-stone-100 px-1 py-0.5 rounded text-indigo-600">W:</code> prefix.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Sheet Music Visual Area */
        <div className="flex-1 overflow-auto p-8 pb-36 relative bg-[#0A0A0B]">
          {studioMode === 'interactive' && renderNoteInspector()}
          {renderPaperSheet(studioMode === 'interactive')}
        </div>
      )}
    </div>
  );
};
