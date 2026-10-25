/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  Music,
  Play,
  Pause,
  Square,
  Maximize2,
  Minimize2,
  Sliders,
  Settings,
  Download,
  FileUp,
  FileDown,
  Repeat,
  Sparkles,
  Eye,
  Edit2,
  Code,
  Columns,
  FileText,
  Volume2,
  ArrowRight,
  X,
  Compass,
} from 'lucide-react';
import { ScoreLibraryItem, getScoreDisplayTitle } from '../utils/scores';
import { AppSettings } from '../utils/settings';

export type WorkspaceMode = 'read' | 'lyrics' | 'interactive' | 'source' | 'pianoroll' | 'split';

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  scores: ScoreLibraryItem[];
  selectedScoreId?: string;
  onSelectScore: (score: ScoreLibraryItem) => void;
  workspaceMode: WorkspaceMode;
  onSetWorkspaceMode: (mode: WorkspaceMode) => void;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  isLooping: boolean;
  toggleLoop: () => void;
  bpm: number;
  onSetBpm: (bpm: number) => void;
  transpose: number;
  onSetTranspose: (semitones: number) => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  settings: AppSettings;
  onUpdateSettings: (newSettings: AppSettings) => void;
  onOpenSettings: () => void;
  onExportMidi: () => void;
  onExportAbc: () => void;
  onExportMusicXml: () => void;
  onTriggerImportMusicXml: () => void;
}

interface PaletteCommand {
  id: string;
  title: string;
  category: 'Workspace' | 'Score Library' | 'Playback' | 'Transposition & Tempo' | 'View & Focus' | 'Piano Roll' | 'File & Export';
  subtitle?: string;
  icon: React.ReactNode;
  shortcut?: string;
  badge?: string;
  action: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  scores,
  selectedScoreId,
  onSelectScore,
  workspaceMode,
  onSetWorkspaceMode,
  isPlaying,
  onPlay,
  onPause,
  onStop,
  isLooping,
  toggleLoop,
  bpm,
  onSetBpm,
  transpose,
  onSetTranspose,
  isFullscreen,
  onToggleFullscreen,
  settings,
  onUpdateSettings,
  onOpenSettings,
  onExportMidi,
  onExportAbc,
  onExportMusicXml,
  onTriggerImportMusicXml,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus input whenever opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Construct comprehensive list of searchable commands
  const allCommands = useMemo<PaletteCommand[]>(() => {
    const list: PaletteCommand[] = [
      // 1. Workspaces
      {
        id: 'ws-score',
        title: 'Score View (Read & Rehearse)',
        category: 'Workspace',
        subtitle: 'Pure sheet music display with active playback cursor',
        icon: <Eye size={16} className="text-indigo-400" />,
        badge: workspaceMode === 'read' ? 'Active' : undefined,
        action: () => {
          onSetWorkspaceMode('read');
          onClose();
        },
      },
      {
        id: 'ws-pianoroll',
        title: 'Interactive Piano Roll (Sequencer)',
        category: 'Workspace',
        subtitle: 'SATB multi-channel grid sequencer with monophonic rules',
        icon: <span className="text-base">🎹</span>,
        badge: workspaceMode === 'pianoroll' ? 'Active' : undefined,
        action: () => {
          onSetWorkspaceMode('pianoroll');
          onClose();
        },
      },
      {
        id: 'ws-split',
        title: 'Split View (Score + Piano Roll)',
        category: 'Workspace',
        subtitle: 'Side-by-side / top-and-bottom synchronized score and sequencer',
        icon: <Columns size={16} className="text-purple-400" />,
        badge: workspaceMode === 'split' ? 'Active' : undefined,
        action: () => {
          onSetWorkspaceMode('split');
          onClose();
        },
      },
      {
        id: 'ws-interactive',
        title: 'Visual Edit Mode',
        category: 'Workspace',
        subtitle: 'Click notes to edit syllables, registers, and durations',
        icon: <Edit2 size={16} className="text-emerald-400" />,
        badge: workspaceMode === 'interactive' ? 'Active' : undefined,
        action: () => {
          onSetWorkspaceMode('interactive');
          onClose();
        },
      },
      {
        id: 'ws-source',
        title: 'Source Code Editor (Tonic Sol-fa & ABC)',
        category: 'Workspace',
        subtitle: 'Spacious code editor with syntax highlighting',
        icon: <Code size={16} className="text-amber-400" />,
        badge: workspaceMode === 'source' ? 'Active' : undefined,
        action: () => {
          onSetWorkspaceMode('source');
          onClose();
        },
      },
      {
        id: 'ws-lyrics',
        title: 'Hymn Lyrics View',
        category: 'Workspace',
        subtitle: 'Formatted text view of stanzas and choruses',
        icon: <FileText size={16} className="text-blue-400" />,
        badge: workspaceMode === 'lyrics' ? 'Active' : undefined,
        action: () => {
          onSetWorkspaceMode('lyrics');
          onClose();
        },
      },

      // 2. Playback
      {
        id: 'play-toggle',
        title: isPlaying ? 'Pause Playback' : 'Play Score',
        category: 'Playback',
        subtitle: isPlaying ? 'Temporarily pause synth playback' : `Start playback at ${bpm} BPM`,
        icon: isPlaying ? <Pause size={16} className="text-amber-400" /> : <Play size={16} className="text-emerald-400" />,
        shortcut: 'Space',
        action: () => {
          if (isPlaying) onPause();
          else onPlay();
          onClose();
        },
      },
      {
        id: 'play-stop',
        title: 'Stop & Rewind to Beginning',
        category: 'Playback',
        subtitle: 'Halt playback and reset playhead to measure 1',
        icon: <Square size={16} className="text-stone-400" />,
        action: () => {
          onStop();
          onClose();
        },
      },
      {
        id: 'play-loop',
        title: isLooping ? 'Disable Playback Loop' : 'Enable Playback Loop',
        category: 'Playback',
        subtitle: 'Continuously loop score playback',
        icon: <Repeat size={16} className={isLooping ? 'text-indigo-400' : 'text-stone-400'} />,
        badge: isLooping ? 'Looping' : undefined,
        action: () => {
          toggleLoop();
          onClose();
        },
      },

      // 3. View & Focus
      {
        id: 'view-fullscreen',
        title: isFullscreen ? 'Exit Full Screen' : 'Enter Complete Full Screen',
        category: 'View & Focus',
        subtitle: 'Maximize workspace to full display dimensions',
        icon: isFullscreen ? <Minimize2 size={16} className="text-indigo-400" /> : <Maximize2 size={16} className="text-indigo-400" />,
        shortcut: 'F',
        badge: isFullscreen ? 'Active' : undefined,
        action: () => {
          onToggleFullscreen();
          onClose();
        },
      },
      {
        id: 'view-zen',
        title: settings.zenMode ? 'Exit Zen Mode' : 'Enter Distraction-Free Zen Mode',
        category: 'View & Focus',
        subtitle: 'Hide all chrome, sidebars, and docks for pure reading',
        icon: <Sparkles size={16} className="text-amber-400" />,
        shortcut: 'Z',
        badge: settings.zenMode ? 'Active' : undefined,
        action: () => {
          onUpdateSettings({ ...settings, zenMode: !settings.zenMode });
          onClose();
        },
      },
      {
        id: 'view-sidebar',
        title: settings.showSidebar ? 'Hide Score Library Sidebar' : 'Show Score Library Sidebar',
        category: 'View & Focus',
        subtitle: 'Toggle left panel score drawer',
        icon: <Columns size={16} className="text-stone-400" />,
        action: () => {
          onUpdateSettings({ ...settings, showSidebar: !settings.showSidebar });
          onClose();
        },
      },
      {
        id: 'view-playback-dock',
        title: settings.showPlaybackDock ? 'Hide Floating Playback Dock' : 'Show Floating Playback Dock',
        category: 'View & Focus',
        subtitle: 'Toggle bottom floating player dock',
        icon: <Volume2 size={16} className="text-stone-400" />,
        action: () => {
          onUpdateSettings({ ...settings, showPlaybackDock: !settings.showPlaybackDock });
          onClose();
        },
      },
      {
        id: 'view-legend',
        title: settings.showReferenceLegend ? 'Hide Tonic Sol-fa Legend' : 'Show Tonic Sol-fa Reference Legend',
        category: 'View & Focus',
        subtitle: 'Octave punctuation marks and scale degrees reference',
        icon: <FileText size={16} className="text-stone-400" />,
        action: () => {
          onUpdateSettings({ ...settings, showReferenceLegend: !settings.showReferenceLegend });
          onClose();
        },
      },
      ...[
        { label: 'Off', value: 0 },
        { label: 'Faint', value: 0.08 },
        { label: 'Standard', value: 0.16 },
        { label: 'Strong', value: 0.3 },
      ].map(({ label, value }) => ({
        id: `piano-roll-grid-${label.toLowerCase()}`,
        title: `Piano Roll Grid: ${label}`,
        category: 'Piano Roll' as const,
        subtitle: `Set piano roll beat-grid visibility to ${label.toLowerCase()}`,
        icon: <Sliders size={16} className="text-indigo-400" />,
        badge: settings.pianoRollGridOpacity === value ? 'Active' : undefined,
        action: () => {
          onUpdateSettings({ ...settings, pianoRollGridOpacity: value });
          onClose();
        },
      })),
      {
        id: 'view-settings',
        title: 'Open Workspace Settings',
        category: 'View & Focus',
        subtitle: 'Configure views, auto-format, audio previews, and warnings',
        icon: <Settings size={16} className="text-indigo-400" />,
        shortcut: 'Cmd+,',
        action: () => {
          onClose();
          onOpenSettings();
        },
      },

      // 4. Transposition & Tempo
      {
        id: 'pitch-up',
        title: 'Transpose Up (+1 Semitone)',
        category: 'Transposition & Tempo',
        subtitle: `Current offset: ${transpose > 0 ? `+${transpose}` : transpose} semitones`,
        icon: <span className="text-sm font-bold text-indigo-400">♯+</span>,
        action: () => {
          onSetTranspose(transpose + 1);
          onClose();
        },
      },
      {
        id: 'pitch-down',
        title: 'Transpose Down (-1 Semitone)',
        category: 'Transposition & Tempo',
        subtitle: `Current offset: ${transpose > 0 ? `+${transpose}` : transpose} semitones`,
        icon: <span className="text-sm font-bold text-indigo-400">♭-</span>,
        action: () => {
          onSetTranspose(transpose - 1);
          onClose();
        },
      },
      {
        id: 'pitch-reset',
        title: 'Reset Transposition (Original Key)',
        category: 'Transposition & Tempo',
        subtitle: 'Reset pitch offset to 0 semitones',
        icon: <span className="text-sm font-bold text-stone-400">♮0</span>,
        action: () => {
          onSetTranspose(0);
          onClose();
        },
      },
      {
        id: 'tempo-allegro',
        title: 'Set Tempo: Allegro (120 BPM)',
        category: 'Transposition & Tempo',
        subtitle: 'Brisk, lively pace',
        icon: <span className="text-xs font-mono font-bold text-stone-400">120</span>,
        action: () => {
          onSetBpm(120);
          onClose();
        },
      },
      {
        id: 'tempo-moderato',
        title: 'Set Tempo: Moderato (100 BPM)',
        category: 'Transposition & Tempo',
        subtitle: 'Standard moderate pace',
        icon: <span className="text-xs font-mono font-bold text-stone-400">100</span>,
        action: () => {
          onSetBpm(100);
          onClose();
        },
      },
      {
        id: 'tempo-andante',
        title: 'Set Tempo: Andante (80 BPM)',
        category: 'Transposition & Tempo',
        subtitle: 'Walking, gentle pace',
        icon: <span className="text-xs font-mono font-bold text-stone-400">80</span>,
        action: () => {
          onSetBpm(80);
          onClose();
        },
      },
      {
        id: 'tempo-largo',
        title: 'Set Tempo: Largo (60 BPM)',
        category: 'Transposition & Tempo',
        subtitle: 'Slow, solemn pace',
        icon: <span className="text-xs font-mono font-bold text-stone-400">60</span>,
        action: () => {
          onSetBpm(60);
          onClose();
        },
      },

      // 5. File & Export
      {
        id: 'file-export-midi',
        title: 'Export MIDI File (.mid)',
        category: 'File & Export',
        subtitle: 'Download 4-part SATB synthesized MIDI',
        icon: <Download size={16} className="text-indigo-400" />,
        action: () => {
          onExportMidi();
          onClose();
        },
      },
      {
        id: 'file-export-musicxml',
        title: 'Export MusicXML Project (.musicxml)',
        category: 'File & Export',
        subtitle: 'Save standard sheet music XML for Finale / Sibelius / MuseScore',
        icon: <FileDown size={16} className="text-emerald-400" />,
        action: () => {
          onExportMusicXml();
          onClose();
        },
      },
      {
        id: 'file-export-abc',
        title: 'Export ABC Notation (.abc)',
        category: 'File & Export',
        subtitle: 'Download raw ABC source file',
        icon: <FileDown size={16} className="text-amber-400" />,
        action: () => {
          onExportAbc();
          onClose();
        },
      },
      {
        id: 'file-import-xml',
        title: 'Open MusicXML File...',
        category: 'File & Export',
        subtitle: 'Import external score from MusicXML file',
        icon: <FileUp size={16} className="text-blue-400" />,
        action: () => {
          onClose();
          onTriggerImportMusicXml();
        },
      },
    ];

    // Append score library items
    scores.forEach((song) => {
      const displayTitle = getScoreDisplayTitle(song, 'hymn');
      const isSelected = song.id === selectedScoreId;
      list.push({
        id: `song-${song.id}`,
        title: displayTitle,
        category: 'Score Library',
        subtitle: `${song.composer} • ${song.tuneName ? `Tune: ${song.tuneName}` : song.fileName}`,
        icon: <Music size={16} className={isSelected ? 'text-indigo-400' : 'text-stone-400'} />,
        badge: isSelected ? 'Loaded' : undefined,
        action: () => {
          onSelectScore(song);
          onClose();
        },
      });
    });

    return list;
  }, [
    scores,
    selectedScoreId,
    workspaceMode,
    isPlaying,
    isLooping,
    bpm,
    transpose,
    isFullscreen,
    settings,
  ]);

  // Filter commands by search query
  const filteredCommands = useMemo(() => {
    if (!query.trim()) return allCommands;
    const q = query.toLowerCase().trim();
    return allCommands.filter(
      (cmd) =>
        cmd.title.toLowerCase().includes(q) ||
        (cmd.subtitle && cmd.subtitle.toLowerCase().includes(q)) ||
        cmd.category.toLowerCase().includes(q)
    );
  }, [allCommands, query]);

  // Handle keyboard navigation within the list
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredCommands.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % Math.max(1, filteredCommands.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filteredCommands[selectedIndex];
      if (cmd) {
        cmd.action();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  // Ensure Escape key always closes Command Palette regardless of focused element
  useEffect(() => {
    if (!isOpen) return;
    const handleWindowKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, [isOpen, onClose]);

  // Ensure active item is scrolled into view
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector('[data-selected="true"]');
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-md flex items-start justify-center pt-16 sm:pt-24 px-4 pb-6 overflow-y-auto animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-[#111319] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh] text-stone-200"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/10 bg-[#161822]">
          <Search size={18} className="text-indigo-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command, song name, or tool... (e.g. 'Piano Roll', 'Amazing Grace', 'Transpose', 'Play')"
            className="flex-1 bg-transparent text-white placeholder-stone-500 text-sm focus:outline-none"
            aria-label="Search actions and scores"
          />
          {query ? (
            <button
              onClick={() => setQuery('')}
              className="p-1 text-stone-400 hover:text-white rounded cursor-pointer"
            >
              <X size={14} />
            </button>
          ) : (
            <kbd className="hidden sm:inline-block px-2 py-0.5 text-[10px] font-mono text-stone-400 bg-black/40 border border-white/10 rounded">
              ESC
            </kbd>
          )}
        </div>

        {/* Results List */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-2 divide-y divide-white/5 scrollbar-thin">
          {filteredCommands.length === 0 ? (
            <div className="py-12 text-center text-stone-500">
              <Compass size={32} className="mx-auto mb-2 opacity-40 text-indigo-400" />
              <p className="text-sm font-semibold text-stone-400">No matching commands found</p>
              <p className="text-xs text-stone-600 mt-1">Try searching for &quot;Score&quot;, &quot;Piano Roll&quot;, or &quot;MIDI&quot;</p>
            </div>
          ) : (
            filteredCommands.map((cmd, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={cmd.id}
                  data-selected={isSelected}
                  onClick={() => cmd.action()}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${
                    isSelected ? 'bg-indigo-600 text-white' : 'hover:bg-white/5 text-stone-300'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`p-2 rounded-lg shrink-0 ${
                        isSelected ? 'bg-white/20 text-white' : 'bg-white/5'
                      }`}
                    >
                      {cmd.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm truncate">{cmd.title}</span>
                        {cmd.badge && (
                          <span
                            className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                              isSelected
                                ? 'bg-white/25 text-white'
                                : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                            }`}
                          >
                            {cmd.badge}
                          </span>
                        )}
                      </div>
                      {cmd.subtitle && (
                        <p
                          className={`text-xs truncate mt-0.5 ${
                            isSelected ? 'text-indigo-100' : 'text-stone-400'
                          }`}
                        >
                          {cmd.subtitle}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded ${
                        isSelected ? 'text-indigo-200' : 'text-stone-500'
                      }`}
                    >
                      {cmd.category}
                    </span>
                    {cmd.shortcut && (
                      <kbd
                        className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                          isSelected
                            ? 'bg-white/20 border-white/30 text-white'
                            : 'bg-black/40 border-white/10 text-stone-400'
                        }`}
                      >
                        {cmd.shortcut}
                      </kbd>
                    )}
                    <ArrowRight
                      size={14}
                      className={isSelected ? 'text-white opacity-100' : 'opacity-0'}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer shortcuts hint */}
        <div className="px-4 py-2 bg-[#0E1016] border-t border-white/5 flex items-center justify-between text-[11px] text-stone-500 font-mono">
          <div className="flex items-center gap-3">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>Esc Close</span>
          </div>
          <span className="text-stone-600">Quick Palette</span>
        </div>
      </div>
    </div>
  );
};
