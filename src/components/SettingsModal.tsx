/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import { AppSettings, DEFAULT_APP_SETTINGS } from '../utils/settings';
import {
  X,
  Sliders,
  Eye,
  RotateCcw,
  Sparkles,
  Volume2,
  Layers,
  BookOpen,
  Layout,
  Code,
  Music,
  Maximize2,
  AlertTriangle,
} from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onUpdateSettings: (newSettings: AppSettings) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
}) => {
  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleToggle = (key: keyof AppSettings) => {
    onUpdateSettings({
      ...settings,
      [key]: !settings[key],
    });
  };

  const handleReset = () => {
    onUpdateSettings({ ...DEFAULT_APP_SETTINGS });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      {/* Click outside to close */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Modal Dialog Card */}
      <div
        role="dialog"
        aria-labelledby="settings-title"
        aria-modal="true"
        className="relative w-full max-w-xl bg-[#12141C] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh] text-stone-200 select-none z-10"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#161822] border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-600/20 text-indigo-400 rounded-xl border border-indigo-500/30">
              <Sliders size={18} />
            </div>
            <div>
              <h2 id="settings-title" className="font-sans font-black text-sm uppercase tracking-wider text-white">
                Workspace & View Settings
              </h2>
              <p className="text-[11px] text-stone-400">
                Customize visibility, layout, and editing behavior
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/10 text-stone-400 hover:text-white rounded-lg transition-colors cursor-pointer"
            title="Close Settings (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Section 1: Views Visibility */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Eye size={14} className="text-indigo-400" />
              <h3 className="font-sans font-black text-xs uppercase tracking-wider text-stone-300">
                UI Views & Panels
              </h3>
            </div>

            <div className="divide-y divide-white/5 bg-black/30 rounded-xl border border-white/5 overflow-hidden">
              {/* Live Preview of Source Editor (Off by default) */}
              <div className="flex items-center justify-between p-3.5 hover:bg-white/[0.02] transition-colors">
                <div className="pr-4">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-xs text-white">Source Editor Live Preview</span>
                    <span className="text-[9px] font-bold px-1.5 py-0.2 bg-white/10 text-stone-300 rounded">
                      Default: Off
                    </span>
                  </div>
                  <p className="text-[11px] text-stone-400 mt-0.5">
                    Renders an interactive split-pane score preview alongside the ABC and Tonic Sol-fa code editors.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.showLivePreview}
                  onClick={() => handleToggle('showLivePreview')}
                  className={`w-11 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors shrink-0 ${
                    settings.showLivePreview ? 'bg-indigo-600' : 'bg-stone-700'
                  }`}
                >
                  <div
                    className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                      settings.showLivePreview ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Piano Roll View */}
              <div className="flex items-center justify-between p-3.5 hover:bg-white/[0.02] transition-colors">
                <div className="pr-4">
                  <span className="font-semibold text-xs text-white">Interactive Piano Roll</span>
                  <p className="text-[11px] text-stone-400 mt-0.5">
                    Show the chromatic piano roll view with channel coloring and monophonic editing.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.showPianoRoll}
                  onClick={() => handleToggle('showPianoRoll')}
                  className={`w-11 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors shrink-0 ${
                    settings.showPianoRoll ? 'bg-indigo-600' : 'bg-stone-700'
                  }`}
                >
                  <div
                    className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                      settings.showPianoRoll ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Score Library Sidebar */}
              <div className="flex items-center justify-between p-3.5 hover:bg-white/[0.02] transition-colors">
                <div className="pr-4">
                  <span className="font-semibold text-xs text-white">Hymn & Score Library Panel</span>
                  <p className="text-[11px] text-stone-400 mt-0.5">
                    Displays the library drawer on the left. Toggle off to give the score 100% of the screen width.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.showSidebar}
                  onClick={() => handleToggle('showSidebar')}
                  className={`w-11 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors shrink-0 ${
                    settings.showSidebar ? 'bg-indigo-600' : 'bg-stone-700'
                  }`}
                >
                  <div
                    className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                      settings.showSidebar ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Floating Playback Dock */}
              <div className="flex items-center justify-between p-3.5 hover:bg-white/[0.02] transition-colors">
                <div className="pr-4">
                  <span className="font-semibold text-xs text-white">Floating Playback Dock</span>
                  <p className="text-[11px] text-stone-400 mt-0.5">
                    Shows the bottom audio playback dock with play, tempo, voices mixer, and loop controls.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.showPlaybackDock}
                  onClick={() => handleToggle('showPlaybackDock')}
                  className={`w-11 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors shrink-0 ${
                    settings.showPlaybackDock ? 'bg-indigo-600' : 'bg-stone-700'
                  }`}
                >
                  <div
                    className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                      settings.showPlaybackDock ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Tonic Sol-fa Reference Legend */}
              <div className="flex items-center justify-between p-3.5 hover:bg-white/[0.02] transition-colors">
                <div className="pr-4">
                  <span className="font-semibold text-xs text-white">Tonic Sol-fa Reference Legend</span>
                  <p className="text-[11px] text-stone-400 mt-0.5">
                    Displays the Movable-Do symbol table (d, r, m, f, s, l, t, octave dots) at the bottom of the sheet.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.showReferenceLegend}
                  onClick={() => handleToggle('showReferenceLegend')}
                  className={`w-11 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors shrink-0 ${
                    settings.showReferenceLegend ? 'bg-indigo-600' : 'bg-stone-700'
                  }`}
                >
                  <div
                    className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                      settings.showReferenceLegend ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Zen / Focus Mode */}
              <div className="flex items-center justify-between p-3.5 hover:bg-white/[0.02] transition-colors bg-indigo-950/20">
                <div className="pr-4">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-xs text-indigo-200">Zen / Distraction-Free Mode</span>
                    <span className="text-[9px] font-bold px-1.5 py-0.2 bg-indigo-600 text-white rounded uppercase tracking-wider">
                      Focus
                    </span>
                  </div>
                  <p className="text-[11px] text-indigo-200/70 mt-0.5">
                    Hides sidebars, floating docks, and extra header chrome to give maximum focus to the score sheet.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.zenMode}
                  onClick={() => handleToggle('zenMode')}
                  className={`w-11 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors shrink-0 ${
                    settings.zenMode ? 'bg-indigo-600' : 'bg-stone-700'
                  }`}
                >
                  <div
                    className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                      settings.zenMode ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* Section 2: Editor & Studio Behavior */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Sparkles size={14} className="text-indigo-400" />
              <h3 className="font-sans font-black text-xs uppercase tracking-wider text-stone-300">
                Studio Behavior & Editing
              </h3>
            </div>

            <div className="divide-y divide-white/5 bg-black/30 rounded-xl border border-white/5 overflow-hidden">
              {/* Auto-format on Blur */}
              <div className="flex items-center justify-between p-3.5 hover:bg-white/[0.02] transition-colors">
                <div className="pr-4">
                  <span className="font-semibold text-xs text-white">Auto-Format on Blur</span>
                  <p className="text-[11px] text-stone-400 mt-0.5">
                    Automatically align barlines, grid beats, and quantize note timings whenever you finish editing.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.autoFormatOnBlur}
                  onClick={() => handleToggle('autoFormatOnBlur')}
                  className={`w-11 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors shrink-0 ${
                    settings.autoFormatOnBlur ? 'bg-indigo-600' : 'bg-stone-700'
                  }`}
                >
                  <div
                    className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                      settings.autoFormatOnBlur ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Sound preview on click */}
              <div className="flex items-center justify-between p-3.5 hover:bg-white/[0.02] transition-colors">
                <div className="pr-4">
                  <span className="font-semibold text-xs text-white">Tactile Audio Previews</span>
                  <p className="text-[11px] text-stone-400 mt-0.5">
                    Sound vocal organ pitch preview when clicking piano keys or moving notes in the editor.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.soundPreviewOnClick}
                  onClick={() => handleToggle('soundPreviewOnClick')}
                  className={`w-11 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors shrink-0 ${
                    settings.soundPreviewOnClick ? 'bg-indigo-600' : 'bg-stone-700'
                  }`}
                >
                  <div
                    className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                      settings.soundPreviewOnClick ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Compilation Warnings */}
              <div className="flex items-center justify-between p-3.5 hover:bg-white/[0.02] transition-colors">
                <div className="pr-4">
                  <span className="font-semibold text-xs text-white">Compilation Warnings Banner</span>
                  <p className="text-[11px] text-stone-400 mt-0.5">
                    Show the diagnostic warning drawer when score notation has invalid measures or syntax notes.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.showCompilationWarnings}
                  onClick={() => handleToggle('showCompilationWarnings')}
                  className={`w-11 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors shrink-0 ${
                    settings.showCompilationWarnings ? 'bg-indigo-600' : 'bg-stone-700'
                  }`}
                >
                  <div
                    className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                      settings.showCompilationWarnings ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#161822] border-t border-white/10">
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] text-stone-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
            title="Restore factory default settings"
          >
            <RotateCcw size={12} />
            <span>Reset to Defaults</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold shadow-md cursor-pointer transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
