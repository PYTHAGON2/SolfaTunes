/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { getScoreDisplayTitle, SCORES, ScoreLibraryItem, ScoreTitleMode } from '../utils/scores';
import { ParseWarning } from '../types';
import { FileMusic, AlertTriangle, ChevronDown, ChevronUp, ChevronLeft, Music, Search, X } from 'lucide-react';
import { Tooltip } from './Tooltip';

interface SidebarProps {
  onLoadAbcText?: (text: string) => void;
  warnings: ParseWarning[];
  onLoadScore: (score: ScoreLibraryItem) => void;
  selectedScoreId?: string;
  onCollapse?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  warnings,
  onLoadScore,
  selectedScoreId,
  onCollapse,
}) => {
  const [showWarnings, setShowWarnings] = useState(true);
  const [titleMode, setTitleMode] = useState<ScoreTitleMode>('hymn');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredScores = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return SCORES;

    const normalizedQ = q.replace(/[^a-z0-9]/gi, '');

    return SCORES.filter((song) => {
      const hymnTitle = (song.hymnName || '').toLowerCase();
      const tuneTitle = (song.tuneName || '').toLowerCase();
      const generalTitle = song.title.toLowerCase();
      const composer = song.composer.toLowerCase();
      const fileName = song.fileName.toLowerCase();
      const hymnMeter = (song.hymnMeter || '').toLowerCase();
      const timeMeter = (song.timeMeter || '').toLowerCase();

      // Direct text inclusion (title, tune, composer, meter, filename)
      if (
        hymnTitle.includes(q) ||
        tuneTitle.includes(q) ||
        generalTitle.includes(q) ||
        composer.includes(q) ||
        fileName.includes(q) ||
        hymnMeter.includes(q) ||
        timeMeter.includes(q)
      ) {
        return true;
      }

      // Normalized meter matching: e.g. "6.6.6.6" matches "6666", "8.8.8.8" matches "8888", "8.6.8.6" matches "8686", "8.7.8.7" matches "8787"
      if (normalizedQ && hymnMeter) {
        const normHymnMeter = hymnMeter.replace(/[^a-z0-9]/gi, '');
        if (normHymnMeter.includes(normalizedQ) || normalizedQ.includes(normHymnMeter)) return true;
      }

      // Poetic meter abbreviations (CM, LM, SM)
      if (normalizedQ === 'cm' && (hymnMeter.includes('8.6.8.6') || hymnMeter.includes('cm'))) return true;
      if (normalizedQ === 'lm' && (hymnMeter.includes('8.8.8.8') || hymnMeter.includes('lm'))) return true;
      if (normalizedQ === 'sm' && (hymnMeter.includes('6.6.8.6') || hymnMeter.includes('8.6.8.6') || hymnMeter.includes('sm'))) return true;

      return false;
    });
  }, [searchQuery]);

  return (
    <div className="w-full lg:w-[380px] bg-[#0F1115] border-r border-white/5 flex flex-col h-full shadow-xl">
      {/* Sidebar Header */}
      <div className="px-4 py-4 sm:px-6 sm:py-5 border-b border-white/5 bg-[#13161C]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-white">
            <FileMusic className="text-[#4F46E5] h-5 w-5" />
            <h2 className="font-sans font-black text-sm uppercase tracking-wider">Score library</h2>
          </div>
          {onCollapse && (
            <Tooltip content="Hide Sidebar" description="Fold score library to maximize sheet music view" side="left">
              <button
                type="button"
                onClick={onCollapse}
                className="p-1 hover:bg-white/10 rounded-md text-stone-400 hover:text-white transition-colors cursor-pointer"
                aria-label="Fold away score library panel"
              >
                <ChevronLeft size={16} />
              </button>
            </Tooltip>
          )}
        </div>
        <p className="text-[11px] text-stone-400 mt-1">
          Choose a score to open it.
        </p>
      </div>

      {/* Editor Content Area */}
      <div className="flex-1 overflow-auto p-4 sm:p-6 flex flex-col gap-4">
        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-stone-100">Available scores</h3>
              <p className="mt-0.5 text-[11px] text-stone-500">
                {searchQuery
                  ? `${filteredScores.length} of ${SCORES.length} matching`
                  : `${SCORES.length} in your library`}
              </p>
            </div>
            <div
              role="group"
              aria-label="Score title display"
              className="inline-flex shrink-0 rounded-lg border border-white/10 bg-black/30 p-0.5"
            >
              {(['hymn', 'tune'] as const).map(mode => (
                <Tooltip
                  key={mode}
                  content={mode === 'hymn' ? 'Hymn Titles' : 'Tune Names'}
                  description={mode === 'hymn' ? 'Display hymns by their liturgical first line' : 'Display hymns by their traditional tune name'}
                  side="bottom"
                >
                  <button
                    type="button"
                    onClick={() => setTitleMode(mode)}
                    aria-pressed={titleMode === mode}
                    className={`min-h-9 rounded-md px-2.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                      titleMode === mode
                        ? 'bg-indigo-600 text-white'
                        : 'text-stone-400 hover:text-white'
                    }`}
                  >
                    {mode === 'hymn' ? 'Hymn title' : 'Tune name'}
                  </button>
                </Tooltip>
              ))}
            </div>
          </div>

          {/* Search Button / Input before the hymns (matching Command Palette style, supports hymn meters like 6.6.6.6) */}
          <div className="mb-3 relative flex items-center gap-2.5 bg-[#161822] border border-white/10 rounded-xl px-3 py-2 text-xs focus-within:border-indigo-500/60 focus-within:ring-1 focus-within:ring-indigo-500/30 transition-all shadow-inner">
            <Search size={15} className="text-indigo-400 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search hymns, tunes, or meter (e.g. 6.6.6.6)..."
              className="flex-1 bg-transparent text-stone-200 placeholder-stone-500 focus:outline-none text-xs"
              aria-label="Search hymns, tunes, or meter"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="p-1 hover:bg-white/10 text-stone-400 hover:text-white rounded cursor-pointer transition-colors"
                title="Clear search"
                aria-label="Clear search"
              >
                <X size={13} />
              </button>
            ) : (
              <span className="text-[10px] font-mono text-stone-500 px-1 bg-black/40 rounded border border-white/5 hidden sm:inline">
                {SCORES.length}
              </span>
            )}
          </div>

          {filteredScores.length > 0 ? (
            <div className="grid grid-cols-1 gap-2">
              {filteredScores.map(song => {
                const isSelected = song.id === selectedScoreId;
                const primaryTitle = getScoreDisplayTitle(song, titleMode);
                const secondaryTitle = titleMode === 'hymn'
                  ? (song.tuneName && song.tuneName.toLowerCase() !== primaryTitle.toLowerCase()
                      ? song.tuneName
                      : (song.title && song.title.toLowerCase() !== primaryTitle.toLowerCase() ? song.title : undefined))
                  : (song.hymnName && song.hymnName.toLowerCase() !== primaryTitle.toLowerCase()
                      ? song.hymnName
                      : undefined);
                const scoreFileDescription = song.format === 'musicxml'
                  ? `MusicXML • ${song.composer} • ${song.fileName}`
                  : `ABC • ${song.composer} • ${song.fileName}`;

                return (
                  <Tooltip
                    key={song.id}
                    content={isSelected ? 'Currently Active Score' : `Load ${getScoreDisplayTitle(song, titleMode)}`}
                    description={scoreFileDescription}
                    side="right"
                  >
                    <button
                      type="button"
                      onClick={() => onLoadScore(song)}
                      aria-pressed={isSelected}
                      className={`w-full min-h-[64px] text-left px-3.5 py-3 rounded-xl border transition-all cursor-pointer flex items-center gap-3 ${
                        isSelected
                          ? 'border-indigo-500/60 bg-indigo-500/10 text-white shadow-sm'
                          : 'border-white/5 bg-white/[0.02] text-stone-300 hover:bg-white/[0.06] hover:border-indigo-500/40 hover:text-white'
                      }`}
                    >
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${isSelected ? 'bg-indigo-500/20 text-indigo-300' : 'bg-white/5 text-stone-400'}`}>
                        <Music size={16} aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold leading-snug">{getScoreDisplayTitle(song, titleMode)}</span>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-stone-400">
                          {secondaryTitle && (
                            <span className="truncate">
                              {titleMode === 'hymn' ? 'Tune: ' : 'Hymn: '}{secondaryTitle}
                            </span>
                          )}
                          {song.hymnMeter && (
                            <span className="px-1.5 py-0.2 rounded bg-indigo-500/15 text-indigo-300 font-mono text-[9px] font-bold border border-indigo-500/30">
                              {song.hymnMeter}
                            </span>
                          )}
                        </div>
                        <span className="mt-1 block truncate text-[10px] text-stone-500">
                          {scoreFileDescription.replace(/ • /g, ' · ')}
                        </span>
                      </span>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${isSelected ? 'bg-indigo-500/20 text-indigo-200' : 'bg-white/5 text-stone-400'}`}>
                        {isSelected ? 'Loaded' : 'Load'}
                      </span>
                    </button>
                  </Tooltip>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 text-center flex flex-col items-center justify-center gap-2">
              <Search size={22} className="text-stone-500" />
              <p className="text-xs font-semibold text-stone-300">
                No hymns match "{searchQuery}"
              </p>
              <p className="text-[10px] text-stone-500">
                Try searching by hymn title, tune name, or meter like 8.8.8.8, 8.6.8.6, or 6.6.6.6
              </p>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="mt-1 px-3 py-1 bg-white/10 hover:bg-white/15 text-stone-200 text-xs font-bold rounded-lg cursor-pointer transition-colors"
              >
                Clear search
              </button>
            </div>
          )}
        </div>


        {/* Collapsible Parser Warnings Banner */}
        {warnings.length > 0 && (
          <div className="border border-red-500/20 rounded-lg bg-red-500/10 overflow-hidden shadow-sm mt-auto">
            <button
              onClick={() => setShowWarnings(!showWarnings)}
              className="w-full flex items-center justify-between px-4 py-2.5 bg-red-500/20 border-b border-red-500/10 text-red-200 text-xs font-semibold select-none cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} className="text-red-400" />
                <span>Parser Warnings ({warnings.length})</span>
              </div>
              {showWarnings ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showWarnings && (
              <div className="p-3 max-h-[140px] overflow-auto divide-y divide-red-500/10">
                {warnings.map((warn, wIdx) => (
                  <div key={`warning-${wIdx}`} className="py-1.5 text-[10px] text-red-200/80 font-sans">
                    <span className="font-bold text-red-400">
                      {warn.voiceId ? `Voice [${warn.voiceId}]: ` : ''}
                    </span>
                    {warn.reason}
                    {warn.rawText && (
                      <code className="block mt-0.5 bg-red-500/20 px-1 py-0.5 rounded text-red-300 text-[9px] font-mono w-fit">
                        Raw: "{warn.rawText}"
                      </code>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
