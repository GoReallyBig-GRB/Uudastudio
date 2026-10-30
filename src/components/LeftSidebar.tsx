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

// Rail buttons: neutral, with cyan only on the open tab.
const RAIL_LAYOUT = 'flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border transition-colors duration-150 ease-premium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60';
const RAIL_IDLE = 'border-transparent text-ink-faint hover:bg-white/5 hover:text-ink';
const RAIL_ON = 'border-accent/40 bg-accent-soft text-accent';

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
  onUpdateTrack: (trackId: string, updates: Partial<Track>) => void;
  onRemoveEmptyTracks: () => void;
  selectedClipIds?: Set<string>;
  // Groups list (under the tracks)
  groupsFooter?: React.ReactNode;
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
  groupsFooter,
  tracks,
  selectedTrackId,
  onSelectTrack,
  onDeleteTrack,
  onMoveTrack,
  onAddTrack,
  onUpdateTrack,
  onRemoveEmptyTracks,
  selectedClipIds,
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
    <div className="relative flex h-full border-r border-line bg-surface-1 select-none shrink-0 z-20">
      {/* Mini Icon Tab Switcher Strip (Sidebar Rail) */}
      <div className="w-11 sm:w-12 bg-surface-0 border-r border-line flex flex-col items-center py-3 gap-2 shrink-0 justify-between overflow-y-auto overflow-x-hidden">
        {/* Top Studio Workspaces */}
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => handleTabClick('tracks')}
            title="Track List & Session Hierarchy (T)"
            className={`${RAIL_LAYOUT} ${activeTab === 'tracks' && !isCollapsed ? RAIL_ON : RAIL_IDLE}`}
          >
            <Layers className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => handleTabClick('voice')}
            title="Voiceover Studio (Gemini TTS)"
            className={`${RAIL_LAYOUT} ${activeTab === 'voice' && !isCollapsed ? RAIL_ON : RAIL_IDLE}`}
          >
            <Mic className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => handleTabClick('library')}
            title="Sound Library (Freesound CC0)"
            className={`${RAIL_LAYOUT} ${activeTab === 'library' && !isCollapsed ? RAIL_ON : RAIL_IDLE}`}
          >
            <Music className="w-4 h-4" />
          </button>

          {/* Modular Audio Plugins Rack button */}
          {onOpenPlugins && (
            <button
              type="button"
              onClick={onOpenPlugins}
              title="Open Modular Audio Plugins Rack (WAM 2.0 & Native)"
              className={`${RAIL_LAYOUT} ${RAIL_IDLE}`}
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
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-transparent text-ink-faint transition-colors hover:bg-white/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
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
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-gold/30 bg-gold-soft text-gold transition-[filter] hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
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
              className="relative w-9 h-9 rounded-full p-0.5 border border-line-strong hover:border-accent transition-colors cursor-pointer group"
            >
              {user.photo_url ? (
                <img
                  src={user.photo_url}
                  alt={user.display_name}
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                <div className="w-full h-full rounded-full bg-surface-3 flex items-center justify-center text-[11px] font-bold text-ink uppercase">
                  {user.display_name.slice(0, 2)}
                </div>
              )}

              {/* Small badge showing unread admin reply on support ticket */}
              {unreadTicketsCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-accent border-2 border-surface-0 rounded-full animate-pulse" />
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenSignIn}
              title="Sign in with Google"
              className={`${RAIL_LAYOUT} border-line bg-surface-1 text-ink-dim hover:bg-surface-3 hover:text-ink`}
            >
              <LogIn className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Main Panel Content Area (collapsed when isCollapsed is true) */}
      {!isCollapsed && (
        <div className={`${activeTab === 'voice' ? 'w-96' : 'w-80'} max-w-[calc(100vw-3rem)] h-full flex flex-col min-w-0 bg-surface-1 animate-in fade-in duration-150 max-md:absolute max-md:left-full max-md:top-0 max-md:border-r max-md:border-zinc-700 max-md:shadow-[8px_0_24px_rgba(0,0,0,0.6)]`}>
          {activeTab === 'tracks' && (
            <TrackListPanel
              tracks={tracks}
              selectedTrackId={selectedTrackId}
              onSelectTrack={onSelectTrack}
              onDeleteTrack={onDeleteTrack}
              onMoveTrack={onMoveTrack}
              onAddTrack={onAddTrack}
              onUpdateTrack={onUpdateTrack}
              onRemoveEmptyTracks={onRemoveEmptyTracks}
              selectedClipIds={selectedClipIds}
              footer={groupsFooter}
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
