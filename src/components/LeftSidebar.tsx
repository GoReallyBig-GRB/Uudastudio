/**
 * Uuda Pro - Left Dockable Sidebar
 * Tabbed navigation hosting Tracks, Voiceover Studio, and Freesound CC0 Library.
 * Supports individual collapse/expand to give maximum space to the timeline mixing panel.
 */

import React from 'react';
import { Layers, Mic, Music, ChevronLeft, ChevronRight, ShieldCheck, LogIn, Sparkles } from 'lucide-react';
import { TrackListPanel } from './TrackListPanel';
import { VoicePanel } from './VoicePanel';
import { SoundLibraryPanel } from './SoundLibraryPanel';
import { Track, Asset, VoiceMetadata, UserRecord } from '../types';

export type SidebarTab = 'tracks' | 'voice' | 'library';

interface LeftSidebarProps {
  activeTab: SidebarTab;
  onSelectTab: (tab: SidebarTab) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  // Auth & Profile props
  user: UserRecord | null;
  unreadTicketsCount?: number;
  onOpenDashboard: () => void;
  onOpenAdmin: () => void;
  onOpenSignIn: () => void;
  // Plugins & Expanded Modals
  onOpenPlugins?: () => void;
  onOpenVoiceoverModal?: () => void;
  onOpenLibraryModal?: () => void;
  // TrackListPanel props
  tracks: Track[];
  selectedTrackId: string | null;
  onSelectTrack: (trackId: string) => void;
  onDeleteTrack: (trackId: string) => void;
  onMoveTrack: (trackId: string, direction: 'up' | 'down') => void;
  onAddTrack: () => void;
  // VoicePanel props
  onAddVoiceTrack: (asset: Asset, metadata: VoiceMetadata) => void;
  existingVoiceMetadata?: VoiceMetadata | null;
  // SoundLibraryPanel props
  onAddLibraryTrack: (asset: Asset) => void;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  activeTab,
  onSelectTab,
  isCollapsed,
  onToggleCollapse,
  user,
  unreadTicketsCount = 0,
  onOpenDashboard,
  onOpenAdmin,
  onOpenSignIn,
  onOpenPlugins,
  onOpenVoiceoverModal,
  onOpenLibraryModal,
  tracks,
  selectedTrackId,
  onSelectTrack,
  onDeleteTrack,
  onMoveTrack,
  onAddTrack,
  onAddVoiceTrack,
  existingVoiceMetadata,
  onAddLibraryTrack,
}) => {
  const handleTabClick = (tab: SidebarTab) => {
    window.dispatchEvent(new CustomEvent('xpro:close-popups'));
    onSelectTab(tab);
    if (isCollapsed) {
      onToggleCollapse(); // Auto-expand when clicking a tab
    }
  };

  const isAdmin = user?.role === 'admin';

  return (
    <div className="flex h-full border-r border-zinc-700/80 bg-[#121216] select-none shrink-0 z-10">
      {/* Mini Icon Tab Switcher Strip (Sidebar Rail) */}
      <div className="w-12 bg-[#0c0c10] border-r border-zinc-800 flex flex-col items-center py-3 gap-2 shrink-0 justify-between">
        {/* Top Studio Workspaces */}
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => handleTabClick('tracks')}
            title="Track List & Session Hierarchy (T)"
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
              activeTab === 'tracks' && !isCollapsed
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-[0_0_12px_rgba(0,240,255,0.25)]'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60'
            }`}
          >
            <Layers className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => handleTabClick('voice')}
            title="Voiceover Studio (Gemini TTS)"
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all cursor-pointer relative ${
              activeTab === 'voice' && !isCollapsed
                ? 'bg-gradient-to-br from-cyan-500 to-indigo-600 text-white shadow-[0_0_14px_rgba(0,240,255,0.35)]'
                : 'text-zinc-500 hover:text-cyan-300 hover:bg-zinc-800/60'
            }`}
          >
            <Mic className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => handleTabClick('library')}
            title="Sound Library (Freesound CC0)"
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
              activeTab === 'library' && !isCollapsed
                ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/60 shadow-[0_0_14px_rgba(16,185,129,0.3)]'
                : 'text-zinc-500 hover:text-emerald-400 hover:bg-zinc-800/60'
            }`}
          >
            <Music className="w-4 h-4" />
          </button>

          {/* Modular Audio Plugins Rack button */}
          {onOpenPlugins && (
            <button
              type="button"
              onClick={onOpenPlugins}
              title="Open Modular Audio Plugins Rack (WAM 2.0 & Native)"
              className="w-9 h-9 rounded-lg flex items-center justify-center transition-all cursor-pointer text-purple-400 hover:text-purple-200 hover:bg-purple-950/60 border border-purple-500/40 hover:border-purple-400 shadow-[0_0_8px_rgba(168,85,247,0.2)]"
            >
              <Sparkles className="w-4 h-4" />
            </button>
          )}

          {/* Sidebar Collapse Toggle */}
          <div className="pt-2">
            <button
              type="button"
              onClick={onToggleCollapse}
              title={isCollapsed ? 'Expand Left Sidebar' : 'Collapse Left Sidebar to expand mixing panel'}
              className="w-8 h-8 rounded-md flex items-center justify-center text-zinc-500 hover:text-cyan-300 hover:bg-zinc-800 transition-colors cursor-pointer border border-transparent hover:border-zinc-700"
            >
              {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Bottom Rail Section: Admin Panel (if admin) & Profile / Sign-in */}
        <div className="flex flex-col items-center gap-2.5">
          {/* Admin Panel Icon (Exclusively visible to confirmed Admins) */}
          {isAdmin && (
            <button
              type="button"
              onClick={onOpenAdmin}
              title="Admin Panel (Authorized Admins Only)"
              className="w-9 h-9 rounded-lg flex items-center justify-center bg-amber-500/10 hover:bg-amber-500/25 text-amber-400 border border-amber-500/40 hover:border-amber-400 transition-all cursor-pointer shadow-[0_0_10px_rgba(245,158,11,0.2)]"
            >
              <ShieldCheck className="w-4 h-4" />
            </button>
          )}

          {/* Signed-in User Profile Icon or Signed-Out 'Sign in' Button */}
          {user ? (
            <button
              type="button"
              onClick={onOpenDashboard}
              title={`User Dashboard (${user.display_name})`}
              className="relative w-9 h-9 rounded-full p-0.5 border border-zinc-700 hover:border-cyan-400 transition-all cursor-pointer group hover:scale-105"
            >
              {user.photo_url ? (
                <img
                  src={user.photo_url}
                  alt={user.display_name}
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                <div className="w-full h-full rounded-full bg-gradient-to-br from-cyan-600 to-indigo-700 flex items-center justify-center text-[11px] font-bold text-white uppercase">
                  {user.display_name.slice(0, 2)}
                </div>
              )}

              {/* Small badge showing unread admin reply on support ticket */}
              {unreadTicketsCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-cyan-400 border-2 border-[#0c0c10] rounded-full shadow-[0_0_8px_rgba(0,240,255,0.9)] animate-pulse" />
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenSignIn}
              title="Sign in with Google"
              className="w-9 h-9 rounded-lg flex items-center justify-center bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-cyan-300 border border-zinc-800 hover:border-zinc-700 transition-all cursor-pointer"
            >
              <LogIn className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Main Panel Content Area (collapsed when isCollapsed is true) */}
      {!isCollapsed && (
        <div className={`${activeTab === 'voice' ? 'w-96' : 'w-80'} h-full flex flex-col min-w-0 bg-[#121216] animate-in fade-in duration-150`}>
          {activeTab === 'tracks' && (
            <TrackListPanel
              tracks={tracks}
              selectedTrackId={selectedTrackId}
              onSelectTrack={onSelectTrack}
              onDeleteTrack={onDeleteTrack}
              onMoveTrack={onMoveTrack}
              onAddTrack={onAddTrack}
            />
          )}

          {activeTab === 'voice' && (
            <VoicePanel
              onAddVoiceTrack={onAddVoiceTrack}
              existingMetadata={existingVoiceMetadata}
              onClose={onToggleCollapse}
            />
          )}

          {activeTab === 'library' && (
            <SoundLibraryPanel
              onAddLibraryTrack={onAddLibraryTrack}
              onClose={onToggleCollapse}
              onOpenLibraryModal={onOpenLibraryModal}
            />
          )}
        </div>
      )}
    </div>
  );
};
