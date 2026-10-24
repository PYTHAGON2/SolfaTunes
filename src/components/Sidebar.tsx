/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { getScoreDisplayTitle, SCORES, ScoreLibraryItem, ScoreTitleMode } from '../utils/scores';
import { ParseWarning } from '../types';
import { FileMusic, AlertTriangle, Upload, ChevronDown, ChevronUp, ChevronLeft, Music } from 'lucide-react';
import { Tooltip } from './Tooltip';

interface SidebarProps {
  onLoadAbcText: (text: string) => void;
  warnings: ParseWarning[];
  onLoadScore: (score: ScoreLibraryItem) => void;
  selectedScoreId?: string;
  onCollapse?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  onLoadAbcText,
  warnings,
  onLoadScore,
  selectedScoreId,
  onCollapse,
}) => {
  const [dragActive, setDragActive] = useState(false);
  const [showWarnings, setShowWarnings] = useState(true);
  const [titleMode, setTitleMode] = useState<ScoreTitleMode>('hymn');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Drag and drop handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      readAndSetFile(file);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      readAndSetFile(e.target.files[0]);
    }
  };

  const readAndSetFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target && typeof event.target.result === 'string') {
        onLoadAbcText(event.target.result);
      }
    };
    reader.readAsText(file);
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

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
          Choose a hymn to open its score, or import your own.
        </p>
      </div>

      {/* Editor Content Area */}
      <div className="flex-1 overflow-auto p-4 sm:p-6 flex flex-col gap-5 sm:gap-6">
        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-stone-100">Available scores</h3>
              <p className="mt-0.5 text-[11px] text-stone-500">{SCORES.length} in your library</p>
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
          {SCORES.length > 0 ? (
            <div className="grid grid-cols-1 gap-2">
              {SCORES.map(song => {
                const isSelected = song.id === selectedScoreId;
                const secondaryTitle = titleMode === 'hymn'
                  ? (song.hymnName ? song.tuneName || song.title : undefined)
                  : (song.tuneName ? song.hymnName : undefined);

                return (
                  <Tooltip
                    key={song.id}
                    content={isSelected ? 'Currently Active Score' : `Load ${getScoreDisplayTitle(song, titleMode)}`}
                    description={`${song.composer} • ${song.fileName}`}
                    side="right"
                  >
                    <button
                      type="button"
                      onClick={() => onLoadScore(song)}
                      aria-pressed={isSelected}
                      className={`w-full min-h-[64px] text-left px-3.5 py-3 rounded-xl border transition-all cursor-pointer flex items-center gap-3 ${
                        isSelected
                          ? 'border-indigo-500/60 bg-indigo-500/10 text-white'
                          : 'border-white/5 bg-white/[0.02] text-stone-300 hover:bg-white/[0.06] hover:border-indigo-500/40 hover:text-white'
                      }`}
                    >
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${isSelected ? 'bg-indigo-500/20 text-indigo-300' : 'bg-white/5 text-stone-400'}`}>
                        <Music size={16} aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold leading-snug">{getScoreDisplayTitle(song, titleMode)}</span>
                        {secondaryTitle && (
                          <span className="mt-0.5 block truncate text-[11px] text-stone-400">
                            {titleMode === 'hymn' ? 'Tune: ' : 'Hymn: '}{secondaryTitle}
                          </span>
                        )}
                        <span className="mt-1 block truncate text-[10px] text-stone-500">
                          {song.composer} · {song.fileName}
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
            <p className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-stone-400">
              No scores found. Add ABC text files to the <code className="text-indigo-300">scores/</code> folder.
            </p>
          )}
        </div>

        {/* Drag and Drop File Zone */}
        <Tooltip
          content="Import Score File"
          description="Drag & drop or browse to load ABC (.abc) or Plain Text (.txt) scores"
          side="top"
        >
          <div
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            onClick={triggerFileSelect}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                triggerFileSelect();
              }
            }}
            role="button"
            tabIndex={0}
            aria-label="Import an ABC or TXT music file"
            className={`border-2 border-dashed rounded-lg p-5 text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-2 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
              dragActive
                ? 'border-[#4F46E5] bg-[#4F46E5]/10 scale-[0.99]'
                : 'border-white/10 hover:border-[#4F46E5]/50 bg-white/[0.01] hover:bg-white/[0.03]'
            }`}
          >
            <Upload size={20} className={dragActive ? 'text-[#6366F1]' : 'text-stone-400'} />
            <div>
              <p className="text-xs font-semibold text-stone-200">
                {dragActive ? 'Drop your file here!' : 'Import .abc or .txt file'}
              </p>
              <p className="text-[10px] text-stone-500 mt-1">
                Drag & drop or click to upload from your computer
              </p>
            </div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileInput}
              accept=".abc,.txt"
              className="hidden"
            />
          </div>
        </Tooltip>

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
