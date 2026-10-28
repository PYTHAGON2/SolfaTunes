/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Play,
  Pause,
  Square,
  Volume2,
  VolumeX,
  Repeat,
  SlidersHorizontal,
  ChevronUp,
  ChevronDown
} from 'lucide-react';
import { ParsedScore } from '../types';
import { findActiveMeasureRange, getScoreMeasureRanges } from '../utils/playback_timeline';
import { Tooltip } from './Tooltip';
import { TICKS_PER_QUARTER_NOTE } from '../engine/timing';

export interface FloatingPlaybackDockProps {
  score: ParsedScore | null;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  currentTick: number;
  totalTicks: number;
  bpm: number;
  setBpm: (bpm: number) => void;
  transpose: number;
  setTranspose: (transpose: number) => void;
  masterVolume: number;
  setMasterVolume: (vol: number) => void;
  onSeek: (tick: number) => void;
  mutedVoices: { [voiceId: string]: boolean };
  toggleMute: (voiceId: string) => void;
  isLooping: boolean;
  toggleLoop: () => void;
  getTranspositionLabel: (val: number) => string;
}

export const FloatingPlaybackDock: React.FC<FloatingPlaybackDockProps> = ({
  score,
  isPlaying,
  onPlay,
  onPause,
  onStop,
  currentTick,
  totalTicks,
  bpm,
  setBpm,
  transpose,
  setTranspose,
  masterVolume,
  setMasterVolume,
  onSeek,
  mutedVoices,
  toggleMute,
  isLooping,
  toggleLoop,
  getTranspositionLabel,
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(true);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [hoverPosition, setHoverPosition] = useState<{ xPercent: number; tick: number } | null>(null);

  const progressBarRef = useRef<HTMLDivElement | null>(null);

  // Convert piano-roll ticks to seconds using quarter-note BPM.
  const ticksToSeconds = (ticks: number) => {
    return ticks * (60 / (Math.max(20, bpm) * TICKS_PER_QUARTER_NOTE));
  };

  const formatTime = (ticks: number) => {
    const totalSecs = Math.max(0, Math.floor(ticksToSeconds(ticks)));
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const currentTimeStr = useMemo(() => formatTime(currentTick), [currentTick, bpm]);
  const totalTimeStr = useMemo(() => formatTime(totalTicks), [totalTicks, bpm]);

  const progressPercent = totalTicks > 0 ? Math.min(100, Math.max(0, (currentTick / totalTicks) * 100)) : 0;

  // Approximate current measure index based on score structure
  const currentMeasureInfo = useMemo(() => {
    const measureRanges = getScoreMeasureRanges(score);
    const activeRange = findActiveMeasureRange(measureRanges, currentTick);
    const current = activeRange
      ? measureRanges.indexOf(activeRange) + 1
      : currentTick <= 0 ? 1 : measureRanges.length;

    return {
      current: Math.max(1, current),
      total: Math.max(1, measureRanges.length),
    };
  }, [score, currentTick]);

  // Handle clicking or dragging on progress bar to scrub (mouse & mobile touch)
  const calculateTickFromClientX = (clientX: number) => {
    if (!progressBarRef.current || totalTicks <= 0) return 0;
    const rect = progressBarRef.current.getBoundingClientRect();
    const clickX = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const fraction = clickX / rect.width;
    return Math.round(fraction * totalTicks);
  };

  const handleProgressBarMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true);
    const targetTick = calculateTickFromClientX(e.clientX);
    onSeek(targetTick);
  };

  const handleProgressBarTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length > 0) {
      setIsDragging(true);
      const targetTick = calculateTickFromClientX(e.touches[0].clientX);
      onSeek(targetTick);
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const targetTick = calculateTickFromClientX(e.clientX);
        onSeek(targetTick);
      }
    };

    const handleMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (isDragging && e.touches.length > 0) {
        const targetTick = calculateTickFromClientX(e.touches[0].clientX);
        onSeek(targetTick);
      }
    };

    const handleTouchEnd = () => {
      if (isDragging) {
        setIsDragging(false);
      }
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleTouchMove, { passive: true });
      window.addEventListener('touchend', handleTouchEnd);
      window.addEventListener('touchcancel', handleTouchEnd);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [isDragging, totalTicks]);

  const handleProgressBarHover = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current || totalTicks <= 0) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const fraction = clickX / rect.width;
    setHoverPosition({
      xPercent: fraction * 100,
      tick: Math.round(fraction * totalTicks),
    });
  };

  const handleProgressBarLeave = () => {
    setHoverPosition(null);
  };

  // Pre-configured voice list
  const voiceList = useMemo(() => {
    if (!score) return [];
    return score.voices.map((v) => ({
      id: v.id,
      name: v.name,
      label: v.name.charAt(0).toUpperCase() || v.id.charAt(0).toUpperCase(),
      color:
        v.id === 'V1'
          ? 'text-indigo-400 border-indigo-500/30'
          : v.id === 'V2'
          ? 'text-pink-400 border-pink-500/30'
          : v.id === 'V3'
          ? 'text-emerald-400 border-emerald-500/30'
          : 'text-amber-400 border-amber-500/30',
      activeBg:
        v.id === 'V1'
          ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/50'
          : v.id === 'V2'
          ? 'bg-pink-600/20 text-pink-300 border-pink-500/50'
          : v.id === 'V3'
          ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/50'
          : 'bg-amber-600/20 text-amber-300 border-amber-500/50',
    }));
  }, [score]);

  return (
    <aside
      aria-label="Playback Controller"
      className="fixed bottom-3 left-3 right-3 md:left-6 md:right-6 lg:left-8 lg:right-8 z-40 transition-all duration-300 ease-out"
    >
      <div className="max-w-7xl mx-auto bg-[#0F1115]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-[0_12px_45px_rgba(0,0,0,0.85)] ring-1 ring-white/5 overflow-visible">
        {/* COLLAPSED VIEW */}
        {isCollapsed ? (
          <div className="px-4 py-2.5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Tooltip content={isPlaying ? 'Pause Playback' : 'Play Hymn'} shortcut="Space" description="Toggle audio synthesis" side="top">
                <button
                  onClick={isPlaying ? onPause : onPlay}
                  className="w-8 h-8 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white flex items-center justify-center shadow-lg transition-all cursor-pointer"
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? <Pause size={14} /> : <Play size={14} fill="currentColor" />}
                </button>
              </Tooltip>

              <Tooltip content="Stop & Return" description="Stop playback and rewind to beginning" side="top">
                <button
                  onClick={onStop}
                  className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 text-stone-400 hover:text-white flex items-center justify-center transition-all cursor-pointer"
                  aria-label="Stop playback"
                >
                  <Square size={12} fill="currentColor" />
                </button>
              </Tooltip>

              <div className="text-xs font-mono font-bold text-stone-300 flex items-center gap-2">
                <span className="text-indigo-400">{currentTimeStr}</span>
                <span className="text-stone-600">/</span>
                <span className="text-stone-400">{totalTimeStr}</span>
              </div>
            </div>

            {/* Mini Progress Bar in Collapsed mode */}
            <Tooltip content="Scrub Timeline" description="Click anywhere to jump playback position" side="top">
              <div
                className="flex-1 max-w-md h-6 flex items-center cursor-pointer relative"
                onClick={(e) => {
                  if (totalTicks <= 0) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const fraction = Math.max(0, Math.min(e.clientX - rect.left, rect.width)) / rect.width;
                  onSeek(Math.round(fraction * totalTicks));
                }}
                onTouchStart={(e) => {
                  if (totalTicks <= 0 || !e.touches.length) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const fraction = Math.max(0, Math.min(e.touches[0].clientX - rect.left, rect.width)) / rect.width;
                  onSeek(Math.round(fraction * totalTicks));
                }}
              >
                <div className="w-full h-1.5 bg-black/60 rounded-full overflow-hidden relative">
                  <div
                    className="h-full bg-gradient-to-r from-indigo-500 to-indigo-400"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            </Tooltip>

            <div className="flex items-center gap-3">
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400 hidden sm:inline">
                Key <span className="text-indigo-400 font-bold">{score?.key || 'C'}</span> | {bpm} BPM
              </span>

              <Tooltip content="Expand Playback Dock" description="Show tempo, transposition, and voice mute controls" side="top">
                <button
                  onClick={() => setIsCollapsed(false)}
                  className="p-1.5 text-stone-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer flex items-center gap-1 text-[11px] font-sans font-bold uppercase tracking-wider"
                  aria-label="Expand Playback Dock"
                >
                  <span>Expand</span>
                  <ChevronUp size={14} />
                </button>
              </Tooltip>
            </div>
          </div>
        ) : (
          /* FULL EXPANDED DOCK */
          <div className="p-3 md:p-4 flex flex-col gap-3 max-h-[70vh] overflow-y-auto">
            {/* Top Row: Timeline Scrubber Bar with Measure markers and Hover Tooltip */}
            <div className="flex flex-col gap-1 select-none">
              <div
                ref={progressBarRef}
                onMouseDown={handleProgressBarMouseDown}
                onTouchStart={handleProgressBarTouchStart}
                onMouseMove={handleProgressBarHover}
                onMouseLeave={handleProgressBarLeave}
                className="relative w-full h-3 bg-black/60 hover:h-4.5 rounded-full cursor-pointer transition-all duration-150 group border border-white/5"
              >
                {/* Background Progress Track */}
                <div
                  className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-indigo-600 via-indigo-500 to-indigo-400 rounded-full shadow-[0_0_12px_rgba(99,102,241,0.5)]"
                  style={{ width: `${progressPercent}%` }}
                />

                {/* Scrubber Knob */}
                <div
                  className="absolute top-1/2 -translate-y-1/2 -ml-2 w-4 h-4 rounded-full bg-white shadow-md border-2 border-indigo-600 group-hover:scale-125 transition-transform"
                  style={{ left: `${progressPercent}%` }}
                />

                {/* Hover Position Preview Line & Tooltip */}
                {hoverPosition && (
                  <>
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-white/60 pointer-events-none"
                      style={{ left: `${hoverPosition.xPercent}%` }}
                    />
                    <div
                      className="absolute bottom-5 -translate-x-1/2 px-2 py-0.5 bg-stone-900 border border-white/20 rounded text-[10px] font-mono font-bold text-white shadow-xl pointer-events-none z-50 whitespace-nowrap"
                      style={{ left: `${hoverPosition.xPercent}%` }}
                    >
                      {formatTime(hoverPosition.tick)}
                    </div>
                  </>
                )}
              </div>

              {/* Timestamp & Measure Counters */}
              <div className="flex items-center justify-between text-[11px] font-mono font-bold text-stone-400 px-1 pt-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-white font-semibold">{currentTimeStr}</span>
                  <span className="text-stone-600">/</span>
                  <span className="text-stone-400">{totalTimeStr}</span>
                  <span className="text-stone-600">|</span>
                  <span className="text-indigo-400 text-[10px] uppercase font-sans font-extrabold tracking-wider bg-indigo-950/60 border border-indigo-800/40 px-2 py-0.5 rounded-md">
                    Meas {currentMeasureInfo.current} of {currentMeasureInfo.total}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  {/* Synth Status Pill */}
                  <div className="flex items-center gap-1.5 bg-black/40 border border-white/5 px-2.5 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider font-bold">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isPlaying
                          ? 'bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                          : 'bg-emerald-500/70'
                      }`}
                    />
                    <span className="text-stone-400">Synth:</span>
                    <span className={isPlaying ? 'text-emerald-400' : 'text-stone-300'}>
                      {isPlaying ? 'Active' : 'Ready'}
                    </span>
                  </div>

                  {/* Minimize Dock Button */}
                  <button
                    onClick={() => setIsCollapsed(true)}
                    className="text-stone-400 hover:text-white p-1 hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
                    title="Minimize Playback Dock"
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
              </div>
            </div>

            {/* Bottom Row: Controls Grid */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-white/5">
              {/* Primary Transport Buttons */}
              <div className="flex items-center gap-2">
                <Tooltip content={isPlaying ? 'Pause Playback' : 'Play Hymn'} shortcut="Space" description="Synthesizes all vocal parts" side="top">
                  {isPlaying ? (
                    <button
                      onClick={onPause}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl active:scale-95 transition-all shadow-[0_0_20px_rgba(79,70,229,0.4)] font-sans font-black text-xs uppercase tracking-wider flex items-center gap-2 cursor-pointer border border-indigo-400/40"
                    >
                      <Pause size={15} />
                      <span>Pause</span>
                    </button>
                  ) : (
                    <button
                      onClick={onPlay}
                      className="px-5 py-2 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white rounded-xl active:scale-95 transition-all shadow-[0_0_20px_rgba(79,70,229,0.45)] font-sans font-black text-xs uppercase tracking-wider flex items-center gap-2 cursor-pointer border border-indigo-400/50"
                    >
                      <Play size={15} fill="currentColor" />
                      <span>Play Score</span>
                    </button>
                  )}
                </Tooltip>

                <Tooltip content="Stop & Return" description="Rewind playback position to tick 0" side="top">
                  <button
                    onClick={onStop}
                    className="p-2 text-stone-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl active:scale-95 transition-all border border-white/10 cursor-pointer"
                    aria-label="Stop and return to beginning"
                  >
                    <Square size={14} fill="currentColor" />
                  </button>
                </Tooltip>

                <Tooltip content={isLooping ? 'Disable Loop' : 'Enable Loop'} description="Repeats score automatically upon completion" side="top">
                  <button
                    onClick={toggleLoop}
                    className={`p-2 rounded-xl active:scale-95 transition-all border cursor-pointer ${
                      isLooping
                        ? 'bg-purple-600/30 text-purple-300 border-purple-500/60 shadow-[0_0_12px_rgba(168,85,247,0.3)]'
                        : 'bg-white/5 text-stone-400 hover:text-white border-white/10 hover:bg-white/10'
                    }`}
                    aria-label="Toggle Loop Playback"
                  >
                    <Repeat size={14} />
                  </button>
                </Tooltip>
              </div>

              {/* Vocal Parts Fast-Mute/Solo Bar (visible on both mobile and desktop) */}
              {voiceList.length > 0 && (
                <div className="flex items-center gap-1 sm:gap-1.5 bg-black/40 border border-white/5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-xl shrink-0">
                  <span className="text-[10px] font-mono uppercase font-bold text-stone-500 mr-0.5 sm:mr-1">
                    Voices:
                  </span>
                  {voiceList.map((v) => {
                    const isMuted = !!mutedVoices[v.id];
                    return (
                      <Tooltip
                        key={`dock-v-${v.id}`}
                        content={`${v.name} Voice`}
                        description={isMuted ? 'Currently muted. Click to activate audio.' : 'Currently playing. Click to mute this part.'}
                        side="top"
                      >
                        <button
                          onClick={() => toggleMute(v.id)}
                          className={`w-6 h-6 rounded-lg text-xs font-sans font-black uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center border ${
                            isMuted
                              ? 'bg-stone-800/60 text-stone-500 border-white/5 line-through opacity-60'
                              : `${v.activeBg} shadow-sm`
                          }`}
                          aria-label={`${v.name} voice toggle`}
                        >
                          {v.label}
                        </button>
                      </Tooltip>
                    );
                  })}
                </div>
              )}

              {/* Secondary Controls: BPM, Transpose, Volume */}
              <div className="flex items-center gap-3 ml-auto">
                {/* Tempo (BPM) Stepper & Slider */}
                <Tooltip content="Playback Tempo" description="Adjust speed in beats per minute" side="top">
                  <div className="flex items-center gap-2 bg-black/40 border border-white/5 px-3 py-1.5 rounded-xl">
                    <SlidersHorizontal size={13} className="text-stone-500 flex-shrink-0" />
                    <span className="text-[10px] font-mono font-bold uppercase text-stone-400">
                      BPM:
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setBpm(Math.max(40, bpm - 4))}
                        className="w-5 h-5 bg-white/5 hover:bg-white/10 text-stone-300 rounded flex items-center justify-center text-xs font-bold transition-colors cursor-pointer"
                        aria-label="Decrease tempo"
                      >
                        -
                      </button>
                      <span className="text-xs font-mono font-bold text-indigo-400 w-8 text-center">
                        {bpm}
                      </span>
                      <button
                        onClick={() => setBpm(Math.min(220, bpm + 4))}
                        className="w-5 h-5 bg-white/5 hover:bg-white/10 text-stone-300 rounded flex items-center justify-center text-xs font-bold transition-colors cursor-pointer"
                        aria-label="Increase tempo"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </Tooltip>

                {/* Transposition Dropdown */}
                <Tooltip content="Transposition" description="Pitch shift all voices by semitones" side="top">
                  <div className="flex items-center gap-1.5 bg-black/40 border border-white/5 px-2.5 py-1.5 rounded-xl text-[10px] font-mono font-bold uppercase tracking-wider text-stone-400">
                    <span className="text-stone-500">Key:</span>
                    <select
                      value={transpose}
                      onChange={(e) => setTranspose(parseInt(e.target.value, 10))}
                      aria-label="Transpose score"
                      className="w-[118px] md:w-auto max-w-full bg-stone-900 border border-white/10 rounded-lg px-2 py-0.5 text-xs font-bold text-stone-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                    >
                      {Array.from({ length: 13 }).map((_, i) => {
                        const val = i - 6; // range -6 to +6
                        return (
                          <option key={`dock-transpose-${val}`} value={val}>
                            {getTranspositionLabel(val)}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </Tooltip>

                {/* Master Volume Slider Popover / Toggle */}
                <div className="relative">
                  <div className="flex items-center gap-2 bg-black/40 border border-white/5 px-2.5 py-1.5 rounded-xl">
                    <Tooltip content={masterVolume === 0 ? 'Unmute Master' : 'Mute Master'} side="top">
                      <button
                        onClick={() => setMasterVolume(masterVolume === 0 ? 0.8 : 0)}
                        className="text-stone-400 hover:text-white transition-colors cursor-pointer"
                        aria-label={masterVolume === 0 ? 'Unmute' : 'Mute'}
                      >
                        {masterVolume === 0 ? (
                          <VolumeX size={15} className="text-rose-400" />
                        ) : (
                          <Volume2 size={15} className="text-stone-300" />
                        )}
                      </button>
                    </Tooltip>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={masterVolume}
                      onChange={(e) => setMasterVolume(parseFloat(e.target.value))}
                      className="w-16 md:w-20 accent-indigo-500 h-1 bg-white/10 rounded cursor-pointer"
                      title={`Master Volume: ${Math.round(masterVolume * 100)}%`}
                    />
                    <span className="text-[10px] font-mono font-bold text-stone-400 w-7 text-right">
                      {Math.round(masterVolume * 100)}%
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
