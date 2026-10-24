/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Sidebar } from './components/Sidebar';
import { ScoreRenderer } from './components/ScoreRenderer';
import { AbcParser } from './engine/abc_parser';
import { SolfaTransformer } from './engine/solfa_transformer';
import { createAbcMusicalDocument, createMusicalDocument, MusicalDocument } from './engine/musical_document';
import {
  applyExplicitSolfaOverrides,
  confirmLossyMusicXmlReplacement,
  exportMusicXmlDocument,
  importMusicXmlDocument,
} from './engine/musicxml/document_io';
import { formatLossinessReport } from './engine/musicxml/lossiness_report';
import { SCORES, ScoreLibraryItem } from './utils/scores';
import { ParsedScore, ParseWarning, SelectedNoteLocation } from './types';
import { MidiPlayer } from './audio/midi_player';
import { MidiWriter } from './audio/midi_writer';
import { serializeScoreToAbc } from './engine/abc_serializer';
import { Music, Download, FileDown, FileUp, ChevronRight, Settings, Command, Maximize2, Minimize2 } from 'lucide-react';
import { FloatingPlaybackDock } from './components/FloatingPlaybackDock';
import { SettingsModal } from './components/SettingsModal';
import { CommandPalette, WorkspaceMode } from './components/CommandPalette';
import { loadAppSettings, saveAppSettings, AppSettings } from './utils/settings';
import { Tooltip } from './components/Tooltip';

export default function App() {
  // 1. App States & Persistent User Settings
  const [settings, setSettings] = useState<AppSettings>(loadAppSettings);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const handleUpdateSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    saveAppSettings(newSettings);
  };

  const handleToggleFullscreen = () => {
    setIsFullscreen((prev) => {
      const next = !prev;
      if (next) {
        try {
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
          }
        } catch {}
      } else {
        try {
          if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
          }
        } catch {}
      }
      return next;
    });
  };

  const [abcText, setAbcText] = useState<string>(SCORES[0]?.abcText || '');
  const [abcLoadVersion, setAbcLoadVersion] = useState(0);
  const [musicalDocument, setMusicalDocument] = useState<MusicalDocument | null>(null);
  const score = musicalDocument?.score ?? null;
  const [warnings, setWarnings] = useState<ParseWarning[]>([]);
  const [musicXmlStatus, setMusicXmlStatus] = useState<{
    type: 'success' | 'warning' | 'error' | 'info';
    message: string;
  } | null>(null);
  
  // Player control states
  const [bpm, setBpm] = useState<number>(100);
  const [transpose, setTranspose] = useState<number>(0);
  const [currentTick, setCurrentTick] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [mutedVoices, setMutedVoices] = useState<{ [voiceId: string]: boolean }>({});
  const [masterVolume, setMasterVolume] = useState<number>(0.8);
  const [isLooping, setIsLooping] = useState<boolean>(false);

  // Sheet display states
  const [fontSize, setFontSize] = useState<number>(18);
  const [scale, setScale] = useState<number>(1.0);

  // Selected note state for visual editing & workspace modes
  const [selectedNote, setSelectedNote] = useState<SelectedNoteLocation | null>(null);
  const [studioMode, setStudioMode] = useState<WorkspaceMode>('interactive');
  const scoreContainerRef = useRef<HTMLDivElement | null>(null);
  const musicXmlInputRef = useRef<HTMLInputElement | null>(null);
  const musicXmlProvenanceRef = useRef<MusicalDocument | null>(null);
  const skipNextAbcParseRef = useRef(false);

  // Compute total duration of score in sixteenth ticks
  const totalTicks = useMemo(() => {
    if (!score) return 0;
    let maxTick = 0;
    score.voices.forEach((v) => {
      score.systems.forEach((sys) => {
        const line = sys.voices[v.id];
        if (line) {
          line.measures.forEach((measure) => {
            measure.notes.forEach((note) => {
              const end = note.timestamp + note.durationTicks;
              if (end > maxTick) {
                maxTick = end;
              }
            });
          });
        }
      });
    });
    return maxTick;
  }, [score]);

  // 2. Playback Engine reference
  const playerRef = useRef<MidiPlayer | null>(null);

  // Ensure player instance is created once
  useEffect(() => {
    playerRef.current = new MidiPlayer();
    return () => {
      playerRef.current?.dispose();
    };
  }, []);

  // Global keyboard shortcuts: Cmd+K (Palette), Cmd+, (Settings), Z (Zen), F (Fullscreen), Esc (Exit fullscreen)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const isInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

      // Cmd+K or Ctrl+K opens Command Palette
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
        return;
      }

      // Cmd+, or Ctrl+, opens Settings
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        setIsSettingsOpen((prev) => !prev);
        return;
      }

      // Escape exits fullscreen if active
      if (e.key === 'Escape' && isFullscreen) {
        e.preventDefault();
        handleToggleFullscreen();
        return;
      }

      // Keys when not typing inside an input/textarea
      if (!isInput) {
        if (e.key === 'z' || e.key === 'Z') {
          e.preventDefault();
          setSettings((prev) => {
            const next = { ...prev, zenMode: !prev.zenMode };
            saveAppSettings(next);
            return next;
          });
        } else if (e.key === 'f' || e.key === 'F') {
          e.preventDefault();
          handleToggleFullscreen();
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isFullscreen]);

  // 3. Compile/Parse ABC text whenever it changes
  useEffect(() => {
    if (skipNextAbcParseRef.current) {
      skipNextAbcParseRef.current = false;
      return;
    }

    try {
      const parser = new AbcParser();
      const { score: rawScore, warnings: parseWarns } = parser.parse(abcText);
      
      const transformer = new SolfaTransformer();
      const resolvedScore = transformer.transform(rawScore);
      
      const importedDocument = musicXmlProvenanceRef.current;
      if (importedDocument) {
        resolvedScore.tempoBpm = importedDocument.score.tempoBpm;
      }
      const nextDocument = importedDocument
        ? createMusicalDocument(resolvedScore, {
            metadata: importedDocument.metadata,
            conversionReport: importedDocument.conversionReport,
            source: importedDocument.source,
          })
        : createAbcMusicalDocument(resolvedScore, abcText);
      if (importedDocument) applyExplicitSolfaOverrides(nextDocument);
      setMusicalDocument(nextDocument);
      setWarnings(parseWarns);

      // Reset playhead and stop current playbacks when score changes
      setIsPlaying(false);
      setCurrentTick(0);
      playerRef.current?.stop();
      
      // Load into the player
      playerRef.current?.loadScore(resolvedScore, bpm, mutedVoices);
    } catch (err: any) {
      console.error('Error parsing ABC Notation:', err);
      setWarnings([{
        rawText: '',
        reason: `Fatal parser error: ${err?.message || err}`
      }]);
    }
  }, [abcText, abcLoadVersion]);

  // Sync BPM changes with player
  useEffect(() => {
    if (playerRef.current) {
      playerRef.current.setBpm(bpm);
    }
  }, [bpm]);

  // Sync Transpose changes with player
  useEffect(() => {
    if (playerRef.current) {
      playerRef.current.setTransposeOffset(transpose);
    }
  }, [transpose]);

  // Sync Muted voices changes with player
  useEffect(() => {
    if (playerRef.current) {
      playerRef.current.updateActiveVoices(mutedVoices);
    }
  }, [mutedVoices]);

  // Sync Master Volume with player
  useEffect(() => {
    if (playerRef.current) {
      playerRef.current.setMasterVolume(masterVolume);
    }
  }, [masterVolume]);

  // Sync Looping with player
  useEffect(() => {
    if (playerRef.current) {
      playerRef.current.setLooping(isLooping);
    }
  }, [isLooping]);

  // 4. Player Controls Event Handlers
  const handlePlay = () => {
    if (!score) return;
    
    setIsPlaying(true);
    playerRef.current?.play((tick) => {
      setCurrentTick(tick);
    }, () => setIsPlaying(false));
  };

  const handlePause = () => {
    setIsPlaying(false);
    playerRef.current?.pause();
  };

  const handleStop = () => {
    setIsPlaying(false);
    playerRef.current?.stop();
    setCurrentTick(0);
  };

  const handleSeek = (tick: number) => {
    playerRef.current?.seek(tick);
    setCurrentTick(tick);
  };

  const toggleLoop = () => {
    setIsLooping(prev => {
      const next = !prev;
      playerRef.current?.setLooping(next);
      return next;
    });
  };

  const toggleMute = (voiceId: string) => {
    setMutedVoices(prev => ({
      ...prev,
      [voiceId]: !prev[voiceId]
    }));
  };

  const confirmCurrentMusicXmlReplacement = (operation: string) => {
    const confirmed = confirmLossyMusicXmlReplacement(
      musicXmlProvenanceRef.current,
      summary => window.confirm(
        `This will ${operation} and discard the current MusicXML document and its recovery copy. Unsupported source content may not be represented by the editable score.\n\n${summary}\n\nSave a MusicXML project recovery copy before continuing. Continue?`
      )
    );
    if (!confirmed) {
      setMusicXmlStatus({
        type: 'info',
        message: 'The current score and its MusicXML recovery source were kept.',
      });
    }
    return confirmed;
  };

  const handleSetBpm = (nextBpm: number) => {
    setBpm(nextBpm);
    setMusicalDocument(current => {
      if (!current) return current;
      const nextDocument = createMusicalDocument(
        { ...current.score, tempoBpm: nextBpm },
        {
          metadata: current.metadata,
          conversionReport: current.conversionReport,
          source: current.source,
        }
      );
      if (musicXmlProvenanceRef.current) {
        musicXmlProvenanceRef.current = nextDocument;
      }
      return nextDocument;
    });
  };

  const handleLoadScore = (song: ScoreLibraryItem) => {
    if (!confirmCurrentMusicXmlReplacement('open another score')) return;
    musicXmlProvenanceRef.current = null;
    setMusicXmlStatus(null);
    setAbcText(song.abcText);
    setAbcLoadVersion(version => version + 1);
    setSelectedNote(null);
    if (window.matchMedia('(max-width: 1023px)').matches) {
      scoreContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleLoadAbcText = (text: string) => {
    if (!confirmCurrentMusicXmlReplacement('open an ABC score')) return;
    musicXmlProvenanceRef.current = null;
    setMusicXmlStatus(null);
    setAbcText(text);
    setAbcLoadVersion(version => version + 1);
  };

  const handleAbcTextChange = (text: string) => {
    musicXmlProvenanceRef.current = null;
    setAbcText(text);
  };

  const handleUpdateScore = (newScore: ParsedScore) => {
    musicXmlProvenanceRef.current = null;
    const newAbc = serializeScoreToAbc(newScore);
    setAbcText(newAbc);
  };

  const handleExportMidi = () => {
    if (!score) return;
    MidiWriter.downloadMidiFile(score, bpm, transpose);
  };

  const handleExportAbc = () => {
    if (!abcText) return;
    const abcDropsMusicXmlData =
      musicalDocument?.source?.format === 'musicxml' &&
      (musicalDocument.conversionReport?.isLossless === false ||
        musicalDocument.score.tempoBpm !== undefined);
    if (abcDropsMusicXmlData && !window.confirm(
      'ABC export does not preserve the imported MusicXML tempo, ties, note-aligned lyrics, or other unsupported notation. The original MusicXML is not embedded in the ABC file. Export ABC anyway? Keep the original MusicXML or download a recovery copy first.'
    )) {
      setMusicXmlStatus({
        type: 'info',
        message: 'ABC export cancelled so the imported MusicXML data can be retained.',
      });
      return;
    }

    const blob = new Blob([abcText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    
    const fileName = score?.title 
      ? `${score.title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.abc` 
      : 'score.abc';
      
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImportMusicXml = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    try {
      const xml = await file.text();
      const imported = importMusicXmlDocument(xml, (summary) => window.confirm(
        `This MusicXML import is partial or lossy. Continue and replace the current score?\n\n${summary}\n\nThe original MusicXML will be retained in the document for recovery.`
      ));
      if (!imported) {
        setMusicXmlStatus({
          type: 'info',
          message: 'MusicXML import cancelled. The current score was not changed.',
        });
        return;
      }

      if (!confirmCurrentMusicXmlReplacement('open the selected MusicXML project')) return;

      musicXmlProvenanceRef.current = imported;
      const importedBpm = imported.score.tempoBpm ?? bpm;
      setBpm(importedBpm);
      const importedAbc = serializeScoreToAbc(imported.score);
      if (importedAbc !== abcText) {
        skipNextAbcParseRef.current = true;
        setAbcText(importedAbc);
      }
      setMusicalDocument(imported);
      setWarnings([]);
      setSelectedNote(null);
      setIsPlaying(false);
      setCurrentTick(0);
      playerRef.current?.stop();
      playerRef.current?.loadScore(imported.score, importedBpm, mutedVoices);
      setMusicXmlStatus({
        type: imported.conversionReport?.isLossless === false ? 'warning' : 'success',
        message: imported.conversionReport?.isLossless === false
          ? 'MusicXML imported with conversion warnings. The original file is retained for recovery.'
          : 'MusicXML imported. No conversion losses were reported.',
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setMusicXmlStatus({
        type: 'error',
        message: `MusicXML import failed. The current score was not changed. ${message}`,
      });
    }
  };

  const handleExportMusicXml = () => {
    if (!musicalDocument) return;

    try {
      const exportDocument = musicalDocument.score.tempoBpm === bpm
        ? musicalDocument
        : createMusicalDocument(
            { ...musicalDocument.score, tempoBpm: bpm },
            {
              metadata: musicalDocument.metadata,
              conversionReport: musicalDocument.conversionReport,
              source: musicalDocument.source,
            }
          );
      const result = exportMusicXmlDocument(exportDocument);
      if (!result.report.isLossless && !window.confirm(
        `This MusicXML export includes conversion losses or unsupported constructs.\n\n${formatLossinessReport(result.report)}\n\nThe original MusicXML source, when available, is embedded in the exported metadata as a recovery copy. Continue?`
      )) {
        setMusicXmlStatus({
          type: 'info',
          message: 'MusicXML export cancelled.',
        });
        return;
      }

      const blob = new Blob([result.xml], { type: 'application/vnd.recordare.musicxml+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      const fileName = score?.title
        ? `${score.title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.musicxml`
        : 'score.musicxml';
      link.href = url;
      link.download = fileName;
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setMusicXmlStatus({
        type: result.report.isLossless ? 'success' : 'warning',
        message: result.report.isLossless
          ? 'MusicXML export completed.'
          : 'MusicXML export completed with conversion warnings. The original source is embedded when available.',
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setMusicXmlStatus({
        type: 'error',
        message: `MusicXML export failed. ${message}`,
      });
    }
  };

  // Convert transpose values into helpful human-readable key steps
  const getTranspositionLabel = (val: number): string => {
    if (val === 0) return 'Original Key (C)';
    const prefix = val > 0 ? '+' : '';
    const semitones = `${prefix}${val} semitone${Math.abs(val) > 1 ? 's' : ''}`;
    
    // Add musical intervals for intuitive guidance
    switch (val) {
      case 1: return `${semitones} (m2nd Up)`;
      case 2: return `${semitones} (M2nd Up)`;
      case 3: return `${semitones} (m3rd Up)`;
      case 4: return `${semitones} (M3rd Up)`;
      case 5: return `${semitones} (P4th Up)`;
      case 6: return `${semitones} (Tritone Up)`;
      case -1: return `${semitones} (m2nd Down)`;
      case -2: return `${semitones} (M2nd Down)`;
      case -3: return `${semitones} (m3rd Down)`;
      case -4: return `${semitones} (M3rd Down)`;
      case -5: return `${semitones} (P4th Down)`;
      case -6: return `${semitones} (Tritone Down)`;
      default: return semitones;
    }
  };

  return (
    <div className="min-h-screen lg:h-screen overflow-x-clip bg-[#0A0A0B] text-stone-200 flex flex-col antialiased font-sans">
      {/* Zen Mode Minimalist Banner OR Editorial Page Header */}
      {settings.zenMode ? (
        <header className="px-6 py-2.5 bg-[#0F1115]/95 border-b border-indigo-500/20 backdrop-blur-md flex items-center justify-between gap-3 shadow-md z-30">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <h1 className="font-sans font-bold text-xs uppercase tracking-wider text-white">
              {score?.title || 'SolfaTunes'}
            </h1>
            <span className="text-[10px] text-stone-400 font-mono hidden sm:inline">
              Key: {score?.key} • Meter: {score?.meter}
            </span>
            <span className="text-[9px] font-black uppercase px-2 py-0.5 bg-indigo-600/30 text-indigo-300 rounded-full border border-indigo-500/30">
              Zen Mode
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Tooltip content="Exit Zen Mode" shortcut="Z" description="Restore standard studio workspace panels" side="bottom">
              <button
                type="button"
                onClick={() => handleUpdateSettings({ ...settings, zenMode: false })}
                className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-stone-200 text-xs font-bold transition-colors cursor-pointer"
              >
                Exit Zen Mode (Z)
              </button>
            </Tooltip>
            <Tooltip content="Settings" shortcut="⌘," description="Configure visual and playback options" side="bottom">
              <button
                type="button"
                onClick={() => setIsSettingsOpen(true)}
                className="p-1.5 rounded-lg border border-white/10 hover:bg-white/10 text-stone-300 hover:text-white transition-colors cursor-pointer"
                aria-label="Settings"
              >
                <Settings size={14} />
              </button>
            </Tooltip>
          </div>
        </header>
      ) : (
        <header className="px-4 py-3 sm:px-6 sm:py-4 lg:px-8 lg:py-5 border-b border-white/5 bg-[#0F1115] flex items-center justify-between gap-3 shadow-xl">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 sm:p-2.5 rounded-xl text-white shadow-lg border border-indigo-500">
              <Music className="h-5 w-5 sm:h-6 sm:w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="font-sans font-black text-lg sm:text-xl uppercase tracking-widest text-white flex items-center gap-2">
                SolfaTunes
              </h1>
              <p className="text-[9px] sm:text-[10px] font-mono tracking-wide text-stone-500 font-bold mt-0.5">
                ABC & Tonic Sol-fa music studio
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <input
              ref={musicXmlInputRef}
              type="file"
              accept=".xml,.musicxml,application/xml,text/xml,application/vnd.recordare.musicxml+xml"
              onChange={handleImportMusicXml}
              className="hidden"
              aria-label="Import MusicXML file"
            />
            <Tooltip content="Open MusicXML" description="Import existing .xml or .musicxml sheet file" side="bottom">
              <button
                type="button"
                onClick={() => musicXmlInputRef.current?.click()}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 text-stone-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                aria-label="Open MusicXML project"
              >
                <FileUp size={16} />
                <span className="hidden sm:inline text-xs font-semibold">Open XML</span>
              </button>
            </Tooltip>

            <Tooltip content="Save MusicXML" description="Export project as standard MusicXML notation" side="bottom">
              <button
                type="button"
                onClick={handleExportMusicXml}
                disabled={!musicalDocument}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 text-stone-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Save project as MusicXML"
              >
                <FileDown size={16} />
                <span className="hidden sm:inline text-xs font-semibold">Save project</span>
              </button>
            </Tooltip>

            <Tooltip content="Export ABC" description="Download score in standard ABC text format" side="bottom">
              <button
                onClick={handleExportAbc}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 text-stone-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                aria-label="Download ABC notation"
              >
                <FileDown size={16} />
                <span className="hidden sm:inline text-xs font-semibold">ABC</span>
              </button>
            </Tooltip>

            <Tooltip content="Export MIDI" description="Generate .mid audio file for DAWs or media players" side="bottom">
              <button
                onClick={handleExportMidi}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-indigo-500/60 bg-indigo-600 px-3 text-white shadow-sm transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                aria-label="Export MIDI"
              >
                <Download size={16} />
                <span className="hidden sm:inline text-xs font-semibold">MIDI</span>
              </button>
            </Tooltip>

            {/* Quick Actions Command Palette Button */}
            <Tooltip content="Command Palette" shortcut="⌘K" description="Fast search and shortcut palette" side="bottom">
              <button
                type="button"
                onClick={() => setIsCommandPaletteOpen(true)}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-stone-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer shadow-sm"
                aria-label="Command Palette"
              >
                <Command size={15} />
                <span className="hidden md:inline text-xs font-semibold">Commands</span>
                <kbd className="hidden lg:inline text-[9px] font-mono text-stone-400 bg-black/40 px-1 py-0.5 rounded border border-white/10">⌘K</kbd>
              </button>
            </Tooltip>

            {/* Complete Full Screen Button */}
            <Tooltip content={isFullscreen ? 'Exit Full Screen' : 'Full Screen'} shortcut="F" description="Expand workspace to maximum viewport" side="bottom">
              <button
                type="button"
                onClick={handleToggleFullscreen}
                className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border px-3 transition-colors cursor-pointer shadow-sm ${
                  isFullscreen
                    ? 'bg-indigo-600 border-indigo-400 text-white shadow-[0_0_12px_rgba(99,102,241,0.5)]'
                    : 'border-white/10 bg-white/5 text-stone-300 hover:bg-white/10 hover:text-white'
                }`}
                aria-label="Toggle Full Screen"
              >
                {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                <span className="hidden sm:inline text-xs font-semibold">{isFullscreen ? 'Exit Full' : 'Full Screen'}</span>
              </button>
            </Tooltip>

            {/* Global Settings Menu Button */}
            <Tooltip content="Workspace Settings" shortcut="⌘," description="Customize display, notation, and playback defaults" side="bottom">
              <button
                type="button"
                onClick={() => setIsSettingsOpen(true)}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-stone-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer shadow-sm"
                aria-label="Settings"
              >
                <Settings size={16} />
                <span className="hidden sm:inline text-xs font-semibold">Settings</span>
              </button>
            </Tooltip>
          </div>
        </header>
      )}

      {musicXmlStatus && (
        <div
          role={musicXmlStatus.type === 'error' || musicXmlStatus.type === 'warning' ? 'alert' : 'status'}
          aria-live="polite"
          className={`border-b px-4 py-2 text-xs ${
            musicXmlStatus.type === 'error'
              ? 'border-red-400/20 bg-red-950/40 text-red-200'
              : musicXmlStatus.type === 'warning'
                ? 'border-amber-400/20 bg-amber-950/30 text-amber-200'
                : 'border-emerald-400/20 bg-emerald-950/20 text-emerald-200'
          }`}
        >
          {musicXmlStatus.message}
        </div>
      )}

      {/* Main Work Area Dashboard (Full Screen or Standard Responsive Grid) */}
      {isFullscreen ? (
        <div className="fixed inset-0 z-50 bg-[#0A0A0B] flex flex-col w-screen h-screen overflow-hidden">
          {/* Minimalist Fullscreen Navigation Strip */}
          <div className="px-6 py-2 bg-[#0F1115]/95 border-b border-indigo-500/20 backdrop-blur-md flex items-center justify-between gap-3 shadow-md z-30 shrink-0">
            <div className="flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-bold text-xs uppercase tracking-wider text-white">
                {score?.title || 'SolfaTunes'}
              </span>
              <span className="text-[10px] text-stone-400 font-mono hidden sm:inline">
                Key: {score?.key} • Meter: {score?.meter}
              </span>
              <span className="text-[9px] font-black uppercase px-2 py-0.5 bg-indigo-600/30 text-indigo-300 rounded-full border border-indigo-500/30">
                Complete Full Screen
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsCommandPaletteOpen(true)}
                className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-stone-300 text-xs font-semibold flex items-center gap-1 border border-white/10"
                title="Command Palette (Cmd+K)"
              >
                <Command size={12} />
                <span>Commands</span>
              </button>
              <button
                type="button"
                onClick={handleToggleFullscreen}
                className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 shadow"
                title="Exit Full Screen (Esc or F)"
              >
                <Minimize2 size={13} />
                <span>Exit Full Screen (Esc)</span>
              </button>
            </div>
          </div>

          {/* Full Screen Score Renderer */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <ScoreRenderer
              score={score}
              abcText={abcText}
              setAbcText={handleAbcTextChange}
              warnings={warnings}
              currentTick={currentTick}
              currentEighth={currentTick}
              fontSize={fontSize}
              setFontSize={setFontSize}
              scale={scale}
              setScale={setScale}
              mutedVoices={mutedVoices}
              toggleMute={toggleMute}
              selectedNote={selectedNote}
              onSelectNote={setSelectedNote}
              onUpdateScore={handleUpdateScore}
              studioMode={studioMode}
              setStudioMode={setStudioMode}
              playerRef={playerRef}
              onSeekTick={handleSeek}
              isExpanded={true}
              onToggleExpand={handleToggleFullscreen}
              settings={settings}
              onOpenSettings={() => setIsSettingsOpen(true)}
              onUpdateSettings={handleUpdateSettings}
              isFullscreen={isFullscreen}
              onToggleFullscreen={handleToggleFullscreen}
              isPlaying={isPlaying}
              onPlay={handlePlay}
              onPause={handlePause}
              onStop={handleStop}
            />
          </div>
        </div>
      ) : (
        <main className="flex-1 min-h-0 flex flex-col lg:flex-row p-3 sm:p-5 lg:p-6 xl:p-8 pb-36 lg:pb-8 gap-4 lg:gap-6 xl:gap-8 lg:overflow-hidden">
          {/* Collapsible Sidebar on Left (controlled by settings.showSidebar) */}
          {settings.showSidebar && !settings.zenMode ? (
            <div className="order-2 min-w-0 lg:order-1 lg:w-[320px] xl:w-[340px] 2xl:w-[380px] lg:shrink-0 lg:h-full lg:min-h-0 transition-all duration-200">
              <Sidebar
                onLoadAbcText={handleLoadAbcText}
                warnings={warnings}
                onLoadScore={handleLoadScore}
                selectedScoreId={SCORES.find(song => song.abcText === abcText)?.id}
                onCollapse={() => handleUpdateSettings({ ...settings, showSidebar: false })}
              />
            </div>
          ) : !settings.zenMode ? (
            <button
              type="button"
              onClick={() => handleUpdateSettings({ ...settings, showSidebar: true })}
              className="order-2 lg:order-1 self-start lg:self-stretch flex items-center justify-center gap-2 bg-[#13161C] border border-white/10 rounded-lg px-2.5 py-1.5 lg:w-9 text-stone-300 hover:text-white hover:bg-white/10 shadow-lg cursor-pointer transition-colors"
              title="Expand score library"
            >
              <ChevronRight size={16} />
              <span className="text-[11px] font-bold uppercase tracking-wider lg:[writing-mode:vertical-rl] lg:rotate-180">
                Library
              </span>
            </button>
          ) : null}

          {/* Score Area */}
          <div ref={scoreContainerRef} className="order-1 min-w-0 h-[70vh] min-h-[32rem] scroll-mt-3 lg:order-2 lg:flex-1 lg:h-full lg:min-h-0">
            <ScoreRenderer
              score={score}
              abcText={abcText}
              setAbcText={handleAbcTextChange}
              warnings={warnings}
              currentTick={currentTick}
              currentEighth={currentTick}
              fontSize={fontSize}
              setFontSize={setFontSize}
              scale={scale}
              setScale={setScale}
              mutedVoices={mutedVoices}
              toggleMute={toggleMute}
              selectedNote={selectedNote}
              onSelectNote={setSelectedNote}
              onUpdateScore={handleUpdateScore}
              studioMode={studioMode}
              setStudioMode={setStudioMode}
              playerRef={playerRef}
              onSeekTick={handleSeek}
              isExpanded={!settings.showSidebar || settings.zenMode}
              onToggleExpand={() => handleUpdateSettings({ ...settings, showSidebar: !settings.showSidebar })}
              settings={settings}
              onOpenSettings={() => setIsSettingsOpen(true)}
              onUpdateSettings={handleUpdateSettings}
              isFullscreen={isFullscreen}
              onToggleFullscreen={handleToggleFullscreen}
              isPlaying={isPlaying}
              onPlay={handlePlay}
              onPause={handlePause}
              onStop={handleStop}
            />
          </div>
        </main>
      )}

      {/* Unified Floating Playback Dock ("Always Within Reach" - hideable in Settings & Zen Mode) */}
      {settings.showPlaybackDock && !settings.zenMode && (
        <FloatingPlaybackDock
          score={score}
          isPlaying={isPlaying}
          onPlay={handlePlay}
          onPause={handlePause}
          onStop={handleStop}
          currentTick={currentTick}
          totalTicks={totalTicks}
          bpm={bpm}
          setBpm={handleSetBpm}
          transpose={transpose}
          setTranspose={setTranspose}
          masterVolume={masterVolume}
          setMasterVolume={setMasterVolume}
          onSeek={handleSeek}
          mutedVoices={mutedVoices}
          toggleMute={toggleMute}
          isLooping={isLooping}
          toggleLoop={toggleLoop}
          getTranspositionLabel={getTranspositionLabel}
        />
      )}

      {/* Workspace & View Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
      />

      {/* Quick Actions Command Palette (Cmd+K) */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        scores={SCORES}
        selectedScoreId={SCORES.find(song => song.abcText === abcText)?.id}
        onSelectScore={handleLoadScore}
        workspaceMode={studioMode}
        onSetWorkspaceMode={setStudioMode}
        isPlaying={isPlaying}
        onPlay={handlePlay}
        onPause={handlePause}
        onStop={handleStop}
        isLooping={isLooping}
        toggleLoop={toggleLoop}
        bpm={bpm}
        onSetBpm={handleSetBpm}
        transpose={transpose}
        onSetTranspose={setTranspose}
        isFullscreen={isFullscreen}
        onToggleFullscreen={handleToggleFullscreen}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onExportMidi={handleExportMidi}
        onExportAbc={handleExportAbc}
        onExportMusicXml={handleExportMusicXml}
        onTriggerImportMusicXml={() => musicXmlInputRef.current?.click()}
      />
    </div>
  );
}
