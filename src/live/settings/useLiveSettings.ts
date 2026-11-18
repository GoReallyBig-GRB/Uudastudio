import { useSyncExternalStore } from 'react';
import { liveSettings, type LiveSettings } from './liveSettings';

/** The live settings, kept up to date on screen whenever they change anywhere */
export const useLiveSettings = (): LiveSettings => useSyncExternalStore(liveSettings.subscribe, liveSettings.get, liveSettings.get);
