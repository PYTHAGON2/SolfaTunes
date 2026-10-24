/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ParsedScore } from '../types';
import {
  FlatPianoRollNote,
  flattenScoreToPianoRoll,
  formatAndReconstructScore,
  enforceMonophony,
  getVoiceTheme,
  formatPitchLabel,
  getMeterTicksPerMeasure,
  getMeterBeatTicks,
  midiToNoteProperties,
  getPitchSemantics,
  getNoteDurationLabel,
  formatSolfaOctaveLabel,
  midiToFrequency,
} from '../engine/piano_roll_adapter';
import { Tooltip } from './Tooltip';
import { MidiPlayer } from '../audio/midi_player';
import {
  getScoreMeasureRanges,
  audioTickToPianoRollTick,
  pianoRollTickToAudioTick,
} from '../utils/playback_timeline';
import {
  Sparkles,
  Music,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  Trash2,
  Check,
  Info,
  Layers,
  ChevronDown,
  ChevronUp,
  Sliders,
  X,
  HelpCircle,
  Eye,
  CheckSquare,
  Square,
  Volume2,
  Play,
  Pause,
  Radio,
} from 'lucide-react';

interface PianoRollProps {
  score: ParsedScore;
  onUpdateScore: (newScore: ParsedScore) => void;
  currentTick?: number;
  playerRef?: React.RefObject<MidiPlayer | null>;
  onSeekTick?: (tick: number) => void;
  onClose?: () => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  gridOpacity?: number;
  isPlaying?: boolean;
  onPlay?: () => void;
  onPause?: () => void;
  onStop?: () => void;
  mutedVoices?: { [voiceId: string]: boolean };
}

// Black key pitch classes (0=C, 1=C#, 2=D, 3=D#, 4=E, 5=F, 6=F#, 7=G, 8=G#, 9=A, 10=A#, 11=B)
const BLACK_KEY_PCS = new Set([1, 3, 6, 8, 10]);

export const PianoRoll: React.FC<PianoRollProps> = ({
  score,
  onUpdateScore,
  currentTick = 0,
  playerRef,
  onSeekTick,
  onClose,
  isExpanded = false,
  onToggleExpand,
  isFullscreen = false,
  onToggleFullscreen,
  gridOpacity = 0.14,
  isPlaying = false,
  onPlay,
  onPause,
  onStop,
  mutedVoices = {},
}) => {
  // 1. Grid & Display Settings
  const [pixelsPerTick, setPixelsPerTick] = useState<number>(4.0); // 16 ticks = 64px
  const [rowHeight, setRowHeight] = useState<number>(20); // 20px default row height
  const [snapTicks, setSnapTicks] = useState<number>(8); // default 8 ticks = 1/8 note
  const [autoFormatOnBlur, setAutoFormatOnBlur] = useState<boolean>(true);
  const [hasUncommittedChanges, setHasUncommittedChanges] = useState<boolean>(false);

  // 2. Collapsible UI Panels (Clean scanability, collapse away by default)
  const [showToolsDrawer, setShowToolsDrawer] = useState<boolean>(false);
  const [showHelpDrawer, setShowHelpDrawer] = useState<boolean>(false);

  // 3. Local editable notes state
  const [notes, setNotes] = useState<FlatPianoRollNote[]>([]);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());

  // Dynamic chromatic pitch bounds (minimum C2..C6 standard vocal range, expanding if lower or higher notes exist)
  const { minMidi, maxMidi, keyCount } = useMemo(() => {
    let minP = 36; // C2 (MIDI 36) default base
    let maxP = 84; // C6 (MIDI 84) default ceiling
    notes.forEach((n) => {
      if (!n.isRest && n.midiPitch > 0) {
        if (n.midiPitch < minP) minP = n.midiPitch;
        if (n.midiPitch > maxP) maxP = n.midiPitch;
      }
    });
    // Align to octave boundaries
    const minM = Math.floor(minP / 12) * 12;
    const maxM = Math.ceil(maxP / 12) * 12;
    return {
      minMidi: minM,
      maxMidi: maxM,
      keyCount: maxM - minM + 1,
    };
  }, [notes]);

  // 4. Active insertion voice channel (isolated single-channel insertion)
  const availableVoices = useMemo(() => {
    if (score.voices && score.voices.length > 0) {
      return score.voices.map((v) => v.id);
    }
    return ['S', 'A', 'T', 'B'];
  }, [score.voices]);

  const [activeVoiceId, setActiveVoiceId] = useState<string>(availableVoices[0] || 'S');

  // Keep active voice valid if score changes
  useEffect(() => {
    if (availableVoices.length > 0 && !availableVoices.includes(activeVoiceId)) {
      setActiveVoiceId(availableVoices[0]);
    }
  }, [availableVoices, activeVoiceId]);

  // Synchronize local notes from score when score updates from outside
  useEffect(() => {
    const { notes: flatNotes } = flattenScoreToPianoRoll(score);
    setNotes(flatNotes);
    setHasUncommittedChanges(false);
  }, [score]);

  // Containers and refs
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const keyboardRef = useRef<HTMLDivElement>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const pianoRollWrapperRef = useRef<HTMLDivElement>(null);

  // Dragging and Marquee Selection States
  const [isMarqueeSelecting, setIsMarqueeSelecting] = useState<boolean>(false);
  const [marqueeStart, setMarqueeStart] = useState<{ x: number; y: number } | null>(null);
  const [marqueeCurrent, setMarqueeCurrent] = useState<{ x: number; y: number } | null>(null);

  // Note Moving/Dragging state
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
  const [dragOrigin, setDragOrigin] = useState<{
    startX: number;
    startY: number;
    noteTicks: { [id: string]: number };
    notePitches: { [id: string]: number };
  } | null>(null);
  const [hasMovedDuringDrag, setHasMovedDuringDrag] = useState<boolean>(false);

  // Note Resizing state (dragging the right edge of a note to stretch/shrink duration)
  const [resizingNoteId, setResizingNoteId] = useState<string | null>(null);
  const [resizeOrigin, setResizeOrigin] = useState<{
    startX: number;
    origDurationTicks: number;
  } | null>(null);

  // Hovered note for rich tooltip card
  const [hoveredNote, setHoveredNote] = useState<{
    note: FlatPianoRollNote;
    x: number;
    y: number;
  } | null>(null);

  // Meter calculations
  const meterTicks = useMemo(() => getMeterTicksPerMeasure(score.meter), [score.meter]);
  const meterBeatTicks = useMemo(() => getMeterBeatTicks(score.meter), [score.meter]);
  const totalTicks = useMemo(() => {
    let maxT = 0;
    notes.forEach((n) => {
      const end = n.startTick + n.durationTicks;
      if (end > maxT) maxT = end;
    });
    return Math.max(maxT + meterTicks * 2, meterTicks * 8);
  }, [notes, meterTicks]);

  const totalGridWidth = totalTicks * pixelsPerTick;
  const totalGridHeight = keyCount * rowHeight;
  const totalCanvasHeight = totalGridHeight + 28; // 28px timeline header

  // Sound preview helper
  const playPreview = useCallback(
    (midiPitch: number, durationSec: number = 0.3) => {
      if (playerRef?.current) {
        playerRef.current.previewNote(midiPitch, durationSec);
      }
    },
    [playerRef]
  );

  // Center vertical scroll to middle vocal range (e.g. C4 = 60) on initial render
  useEffect(() => {
    if (scrollContainerRef.current) {
      const c4Y = (maxMidi - 60) * rowHeight;
      const targetScroll = Math.max(0, c4Y - scrollContainerRef.current.clientHeight / 2 + 60);
      scrollContainerRef.current.scrollTop = targetScroll;
    }
  }, [rowHeight, maxMidi]);

  // -------------------------------------------------------------
  // Auto-Format on Blur Handler
  // -------------------------------------------------------------
  const executeAutoFormat = useCallback(() => {
    if (notes.length === 0) return;
    try {
      const formattedScore = formatAndReconstructScore(score, notes, snapTicks);
      onUpdateScore(formattedScore);
      setHasUncommittedChanges(false);
    } catch (e) {
      console.error('Error auto-formatting piano roll score:', e);
    }
  }, [score, notes, snapTicks, onUpdateScore]);

  const handleBlur = (e: React.FocusEvent) => {
    // If the next focused element is still inside the piano roll wrapper, do not trigger blur
    if (pianoRollWrapperRef.current && pianoRollWrapperRef.current.contains(e.relatedTarget as Node)) {
      return;
    }
    if (autoFormatOnBlur && hasUncommittedChanges) {
      executeAutoFormat();
    }
  };

  // -------------------------------------------------------------
  // Multi-Voice Note Inspector Handlers
  // -------------------------------------------------------------
  const handleReassignSelectedVoice = (targetVoiceId: string) => {
    if (selectedNoteIds.size === 0) return;
    setNotes((prevNotes) => {
      const updated = prevNotes.map((note) => {
        if (selectedNoteIds.has(note.id)) {
          return { ...note, voiceId: targetVoiceId };
        }
        return note;
      });
      const voices = Array.from(new Set(updated.map((n) => n.voiceId)));
      const cleanNotes: FlatPianoRollNote[] = [];
      voices.forEach((vId) => {
        const vNotes = updated.filter((n) => n.voiceId === vId);
        cleanNotes.push(...enforceMonophony(vNotes));
      });
      return cleanNotes;
    });
    setHasUncommittedChanges(true);
  };

  const handleTransposeSelected = (deltaSemitones: number) => {
    if (selectedNoteIds.size === 0) return;
    setNotes((prevNotes) => {
      return prevNotes.map((note) => {
        if (selectedNoteIds.has(note.id)) {
          const newPitch = Math.max(minMidi, Math.min(maxMidi, note.midiPitch + deltaSemitones));
          const props = getPitchSemantics(newPitch, score.key);
          return {
            ...note,
            midiPitch: newPitch,
            syllable: props.syllable,
            scaleDegree: props.scaleDegree,
            octaveNum: props.octaveNum,
            rawLetter: props.rawLetter,
            rawAccidental: props.rawAccidental,
          };
        }
        return note;
      });
    });
    const firstSelected = notes.find((n) => selectedNoteIds.has(n.id));
    if (firstSelected) {
      playPreview(Math.max(minMidi, Math.min(maxMidi, firstSelected.midiPitch + deltaSemitones)));
    }
    setHasUncommittedChanges(true);
  };

  const handleSetDurationSelected = (newDurationTicks: number) => {
    if (selectedNoteIds.size === 0) return;
    setNotes((prevNotes) => {
      const updated = prevNotes.map((note) => {
        if (selectedNoteIds.has(note.id)) {
          return { ...note, durationTicks: newDurationTicks };
        }
        return note;
      });
      const voices = Array.from(new Set(updated.map((n) => n.voiceId)));
      const cleanNotes: FlatPianoRollNote[] = [];
      voices.forEach((vId) => {
        const vNotes = updated.filter((n) => n.voiceId === vId);
        cleanNotes.push(...enforceMonophony(vNotes));
      });
      return cleanNotes;
    });
    setHasUncommittedChanges(true);
  };

  const handlePreviewSelected = () => {
    const selectedList = notes.filter((n) => selectedNoteIds.has(n.id));
    if (selectedList.length === 0) return;
    selectedList.slice(0, 4).forEach((n, idx) => {
      setTimeout(() => {
        playPreview(n.midiPitch, 0.4);
      }, idx * 50);
    });
  };

  // -------------------------------------------------------------
  // Coordinate helpers: convert mouse events to tick & pitch
  // -------------------------------------------------------------
  const getGridCoordinates = (e: React.MouseEvent) => {
    if (!gridContainerRef.current) return { tick: 0, pitch: 60 };
    const rect = gridContainerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const rawTick = Math.max(0, x / pixelsPerTick);
    const snappedTick = Math.floor(rawTick / snapTicks) * snapTicks;

    const rowIdx = Math.floor(y / rowHeight);
    const clampedRow = Math.max(0, Math.min(keyCount - 1, rowIdx));
    const pitch = maxMidi - clampedRow;

    return { tick: snappedTick, pitch, rawX: x, rawY: y };
  };

  // -------------------------------------------------------------
  // Note Insertion (Active Channel Only, Enforces Monophony)
  // -------------------------------------------------------------
  const handleGridDoubleClick = (e: React.MouseEvent) => {
    const { tick, pitch } = getGridCoordinates(e);

    // Create new note in active channel with duration = 1 beat (16 ticks) or snapTicks * 2
    const duration = Math.max(snapTicks * 2, 16);
    const noteSemantics = getPitchSemantics(pitch, score.key);

    const newNote: FlatPianoRollNote = {
      id: `${activeVoiceId}_${Date.now()}_${Math.random()}`,
      voiceId: activeVoiceId,
      startTick: tick,
      durationTicks: duration,
      midiPitch: pitch,
      isRest: false,
      syllable: noteSemantics.syllable,
      rawLetter: noteSemantics.rawLetter,
      rawAccidental: noteSemantics.rawAccidental,
      octaveNum: noteSemantics.octaveNum,
      scaleDegree: noteSemantics.scaleDegree,
    };

    // Strictly enforce monophony in the active channel!
    const updatedNotes = enforceMonophony([...notes, newNote], activeVoiceId);
    setNotes(updatedNotes);
    setSelectedNoteIds(new Set([newNote.id]));
    setHasUncommittedChanges(true);

    playPreview(pitch);
  };

  // -------------------------------------------------------------
  // Note Duration Resizing Handler
  // -------------------------------------------------------------
  const handleResizeStart = (e: React.MouseEvent, note: FlatPianoRollNote) => {
    e.stopPropagation();
    e.preventDefault();
    setResizingNoteId(note.id);
    setResizeOrigin({
      startX: e.clientX,
      origDurationTicks: note.durationTicks,
    });
    setSelectedNoteIds(new Set([note.id]));
  };

  // -------------------------------------------------------------
  // Note Selection and Multi-Channel Drag-Move
  // -------------------------------------------------------------
  const handleNoteMouseDown = (e: React.MouseEvent, note: FlatPianoRollNote) => {
    e.stopPropagation();

    playPreview(note.midiPitch);

    let nextSelection = new Set(selectedNoteIds);

    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      // Toggle selection across any channel
      if (nextSelection.has(note.id)) {
        nextSelection.delete(note.id);
      } else {
        nextSelection.add(note.id);
      }
    } else {
      // If clicking a note not in current multi-selection, make it the sole selection
      if (!selectedNoteIds.has(note.id)) {
        nextSelection = new Set([note.id]);
      }
    }

    setSelectedNoteIds(nextSelection);
    setDraggingNoteId(note.id);
    setHasMovedDuringDrag(false);

    // Capture initial ticks & pitches for all selected notes
    const noteTicks: { [id: string]: number } = {};
    const notePitches: { [id: string]: number } = {};
    notes.forEach((n) => {
      if (nextSelection.has(n.id)) {
        noteTicks[n.id] = n.startTick;
        notePitches[n.id] = n.midiPitch;
      }
    });

    setDragOrigin({
      startX: e.clientX,
      startY: e.clientY,
      noteTicks,
      notePitches,
    });
  };

  // -------------------------------------------------------------
  // Grid Mouse Down: Marquee selection or unselect
  // -------------------------------------------------------------
  const handleGridMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Left click only

    if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
      setSelectedNoteIds(new Set());
    }

    if (gridContainerRef.current) {
      const rect = gridContainerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      setIsMarqueeSelecting(true);
      setMarqueeStart({ x, y });
      setMarqueeCurrent({ x, y });
    }
  };

  // -------------------------------------------------------------
  // Window / Grid Mouse Move: Note Dragging, Resizing, or Marquee
  // -------------------------------------------------------------
  const handleMouseMove = (e: React.MouseEvent) => {
    // Ruler Scrubbing
    if (isRulerDragging) {
      handleRulerSeekAtClientX(e.clientX);
      return;
    }

    // 0. Note Resizing (Drag Right Edge)
    if (resizingNoteId && resizeOrigin) {
      const deltaX = e.clientX - resizeOrigin.startX;
      const deltaTicksRaw = deltaX / pixelsPerTick;
      const deltaTicks = Math.round(deltaTicksRaw / snapTicks) * snapTicks;
      const newDuration = Math.max(snapTicks, resizeOrigin.origDurationTicks + deltaTicks);

      setNotes((prevNotes) =>
        prevNotes.map((n) => {
          if (n.id !== resizingNoteId) return n;
          return { ...n, durationTicks: newDuration };
        })
      );
      setHasUncommittedChanges(true);
      return;
    }

    // 1. Note Dragging
    if (draggingNoteId && dragOrigin) {
      setHasMovedDuringDrag(true);
      const deltaX = e.clientX - dragOrigin.startX;
      const deltaY = e.clientY - dragOrigin.startY;

      const deltaTicksRaw = deltaX / pixelsPerTick;
      const deltaTicks = Math.round(deltaTicksRaw / snapTicks) * snapTicks;
      const deltaPitch = -Math.round(deltaY / rowHeight);

      setNotes((prevNotes) =>
        prevNotes.map((n) => {
          if (!selectedNoteIds.has(n.id)) return n;

          const origStart = dragOrigin.noteTicks[n.id] ?? n.startTick;
          const origPitch = dragOrigin.notePitches[n.id] ?? n.midiPitch;

          const newStart = Math.max(0, origStart + deltaTicks);
          const newPitch = Math.max(minMidi, Math.min(maxMidi, origPitch + deltaPitch));

          return {
            ...n,
            startTick: newStart,
            midiPitch: newPitch,
          };
        })
      );
      setHasUncommittedChanges(true);
      return;
    }

    // 2. Marquee Selection Dragging
    if (isMarqueeSelecting && marqueeStart && gridContainerRef.current) {
      const rect = gridContainerRef.current.getBoundingClientRect();
      const x = Math.max(0, e.clientX - rect.left);
      const y = Math.max(0, e.clientY - rect.top);
      setMarqueeCurrent({ x, y });

      // Calculate marquee box
      const minX = Math.min(marqueeStart.x, x);
      const maxX = Math.max(marqueeStart.x, x);
      const minY = Math.min(marqueeStart.y, y);
      const maxY = Math.max(marqueeStart.y, y);

      // Highlight any note whose box intersects marquee
      const enclosedIds = new Set<string>(
        e.shiftKey || e.ctrlKey || e.metaKey ? selectedNoteIds : []
      );

      notes.forEach((n) => {
        const noteX = n.startTick * pixelsPerTick;
        const noteW = Math.max(12, n.durationTicks * pixelsPerTick);
        const noteY = (maxMidi - n.midiPitch) * rowHeight;
        const noteH = rowHeight;

        // Check AABB intersection
        const intersects =
          noteX < maxX && noteX + noteW > minX && noteY < maxY && noteY + noteH > minY;

        if (intersects) {
          enclosedIds.add(n.id);
        }
      });

      setSelectedNoteIds(enclosedIds);
    }
  };

  // -------------------------------------------------------------
  // Mouse Up: Commit note move/resize and enforce monophony
  // -------------------------------------------------------------
  const handleMouseUp = () => {
    if (resizingNoteId) {
      const resizedNote = notes.find((n) => n.id === resizingNoteId);
      if (resizedNote) {
        setNotes((prev) => enforceMonophony(prev, resizedNote.voiceId));
        setHasUncommittedChanges(true);
      }
      setResizingNoteId(null);
      setResizeOrigin(null);
    }

    if (draggingNoteId) {
      if (hasMovedDuringDrag) {
        // Enforce monophony for all channels that contain moved notes!
        const affectedVoiceIds = new Set<string>();
        notes.forEach((n) => {
          if (selectedNoteIds.has(n.id)) {
            affectedVoiceIds.add(n.voiceId);
          }
        });

        let updated = notes;
        affectedVoiceIds.forEach((vId) => {
          updated = enforceMonophony(updated, vId);
        });

        setNotes(updated);
        setHasUncommittedChanges(true);
      }
      setDraggingNoteId(null);
      setDragOrigin(null);
    }

    if (isMarqueeSelecting) {
      setIsMarqueeSelecting(false);
      setMarqueeStart(null);
      setMarqueeCurrent(null);
    }

    if (isRulerDragging) {
      setIsRulerDragging(false);
    }
  };

  // -------------------------------------------------------------
  // Keyboard Shortcuts (Play/Pause, Delete, Transpose with Arrows)
  // -------------------------------------------------------------
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Space key: Play / Pause toggle
      if (e.code === 'Space' && !e.repeat) {
        const activeTag = document.activeElement?.tagName?.toLowerCase();
        if (activeTag !== 'input' && activeTag !== 'select' && activeTag !== 'textarea') {
          e.preventDefault();
          if (isPlaying) {
            onPause?.();
          } else {
            onPlay?.();
          }
          return;
        }
      }

      // Close open drawers on Escape
      if (e.key === 'Escape') {
        if (showToolsDrawer) setShowToolsDrawer(false);
        if (showHelpDrawer) setShowHelpDrawer(false);
        if (selectedNoteIds.size > 0) {
          setSelectedNoteIds(new Set());
          return;
        }
      }

      if (selectedNoteIds.size === 0) return;

      // Delete or Backspace
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        setNotes((prev) => prev.filter((n) => !selectedNoteIds.has(n.id)));
        setSelectedNoteIds(new Set());
        setHasUncommittedChanges(true);
        return;
      }

      // Transpose Up/Down
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const delta = e.key === 'ArrowUp' ? 1 : -1;
        setNotes((prev) =>
          prev.map((n) => {
            if (!selectedNoteIds.has(n.id)) return n;
            const newPitch = Math.max(minMidi, Math.min(maxMidi, n.midiPitch + delta));
            return { ...n, midiPitch: newPitch };
          })
        );
        // Sound preview of transposed pitch
        const sampleNote = notes.find((n) => selectedNoteIds.has(n.id));
        if (sampleNote) {
          playPreview(sampleNote.midiPitch + delta);
        }
        setHasUncommittedChanges(true);
        return;
      }

      // Nudge Left/Right
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const delta = e.key === 'ArrowRight' ? snapTicks : -snapTicks;
        setNotes((prev) => {
          const shifted = prev.map((n) => {
            if (!selectedNoteIds.has(n.id)) return n;
            const newStart = Math.max(0, n.startTick + delta);
            return { ...n, startTick: newStart };
          });

          // Enforce monophony for affected channels
          const affectedVoices = new Set<string>();
          shifted.forEach((n) => {
            if (selectedNoteIds.has(n.id)) affectedVoices.add(n.voiceId);
          });
          let result = shifted;
          affectedVoices.forEach((vId) => {
            result = enforceMonophony(result, vId);
          });
          return result;
        });
        setHasUncommittedChanges(true);
        return;
      }

      // Select All (Ctrl+A / Cmd+A)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelectedNoteIds(new Set(notes.map((n) => n.id)));
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNoteIds, notes, snapTicks, playPreview, showToolsDrawer, showHelpDrawer, isPlaying, onPlay, onPause]);

  const [followPlayhead, setFollowPlayhead] = useState<boolean>(true);
  const [isRulerDragging, setIsRulerDragging] = useState<boolean>(false);

  // Generate Measure Barlines for the Timeline Header
  const measureColumns = useMemo(() => {
    const cols = [];
    const numMeasures = Math.ceil(totalTicks / meterTicks);
    for (let m = 0; m < numMeasures; m++) {
      cols.push({
        measureNumber: m + 1,
        startTick: m * meterTicks,
        width: meterTicks * pixelsPerTick,
      });
    }
    return cols;
  }, [totalTicks, meterTicks, pixelsPerTick]);

  // Audio timeline measure ranges from score
  const audioRanges = useMemo(() => getScoreMeasureRanges(score), [score]);

  // Visual piano roll measure bounds
  const pianoMeasureBounds = useMemo(() => {
    return measureColumns.map((col, idx) => ({
      measureIndex: idx,
      startTick: col.startTick,
      durationTicks: meterTicks,
    }));
  }, [measureColumns, meterTicks]);

  // Dynamic mapping: converts audio playback tick to visual piano roll grid tick
  // Aligns pickup measures (anacrusis) and regular measures with 100% precision!
  const activePianoRollTick = useMemo(() => {
    return audioTickToPianoRollTick(currentTick, audioRanges, pianoMeasureBounds);
  }, [currentTick, audioRanges, pianoMeasureBounds]);

  // Active sounding note IDs and pitches during audio playback
  const { activeSoundingNoteIds, activeSoundingPitches, activePitchVoices } = useMemo(() => {
    const soundingIds = new Set<string>();
    const soundingPitches = new Set<number>();
    const pitchVoices: { [pitch: number]: string } = {};

    if (!isPlaying) {
      return { activeSoundingNoteIds: soundingIds, activeSoundingPitches: soundingPitches, activePitchVoices: pitchVoices };
    }

    notes.forEach((n) => {
      if (n.isRest || n.midiPitch <= 0) return;
      if (mutedVoices && mutedVoices[n.voiceId]) return;
      if (activePianoRollTick >= n.startTick && activePianoRollTick < n.startTick + n.durationTicks) {
        soundingIds.add(n.id);
        soundingPitches.add(n.midiPitch);
        pitchVoices[n.midiPitch] = n.voiceId;
      }
    });

    return { activeSoundingNoteIds: soundingIds, activeSoundingPitches: soundingPitches, activePitchVoices: pitchVoices };
  }, [notes, activePianoRollTick, isPlaying, mutedVoices]);

  // Auto-scroll piano roll horizontally to follow playback cursor smoothly
  useEffect(() => {
    if (!isPlaying || !followPlayhead || !scrollContainerRef.current) return;

    const container = scrollContainerRef.current;
    const playheadPx = activePianoRollTick * pixelsPerTick;
    const viewportLeft = container.scrollLeft;
    const viewportWidth = container.clientWidth;
    const visibleGridWidth = Math.max(200, viewportWidth - 96); // Account for 96px keyboard

    const thresholdRight = viewportLeft + visibleGridWidth * 0.75;
    const thresholdLeft = viewportLeft + 20;

    if (playheadPx > thresholdRight || playheadPx < thresholdLeft) {
      container.scrollTo({
        left: Math.max(0, playheadPx - visibleGridWidth * 0.25),
        behavior: 'smooth',
      });
    }
  }, [activePianoRollTick, isPlaying, followPlayhead, pixelsPerTick]);

  // Ruler Seeking & Drag-to-Scrubbing
  const handleRulerSeekAtClientX = useCallback(
    (clientX: number) => {
      if (!gridContainerRef.current || !onSeekTick) return;
      const rect = gridContainerRef.current.getBoundingClientRect();
      const x = clientX - rect.left;
      const clickedPianoTick = Math.max(0, Math.round(x / pixelsPerTick));
      const targetAudioTick = pianoRollTickToAudioTick(clickedPianoTick, audioRanges, pianoMeasureBounds);
      onSeekTick(targetAudioTick);
    },
    [pixelsPerTick, audioRanges, pianoMeasureBounds, onSeekTick]
  );

  const handleRulerMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setIsRulerDragging(true);
    handleRulerSeekAtClientX(e.clientX);
  };

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isRulerDragging) setIsRulerDragging(false);
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [isRulerDragging]);
  const beatLines = useMemo(() => {
    const lines: { tick: number; isMeasureStart: boolean }[] = [];
    for (let tick = meterBeatTicks; tick < totalTicks; tick += meterBeatTicks) {
      lines.push({ tick, isMeasureStart: tick % meterTicks === 0 });
    }
    return lines;
  }, [meterBeatTicks, meterTicks, totalTicks]);
  const gridAlpha = Math.max(0, Math.min(0.4, gridOpacity));
  const gridSubdivisionTicks = Math.max(1, Math.round(meterBeatTicks / 4));
  const gridSubdivisionPixels = gridSubdivisionTicks * pixelsPerTick;

  // Active voice theme
  const activeVoiceTheme = getVoiceTheme(activeVoiceId);

  // Statistics for active vs other channels
  const activeChannelNoteCount = useMemo(
    () => notes.filter((n) => n.voiceId === activeVoiceId && !n.isRest).length,
    [notes, activeVoiceId]
  );

  return (
    <div
      ref={pianoRollWrapperRef}
      tabIndex={0}
      onBlur={handleBlur}
      onMouseUp={handleMouseUp}
      onMouseMove={handleMouseMove}
      className="flex flex-col h-full bg-[#0D0E12] text-stone-200 select-none overflow-hidden outline-none"
    >
      {/* 1. Piano Roll Clean Header Toolbar */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-[#14161D] border-b border-white/10 text-xs shadow-md shrink-0">
        {/* Left: Title & Active Channel Insertion Selector */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" />
            <h3 className="font-sans font-black text-xs uppercase tracking-wider text-white hidden sm:flex items-center gap-1.5">
              <Music size={14} className="text-indigo-400" />
              Piano Roll
            </h3>
          </div>

          <div className="h-4 w-px bg-white/10 hidden sm:block shrink-0" />

          {/* Playback Transport Controls */}
          {(onPlay || onPause) && (
            <div className="flex items-center gap-1 bg-black/60 p-1 rounded-lg border border-white/10 shrink-0">
              {isPlaying ? (
                <Tooltip content="Pause" description="Pause playback" shortcut="Space" side="bottom">
                  <button
                    type="button"
                    onClick={onPause}
                    className="p-1 sm:px-2.5 sm:py-1 rounded-md text-[11px] font-bold bg-amber-500 hover:bg-amber-400 text-stone-950 flex items-center gap-1.5 cursor-pointer transition-all shadow-md active:scale-95"
                  >
                    <Pause size={12} className="fill-current" />
                    <span className="hidden sm:inline">Pause</span>
                  </button>
                </Tooltip>
              ) : (
                <Tooltip content="Play" description="Start audio playback" shortcut="Space" side="bottom">
                  <button
                    type="button"
                    onClick={onPlay}
                    className="p-1 sm:px-2.5 sm:py-1 rounded-md text-[11px] font-bold bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5 cursor-pointer transition-all shadow-md active:scale-95"
                  >
                    <Play size={12} className="fill-current" />
                    <span className="hidden sm:inline">Play</span>
                  </button>
                </Tooltip>
              )}

              {onStop && (
                <Tooltip content="Stop" description="Stop playback and rewind to start" side="bottom">
                  <button
                    type="button"
                    onClick={onStop}
                    className="p-1 sm:p-1.5 rounded-md text-stone-400 hover:text-white hover:bg-white/10 cursor-pointer transition-all active:scale-95"
                  >
                    <Square size={12} className="fill-current" />
                  </button>
                </Tooltip>
              )}

              <div className="h-3 w-px bg-white/15 mx-0.5" />

              {/* Follow Playhead Toggle */}
              <Tooltip
                content={followPlayhead ? 'Follow Playhead: ON' : 'Follow Playhead: OFF'}
                description="Automatically scroll view to follow audio playback cursor"
                side="bottom"
              >
                <button
                  type="button"
                  onClick={() => setFollowPlayhead((prev) => !prev)}
                  className={`px-1.5 py-1 rounded-md text-[10px] sm:text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-all ${
                    followPlayhead
                      ? 'bg-indigo-500/25 text-indigo-300 border border-indigo-400/40 shadow-sm'
                      : 'text-stone-500 hover:text-stone-300 hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <Radio size={11} className={followPlayhead && isPlaying ? 'animate-pulse text-indigo-400' : ''} />
                  <span className="hidden md:inline">Follow</span>
                </button>
              </Tooltip>
            </div>
          )}

          <div className="h-4 w-px bg-white/10 hidden sm:block shrink-0" />

          {/* Active Voice Channel Insertion Pill Selector */}
          <div className="flex items-center gap-1 bg-black/50 p-1 rounded-lg border border-white/10 overflow-x-auto max-w-[280px] sm:max-w-none">
            <span className="text-[10px] uppercase font-bold text-stone-400 px-1 hidden md:flex items-center gap-1 shrink-0">
              <Layers size={11} />
              Channel:
            </span>
            {availableVoices.map((vId) => {
              const theme = getVoiceTheme(vId);
              const isActive = activeVoiceId === vId;
              return (
                <Tooltip
                  key={vId}
                  content={theme.name}
                  description={`Insert notes into ${theme.name} channel (strictly monophonic)`}
                  side="bottom"
                >
                  <button
                    type="button"
                    onClick={() => setActiveVoiceId(vId)}
                    className={`px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-md text-[10px] sm:text-[11px] font-sans font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
                      isActive
                        ? `${theme.bgClass} text-white shadow-md ring-1 ring-white/30`
                        : 'text-stone-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <span
                      className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full inline-block shrink-0"
                      style={{ backgroundColor: theme.hex }}
                    />
                    <span>{theme.name}</span>
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </div>

        {/* Right: Quick Controls & Collapsible Drawer Toggles */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Snap / Grid Size */}
          <Tooltip
            content="Grid Snap"
            description="Controls note placement quantization and arrow key nudge increments"
            side="bottom"
          >
            <div className="flex items-center gap-1 bg-black/40 px-2 py-1 rounded-lg border border-white/10 text-[11px]">
              <span className="text-stone-400 font-medium hidden sm:inline">Snap:</span>
              <select
                value={snapTicks}
                onChange={(e) => setSnapTicks(Number(e.target.value))}
                className="bg-transparent text-indigo-300 font-mono font-bold focus:outline-none cursor-pointer text-xs"
              >
                <option value={4} className="bg-stone-900 text-white">1/16</option>
                <option value={8} className="bg-stone-900 text-white">1/8</option>
                <option value={16} className="bg-stone-900 text-white">1/4</option>
                <option value={32} className="bg-stone-900 text-white">1/2</option>
              </select>
            </div>
          </Tooltip>

          {/* Collapsible Options & Tools Drawer Toggle */}
          <Tooltip
            content="Tools & Format"
            description="Formatting tools, display zoom, row sizing, and selection controls"
            side="bottom"
          >
            <button
              type="button"
              onClick={() => setShowToolsDrawer((prev) => !prev)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-all border ${
                showToolsDrawer
                  ? 'bg-indigo-600 border-indigo-400 text-white shadow-md'
                  : hasUncommittedChanges
                  ? 'bg-indigo-500/10 border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/20'
                  : 'bg-black/40 border-white/10 text-stone-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <Sliders size={12} />
              <span className="hidden sm:inline">Tools & Format</span>
              {hasUncommittedChanges && !showToolsDrawer && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
              )}
              {showToolsDrawer ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          </Tooltip>

          {/* Quick Format Now Button (Directly reachable when unsaved) */}
          {hasUncommittedChanges && !showToolsDrawer && (
            <Tooltip
              content="Sync & Format"
              description="Quantize notes, close gaps, and sync Tonic Sol-fa notation"
              side="bottom"
            >
              <button
                onClick={executeAutoFormat}
                className="flex items-center gap-1 px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold rounded-lg shadow cursor-pointer transition-all"
              >
                <Sparkles size={11} />
                <span className="hidden sm:inline">Format</span>
              </button>
            </Tooltip>
          )}

          {/* Complete Full Screen Toggle */}
          {onToggleFullscreen && (
            <Tooltip
              content={isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
              description="Expand piano roll across full display"
              shortcut="F"
              side="bottom"
            >
              <button
                type="button"
                onClick={onToggleFullscreen}
                className={`p-1.5 rounded-lg border cursor-pointer transition-colors ${
                  isFullscreen
                    ? 'bg-indigo-600 border-indigo-400 text-white'
                    : 'bg-black/40 hover:bg-white/10 text-stone-300 hover:text-white border-white/10'
                }`}
              >
                {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </button>
            </Tooltip>
          )}

          {/* Optional Expand Toggle */}
          {onToggleExpand && (
            <Tooltip
              content={isExpanded ? 'Collapse Canvas' : 'Expand Canvas'}
              description="Toggle widescreen canvas width"
              side="bottom"
            >
              <button
                type="button"
                onClick={onToggleExpand}
                className="p-1.5 bg-black/40 hover:bg-white/10 text-stone-300 hover:text-white rounded-lg border border-white/10 cursor-pointer transition-colors"
              >
                {isExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </button>
            </Tooltip>
          )}

          {/* Close Piano Roll view */}
          {onClose && (
            <Tooltip
              content="Close Piano Roll"
              description="Return to score notation view"
              side="bottom"
            >
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 bg-black/40 hover:bg-white/10 text-stone-300 hover:text-white rounded-lg border border-white/10 cursor-pointer transition-colors"
              >
                <X size={13} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* 2. Collapsible Tools & Format Drawer (Folds away cleanly) */}
      {showToolsDrawer && (
        <div className="bg-[#101218] border-b border-indigo-500/20 px-4 py-3 shadow-2xl transition-all duration-200 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-4 text-xs">
            {/* Group A: Format & Sync */}
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[10px] uppercase font-black text-indigo-400 tracking-wider">
                Sync & Quantization:
              </span>

              <label
                className="flex items-center gap-1.5 text-stone-300 hover:text-white cursor-pointer select-none bg-black/40 px-2.5 py-1 rounded-md border border-white/10"
                title="Automatically snap notes to grid and update Tonic Sol-fa when leaving the piano roll"
              >
                <input
                  type="checkbox"
                  checked={autoFormatOnBlur}
                  onChange={(e) => setAutoFormatOnBlur(e.target.checked)}
                  className="rounded border-stone-600 text-indigo-600 focus:ring-0 cursor-pointer"
                />
                <span className="text-[11px] font-medium">Auto-format on blur</span>
              </label>

              <button
                onClick={executeAutoFormat}
                className="flex items-center gap-1.5 px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-[11px] font-bold shadow-md cursor-pointer transition-all"
                title="Instantly format, quantize, and rebuild the score"
              >
                <Sparkles size={12} />
                <span>Format Now</span>
              </button>
            </div>

            {/* Group B: Zoom & Row Sizing */}
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[10px] uppercase font-black text-indigo-400 tracking-wider">
                Display:
              </span>

              {/* Horizontal Zoom */}
              <div className="flex items-center gap-1 bg-black/40 px-2 py-1 rounded-md border border-white/10 text-[11px]">
                <span className="text-stone-400 text-[10px] mr-1">Zoom:</span>
                <button
                  onClick={() => setPixelsPerTick((p) => Math.max(1.5, p * 0.8))}
                  className="p-0.5 hover:bg-white/10 rounded text-stone-300 hover:text-white cursor-pointer"
                  title="Zoom Out Horizontally"
                >
                  <ZoomOut size={12} />
                </button>
                <span className="text-[10px] font-mono text-stone-300 w-8 text-center font-bold">
                  {Math.round(pixelsPerTick * 25)}%
                </span>
                <button
                  onClick={() => setPixelsPerTick((p) => Math.min(10.0, p * 1.25))}
                  className="p-0.5 hover:bg-white/10 rounded text-stone-300 hover:text-white cursor-pointer"
                  title="Zoom In Horizontally"
                >
                  <ZoomIn size={12} />
                </button>
              </div>

              {/* Vertical Zoom */}
              <div className="flex items-center gap-1 bg-black/40 px-2 py-1 rounded-md border border-white/10 text-[11px]">
                <span className="text-stone-400 text-[10px] mr-1">Vertical:</span>
                <button
                  type="button"
                  onClick={() => setRowHeight((height) => Math.max(10, Math.round(height / 1.2)))}
                  className="p-0.5 hover:bg-white/10 rounded text-stone-300 hover:text-white cursor-pointer"
                  title="Zoom out vertically"
                  aria-label="Zoom out vertically"
                >
                  <ZoomOut size={12} />
                </button>
                <span className="text-[10px] font-mono text-stone-300 w-8 text-center font-bold">
                  {Math.round((rowHeight / 20) * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setRowHeight((height) => Math.min(40, Math.round(height * 1.2)))}
                  className="p-0.5 hover:bg-white/10 rounded text-stone-300 hover:text-white cursor-pointer"
                  title="Zoom in vertically"
                  aria-label="Zoom in vertically"
                >
                  <ZoomIn size={12} />
                </button>
              </div>

              {/* Row Height Presets */}
              <div className="flex items-center gap-1 bg-black/40 p-0.5 rounded-md border border-white/10 text-[10px]">
                <button
                  onClick={() => setRowHeight(16)}
                  className={`px-2 py-0.5 rounded ${
                    rowHeight === 16 ? 'bg-indigo-600 text-white font-bold' : 'text-stone-400 hover:text-white'
                  }`}
                  title="Compact key rows (16px)"
                >
                  Compact
                </button>
                <button
                  onClick={() => setRowHeight(20)}
                  className={`px-2 py-0.5 rounded ${
                    rowHeight === 20 ? 'bg-indigo-600 text-white font-bold' : 'text-stone-400 hover:text-white'
                  }`}
                  title="Standard key rows (20px)"
                >
                  Standard
                </button>
                <button
                  onClick={() => setRowHeight(26)}
                  className={`px-2 py-0.5 rounded ${
                    rowHeight === 26 ? 'bg-indigo-600 text-white font-bold' : 'text-stone-400 hover:text-white'
                  }`}
                  title="Spacious key rows (26px)"
                >
                  Large
                </button>
              </div>
            </div>

            {/* Group C: Selection Tools */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedNoteIds(new Set(notes.map((n) => n.id)))}
                className="px-2 py-1 bg-black/40 hover:bg-white/10 text-stone-300 hover:text-white text-[10px] font-bold rounded border border-white/10 cursor-pointer"
                title="Select all notes across all channels (Ctrl+A)"
              >
                Select All
              </button>

              {selectedNoteIds.size > 0 && (
                <>
                  <button
                    onClick={() => setSelectedNoteIds(new Set())}
                    className="px-2 py-1 bg-black/40 hover:bg-white/10 text-stone-400 hover:text-white text-[10px] font-bold rounded border border-white/10 cursor-pointer"
                    title="Deselect all (Escape)"
                  >
                    Clear ({selectedNoteIds.size})
                  </button>

                  <button
                    onClick={() => {
                      setNotes((prev) => prev.filter((n) => !selectedNoteIds.has(n.id)));
                      setSelectedNoteIds(new Set());
                      setHasUncommittedChanges(true);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 bg-red-600/30 hover:bg-red-600/40 text-red-200 border border-red-500/40 rounded text-[10px] font-bold cursor-pointer transition-colors"
                    title="Delete selected notes"
                  >
                    <Trash2 size={11} />
                    <span>Delete</span>
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => setShowToolsDrawer(false)}
                className="p-1 hover:bg-white/10 rounded text-stone-400 hover:text-white cursor-pointer ml-1"
                title="Fold away tools drawer"
              >
                <ChevronUp size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Main Work Area: Synchronized Keyboard & Full-Height Grid */}
      <div className="flex-1 flex overflow-hidden relative min-h-0">
        <div
          ref={scrollContainerRef}
          className="flex-1 flex overflow-auto relative"
        >
          {/* Left Piano Keyboard Column (Sticky on horizontal scroll, fully sized) */}
          <div
            ref={keyboardRef}
            className="sticky left-0 z-20 flex-shrink-0 w-24 bg-[#111217] border-r border-white/15 select-none shadow-2xl"
            style={{
              paddingTop: '28px', // offset for the sticky 28px timeline header
              height: `${totalCanvasHeight}px`,
              minHeight: `${totalCanvasHeight}px`,
            }}
          >
            {Array.from({ length: keyCount }).map((_, i) => {
              const pitch = maxMidi - i;
              const pc = ((pitch % 12) + 12) % 12;
              const isBlack = BLACK_KEY_PCS.has(pc);
              const isC = pc === 0;
              const label = formatPitchLabel(pitch, score.key);
              const isSounding = activeSoundingPitches.has(pitch);
              const soundingVoice = isSounding ? activePitchVoices[pitch] : undefined;
              const soundingTheme = soundingVoice ? getVoiceTheme(soundingVoice) : null;

              return (
                <div
                  key={pitch}
                  onClick={() => playPreview(pitch)}
                  className={`flex items-center justify-between px-2 text-[10px] font-mono font-bold border-b transition-all duration-75 cursor-pointer flex-shrink-0 ${
                    isSounding
                      ? 'text-white shadow-[0_0_12px_rgba(99,102,241,0.9)] z-10 scale-[1.02]'
                      : isBlack
                      ? 'bg-[#181920] hover:bg-[#252835] text-stone-400 border-black/40'
                      : 'bg-[#F8F9FA] hover:bg-[#E2E8F0] text-stone-900 border-stone-300'
                  } ${isC && !isSounding ? 'ring-1 ring-indigo-500/60 font-black' : ''}`}
                  style={{
                    height: `${rowHeight}px`,
                    minHeight: `${rowHeight}px`,
                    backgroundColor: isSounding ? (soundingTheme ? soundingTheme.hex : '#6366f1') : undefined,
                  }}
                  title={`Play ${label} (MIDI ${pitch})${isSounding && soundingVoice ? ` • Playing in ${soundingVoice}` : ''}`}
                >
                  <span className={`${isC && !isSounding ? 'text-indigo-600 font-extrabold' : ''}`}>
                    {label}
                  </span>
                  {isSounding ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-white shadow-sm animate-pulse" />
                  ) : isC ? (
                    <span className="text-[8px] bg-indigo-600 text-white px-1 rounded-sm">
                      Do
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>

          {/* Right Timeline Header & Note Matrix Grid (Ensures full totalGridHeight without flex collapse!) */}
          <div
            className="flex-shrink-0 flex flex-col relative"
            style={{
              width: `${totalGridWidth}px`,
              minWidth: `${totalGridWidth}px`,
              height: `${totalCanvasHeight}px`,
              minHeight: `${totalCanvasHeight}px`,
            }}
          >
            {/* Timeline Ruler Header (Sticky on Vertical Scroll) */}
            <div
              onMouseDown={handleRulerMouseDown}
              className="sticky top-0 z-20 h-7 bg-[#161822] border-b border-white/15 flex flex-row cursor-ew-resize flex-shrink-0 shadow-sm relative overflow-hidden"
              style={{
                width: `${totalGridWidth}px`,
                minWidth: `${totalGridWidth}px`,
                height: '28px',
              }}
              title="Click or drag anywhere on ruler to scrub/seek playback position"
            >
              {measureColumns.map((col) => {
                const isCurrentMeasure =
                  activePianoRollTick >= col.startTick &&
                  activePianoRollTick < col.startTick + meterTicks;
                return (
                  <div
                    key={col.measureNumber}
                    className={`flex items-center px-2 text-[10px] font-mono font-bold border-r border-white/20 select-none transition-colors shrink-0 ${
                      isCurrentMeasure
                        ? 'bg-indigo-600/20 text-indigo-200 border-indigo-400/40'
                        : 'text-stone-400 hover:bg-white/5'
                    }`}
                    style={{ width: `${col.width}px` }}
                  >
                    <span className={isCurrentMeasure ? 'text-indigo-300 font-extrabold' : 'text-indigo-400'}>
                      M{col.measureNumber}
                    </span>
                    <span className="text-stone-500 text-[9px] ml-2">
                      {col.startTick}t
                    </span>
                  </div>
                );
              })}

              {/* Ruler Scrubber Thumb */}
              {activePianoRollTick !== undefined && (
                <div
                  className="absolute top-0 bottom-0 pointer-events-none z-30 flex flex-col items-center"
                  style={{
                    left: `${activePianoRollTick * pixelsPerTick}px`,
                    transform: 'translateX(-50%)',
                  }}
                >
                  <div className="w-3 h-3 bg-rose-500 rounded-sm shadow-md flex items-center justify-center text-[7px] font-black text-white">
                    ▼
                  </div>
                </div>
              )}
            </div>

            {/* Note Grid Canvas */}
            <div
              ref={gridContainerRef}
              onMouseDown={handleGridMouseDown}
              onDoubleClick={handleGridDoubleClick}
              className="relative flex-shrink-0 cursor-crosshair overflow-hidden"
              style={{
                width: `${totalGridWidth}px`,
                minWidth: `${totalGridWidth}px`,
                height: `${totalGridHeight}px`,
                minHeight: `${totalGridHeight}px`,
              }}
            >
              {/* Horizontal Row Striping (Black vs White keys) */}
              {Array.from({ length: keyCount }).map((_, i) => {
                const pitch = maxMidi - i;
                const pc = ((pitch % 12) + 12) % 12;
                const isBlack = BLACK_KEY_PCS.has(pc);
                const isC = pc === 0;

                return (
                  <div
                    key={`row-${pitch}`}
                    className={`absolute w-full border-b ${
                      isBlack
                        ? 'bg-black/40 border-white/5'
                        : isC
                        ? 'bg-indigo-950/20 border-indigo-500/20'
                        : 'bg-white/[0.02] border-white/5'
                    }`}
                    style={{
                      top: `${i * rowHeight}px`,
                      height: `${rowHeight}px`,
                      minHeight: `${rowHeight}px`,
                    }}
                  />
                );
              })}

              {gridAlpha > 0 && (
                <div
                  className="absolute inset-0 pointer-events-none z-[1]"
                  aria-hidden="true"
                  style={{
                    backgroundImage: `repeating-linear-gradient(to right, rgba(148,163,184,${gridAlpha * 0.35}) 0 1px, transparent 1px ${gridSubdivisionPixels}px)`,
                  }}
                />
              )}

              {/* Beat and measure lines follow the score's meter */}
              {beatLines.map((line) => (
                <div
                  key={`beat-line-${line.tick}`}
                  className="absolute top-0 bottom-0 pointer-events-none z-[2]"
                  aria-hidden="true"
                  style={{
                    left: `${line.tick * pixelsPerTick}px`,
                    height: `${totalGridHeight}px`,
                    borderLeft: `1px solid rgba(129,140,248,${gridAlpha * (line.isMeasureStart ? 1 : 0.65)})`,
                  }}
                />
              ))}

              {/* Vertical Measure & Beat Grid Lines */}
              {measureColumns.map((col) => (
                <div
                  key={`m-line-${col.measureNumber}`}
                  className="absolute top-0 bottom-0 pointer-events-none z-[2]"
                  style={{
                    left: `${col.startTick * pixelsPerTick - 1}px`,
                    height: `${totalGridHeight}px`,
                    borderLeft: `2px solid rgba(129,140,248,${gridAlpha})`,
                  }}
                />
              ))}

              {/* Playhead Marker */}
              {activePianoRollTick !== undefined && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-rose-500 z-30 pointer-events-none shadow-[0_0_10px_rgba(244,63,94,0.9)]"
                  style={{
                    left: `${activePianoRollTick * pixelsPerTick}px`,
                    height: `${totalGridHeight}px`,
                  }}
                >
                  <div className="w-2.5 h-2.5 bg-rose-500 transform -translate-x-[4px] -translate-y-1 rotate-45 shadow" />
                </div>
              )}

              {/* Rendered Interactive Note Blocks with Resizing and Proper Tonic Sol-fa Octaves */}
              {notes.map((note) => {
                if (note.isRest) return null; // Piano roll notes only display sounding pitches

                const theme = getVoiceTheme(note.voiceId);
                const isSelected = selectedNoteIds.has(note.id);
                const isSounding = activeSoundingNoteIds.has(note.id);

                const left = note.startTick * pixelsPerTick;
                const width = Math.max(16, note.durationTicks * pixelsPerTick);
                const top = (maxMidi - note.midiPitch) * rowHeight;
                const height = rowHeight - 2;

                const solfaDisplay = formatSolfaOctaveLabel(note.syllable, note.octaveRelativeToVoice);
                const pitchLabel = formatPitchLabel(note.midiPitch, score.key);
                const durLabel = getNoteDurationLabel(note.durationTicks);

                return (
                  <div
                    key={note.id}
                    onMouseDown={(e) => handleNoteMouseDown(e, note)}
                    onMouseEnter={(e) => {
                      setHoveredNote({
                        note,
                        x: e.clientX,
                        y: e.clientY,
                      });
                    }}
                    onMouseMove={(e) => {
                      setHoveredNote((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : null));
                    }}
                    onMouseLeave={() => setHoveredNote(null)}
                    className={`group absolute rounded-md border cursor-move transition-all flex items-center justify-between px-1.5 overflow-hidden text-[10px] font-sans font-bold select-none ${
                      theme.bgClass
                    } ${
                      isSounding
                        ? 'ring-2 ring-amber-300 shadow-[0_0_16px_rgba(251,191,36,0.9)] brightness-125 z-20'
                        : isSelected
                        ? 'ring-2 ring-white border-white shadow-2xl z-20 brightness-110'
                        : `${theme.borderClass} opacity-95 shadow-md hover:brightness-105 z-10`
                    }`}
                    style={{
                      left: `${left}px`,
                      top: `${top + 1}px`,
                      width: `${width}px`,
                      height: `${height}px`,
                    }}
                  >
                    {/* Voice Left Accent Bar */}
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-white/40 rounded-l-md" />

                    {/* Note Sol-fa Syllable with Octave Accent */}
                    <span className="font-mono font-black text-white drop-shadow ml-0.5 truncate tracking-tight">
                      {solfaDisplay}
                    </span>

                    {/* Scientific Pitch (if note block is wide enough) */}
                    {width > 38 && (
                      <span className="text-[9px] font-mono font-semibold text-white/90 drop-shadow ml-1 truncate">
                        {pitchLabel}
                      </span>
                    )}

                    {/* Drag-to-Resize Handle on the right edge */}
                    <div
                      onMouseDown={(e) => handleResizeStart(e, note)}
                      className="absolute right-0 top-0 bottom-0 w-2.5 hover:w-3.5 bg-white/0 hover:bg-white/40 cursor-ew-resize transition-all rounded-r-md flex items-center justify-center opacity-0 group-hover:opacity-100 z-10"
                      title={`Drag right edge to resize (${durLabel})`}
                    >
                      <div className="w-0.5 h-2 bg-white/80 rounded-full" />
                    </div>
                  </div>
                );
              })}

              {/* Drag Selection Marquee Overlay */}
              {isMarqueeSelecting && marqueeStart && marqueeCurrent && (
                <div
                  className="absolute bg-indigo-500/20 border border-indigo-400 rounded pointer-events-none z-30"
                  style={{
                    left: `${Math.min(marqueeStart.x, marqueeCurrent.x)}px`,
                    top: `${Math.min(marqueeStart.y, marqueeCurrent.y)}px`,
                    width: `${Math.abs(marqueeCurrent.x - marqueeStart.x)}px`,
                    height: `${Math.abs(marqueeCurrent.y - marqueeStart.y)}px`,
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Floating Hover Note Card */}
      {hoveredNote && !draggingNoteId && !resizingNoteId && !isMarqueeSelecting && (
        <div
          className="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-full mb-3"
          style={{
            left: `${hoveredNote.x}px`,
            top: `${hoveredNote.y - 12}px`,
          }}
        >
          <div className="bg-[#12141C]/95 border border-indigo-500/40 rounded-xl px-3 py-2 shadow-2xl backdrop-blur-md text-stone-200 text-xs min-w-[210px] animate-in fade-in zoom-in-95 duration-100">
            {/* Header: Voice Badge & Pitch */}
            <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-1.5 mb-1.5">
              <div className="flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-full inline-block"
                  style={{ backgroundColor: getVoiceTheme(hoveredNote.note.voiceId).hex }}
                />
                <span className="font-bold text-white text-[11px] uppercase tracking-wider">
                  {getVoiceTheme(hoveredNote.note.voiceId).name}
                </span>
              </div>
              <span className="font-mono font-black text-indigo-300 text-xs">
                {formatPitchLabel(hoveredNote.note.midiPitch, score.key)}
              </span>
            </div>

            {/* Details: Tonic Sol-fa, Pitch & Timing */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] mb-1.5">
              <div>
                <span className="text-stone-400">Sol-fa: </span>
                <span className="text-white font-mono font-bold">
                  {formatSolfaOctaveLabel(hoveredNote.note.syllable, hoveredNote.note.octaveRelativeToVoice)}
                </span>
              </div>
              <div>
                <span className="text-stone-400">Pitch: </span>
                <span className="text-stone-300 font-mono">
                  {midiToFrequency(hoveredNote.note.midiPitch)} Hz
                </span>
              </div>
              <div>
                <span className="text-stone-400">Length: </span>
                <span className="text-stone-200 font-medium">
                  {getNoteDurationLabel(hoveredNote.note.durationTicks)}
                </span>
              </div>
              <div>
                <span className="text-stone-400">Timing: </span>
                <span className="text-stone-300 font-mono">
                  {hoveredNote.note.measureNumber ? `M${hoveredNote.note.measureNumber}` : ''}
                  {hoveredNote.note.beatInMeasure ? ` • B${hoveredNote.note.beatInMeasure}` : ''}
                  {` (${hoveredNote.note.startTick}t)`}
                </span>
              </div>
            </div>

            {/* Action Tip */}
            <div className="text-[9px] text-stone-500 border-t border-white/5 pt-1 flex items-center justify-between">
              <span>Click to preview</span>
              <span className="text-indigo-400 font-semibold">Drag edge to resize</span>
            </div>
          </div>
        </div>
      )}

      {/* 4. Collapsible Help & Cheatsheet Panel (Folds away cleanly) */}
      {showHelpDrawer && (
        <div className="bg-[#12141C] border-t border-white/10 p-4 text-xs text-stone-300 shadow-inner shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-bold text-white flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
              <HelpCircle size={13} className="text-indigo-400" />
              Piano Roll Quick Guide & Monophony Standards
            </h4>
            <button
              onClick={() => setShowHelpDrawer(false)}
              className="text-stone-400 hover:text-white p-1 rounded cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-[11px] leading-relaxed">
            <div className="bg-black/30 p-2.5 rounded-lg border border-white/5">
              <span className="font-bold text-indigo-300 block mb-1">Inserting Notes</span>
              <p className="text-stone-400">
                Double-click on the grid to create a note in the active channel (<span className="text-white font-bold">{activeVoiceTheme.name}</span>). New notes conform strictly to vocal monophony.
              </p>
            </div>
            <div className="bg-black/30 p-2.5 rounded-lg border border-white/5">
              <span className="font-bold text-indigo-300 block mb-1">Multi-Channel Movement</span>
              <p className="text-stone-400">
                Drag a box to select notes from different voices at once. Drag horizontally to shift time or vertically to transpose pitches together.
              </p>
            </div>
            <div className="bg-black/30 p-2.5 rounded-lg border border-white/5">
              <span className="font-bold text-indigo-300 block mb-1">Auto-Format on Blur</span>
              <p className="text-stone-400">
                When you click away from the piano roll, notes automatically quantize to measure subdivisions, fill rest gaps, and update Tonic Sol-fa syllables.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 4.5. Floating Multi-Voice Note Inspector Card */}
      {selectedNoteIds.size > 0 && (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-30 bg-[#161822]/95 border border-indigo-500/40 rounded-2xl shadow-2xl backdrop-blur-md px-4 py-2.5 flex flex-wrap items-center gap-3 text-xs text-stone-200 animate-in fade-in slide-in-from-bottom-2 duration-150 max-w-[95%]">
          {/* Note count & badge */}
          <div className="flex items-center gap-2 border-r border-white/10 pr-3">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
            <span className="font-bold text-white whitespace-nowrap">
              {selectedNoteIds.size} note{selectedNoteIds.size > 1 ? 's' : ''}
            </span>
          </div>

          {/* Voice Channel Assignment */}
          <div className="flex items-center gap-1.5 border-r border-white/10 pr-3">
            <span className="text-[10px] text-stone-400 uppercase font-black tracking-wider mr-1">
              Voice:
            </span>
            {availableVoices.map((vId) => {
              const theme = getVoiceTheme(vId);
              return (
                <Tooltip
                  key={`inspector-reassign-${vId}`}
                  content={`Assign to ${theme.name}`}
                  description="Move selected note(s) to this voice channel (monophonic)"
                  side="top"
                >
                  <button
                    type="button"
                    onClick={() => handleReassignSelectedVoice(vId)}
                    className="px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-transform active:scale-95 cursor-pointer border"
                    style={{
                      backgroundColor: `${theme.hex}25`,
                      color: theme.hex,
                      borderColor: `${theme.hex}50`,
                    }}
                  >
                    {vId}
                  </button>
                </Tooltip>
              );
            })}
          </div>

          {/* Pitch Shift */}
          <div className="flex items-center gap-1 border-r border-white/10 pr-3">
            <span className="text-[10px] text-stone-400 uppercase font-black tracking-wider mr-1">
              Pitch:
            </span>
            <Tooltip content="Pitch Down" description="Lower pitch by 1 semitone" shortcut="↓" side="top">
              <button
                onClick={() => handleTransposeSelected(-1)}
                className="px-1.5 py-0.5 bg-black/40 hover:bg-white/10 border border-white/10 rounded font-bold hover:text-white cursor-pointer"
              >
                -1
              </button>
            </Tooltip>
            <Tooltip content="Pitch Up" description="Raise pitch by 1 semitone" shortcut="↑" side="top">
              <button
                onClick={() => handleTransposeSelected(1)}
                className="px-1.5 py-0.5 bg-black/40 hover:bg-white/10 border border-white/10 rounded font-bold hover:text-white cursor-pointer"
              >
                +1
              </button>
            </Tooltip>
            <Tooltip content="Lower Octave" description="Shift pitch down 12 semitones" side="top">
              <button
                onClick={() => handleTransposeSelected(-12)}
                className="px-1.5 py-0.5 bg-black/40 hover:bg-white/10 border border-white/10 rounded text-[10px] font-bold hover:text-white cursor-pointer"
              >
                -8ve
              </button>
            </Tooltip>
            <Tooltip content="Raise Octave" description="Shift pitch up 12 semitones" side="top">
              <button
                onClick={() => handleTransposeSelected(12)}
                className="px-1.5 py-0.5 bg-black/40 hover:bg-white/10 border border-white/10 rounded text-[10px] font-bold hover:text-white cursor-pointer"
              >
                +8ve
              </button>
            </Tooltip>
          </div>

          {/* Duration */}
          <div className="flex items-center gap-1 border-r border-white/10 pr-3">
            <span className="text-[10px] text-stone-400 uppercase font-black tracking-wider mr-1">
              Length:
            </span>
            <Tooltip content="Sixteenth Note" description="Set note duration to 4 ticks" side="top">
              <button
                onClick={() => handleSetDurationSelected(4)}
                className="px-1.5 py-0.5 bg-black/40 hover:bg-white/10 border border-white/10 rounded text-[10px] font-mono hover:text-white cursor-pointer"
              >
                1/16
              </button>
            </Tooltip>
            <Tooltip content="Eighth Note" description="Set note duration to 8 ticks" side="top">
              <button
                onClick={() => handleSetDurationSelected(8)}
                className="px-1.5 py-0.5 bg-black/40 hover:bg-white/10 border border-white/10 rounded text-[10px] font-mono hover:text-white cursor-pointer"
              >
                1/8
              </button>
            </Tooltip>
            <Tooltip content="Quarter Note" description="Set note duration to 16 ticks" side="top">
              <button
                onClick={() => handleSetDurationSelected(16)}
                className="px-1.5 py-0.5 bg-black/40 hover:bg-white/10 border border-white/10 rounded text-[10px] font-mono hover:text-white cursor-pointer"
              >
                1/4
              </button>
            </Tooltip>
            <Tooltip content="Half Note" description="Set note duration to 32 ticks" side="top">
              <button
                onClick={() => handleSetDurationSelected(32)}
                className="px-1.5 py-0.5 bg-black/40 hover:bg-white/10 border border-white/10 rounded text-[10px] font-mono hover:text-white cursor-pointer"
              >
                1/2
              </button>
            </Tooltip>
          </div>

          {/* Actions: Preview, Delete, Deselect */}
          <div className="flex items-center gap-1.5">
            <Tooltip content="Audition" description="Play pitch of selected notes" side="top">
              <button
                onClick={handlePreviewSelected}
                className="p-1.5 bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 hover:text-white rounded-lg border border-indigo-500/40 cursor-pointer transition-colors"
              >
                <Volume2 size={13} />
              </button>
            </Tooltip>
            <Tooltip content="Delete Notes" description="Remove selected notes from score" shortcut="Del" side="top">
              <button
                onClick={() => {
                  setNotes((prev) => prev.filter((n) => !selectedNoteIds.has(n.id)));
                  setSelectedNoteIds(new Set());
                  setHasUncommittedChanges(true);
                }}
                className="p-1.5 bg-red-600/30 hover:bg-red-600 text-red-200 hover:text-white rounded-lg border border-red-500/40 cursor-pointer transition-colors"
              >
                <Trash2 size={13} />
              </button>
            </Tooltip>
            <Tooltip content="Clear Selection" description="Deselect all notes" shortcut="Esc" side="top">
              <button
                onClick={() => setSelectedNoteIds(new Set())}
                className="p-1 hover:bg-white/10 text-stone-400 hover:text-white rounded-full cursor-pointer ml-1"
              >
                <X size={14} />
              </button>
            </Tooltip>
          </div>
        </div>
      )}

      {/* 5. Minimalist Bottom Status Bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#12131A] border-t border-white/10 text-[11px] text-stone-400 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: activeVoiceTheme.hex }} />
            <span className="text-stone-300 font-bold">{activeVoiceTheme.name} Channel</span>
            <span className="text-stone-500 text-[10px]">({activeChannelNoteCount} notes)</span>
          </div>

          {selectedNoteIds.size > 0 && (
            <span className="text-indigo-400 text-[10px] font-bold">
              • {selectedNoteIds.size} notes selected
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-stone-500 font-mono text-[10px] hidden sm:inline">
            Key: {score.key} | Meter: {score.meter}
          </span>

          <Tooltip
            content="Quick Guide & Shortcuts"
            description="View guide for note insertion, multi-channel editing, and shortcuts"
            side="top"
          >
            <button
              type="button"
              onClick={() => setShowHelpDrawer((prev) => !prev)}
              className="flex items-center gap-1 text-[10px] text-stone-400 hover:text-white cursor-pointer px-1.5 py-0.5 rounded hover:bg-white/5 transition-colors"
            >
              <HelpCircle size={11} />
              <span>Shortcuts</span>
              {showHelpDrawer ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
};
