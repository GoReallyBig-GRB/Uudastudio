import {lazy, Suspense, useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import { isJoinHash } from './guest/job';
import { isLiveHash } from './live/events';
import { isClientHash, isTalentHash } from './jobs/links';
import { FREESOUND_STATE_KEY, readFreesoundReturn } from './freesound/oauthReturn';
import './index.css';

// Dev-only design-system preview, loaded lazily so the normal app never fetches it. Open it with:
//   ?uigallery=1 (or #uigallery) on the app's own address: shows the gallery instead of the app, or
//   Alt+Shift+G inside the app: toggles the gallery as an overlay, so the open project stays loaded underneath.
const Gallery = lazy(() => import('./components/ui/Gallery'));
const galleryOnly =
  new URLSearchParams(window.location.search).has('uigallery') || window.location.hash === '#uigallery';

// A voice talent's recording link (#/join/...) opens only the small recording page: no editor code, no sign-in.
const GuestPage = lazy(() => import('./guest/GuestPage'));
const ClientPage = lazy(() => import('./jobs/ClientPage'));
const LiveJoinPage = lazy(() => import('./live/LiveJoinPage'));
const SelfTest = lazy(() => import('./jobs/SelfTest'));
// Freesound sends the person back to the app's own address with ?code=...&state=...: that tab only finishes the connection
const FreesoundReturn = lazy(() => import('./freesound/FreesoundReturn'));
const freesoundReturn = (() => {
  let expected: string | null = null;
  try { expected = localStorage.getItem(FREESOUND_STATE_KEY); } catch { /* storage unavailable */ }
  return readFreesoundReturn(window.location.search, expected).kind !== 'none';
})();
const selfTestOnly = window.location.hash === '#/selftest';
const clientOnly = isClientHash(window.location.hash);
const liveOnly = isLiveHash(window.location.hash);
const guestOnly = isJoinHash(window.location.hash) || isTalentHash(window.location.hash);

const Root = () => {
  const [overlayOpen, setOverlayOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && e.code === 'KeyG') {
        e.preventDefault();
        setOverlayOpen((open) => !open);
      } else if (e.key === 'Escape') {
        setOverlayOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (freesoundReturn) return <Suspense fallback={null}><FreesoundReturn /></Suspense>;

  if (selfTestOnly) {
    return (
      <Suspense fallback={null}>
        <SelfTest />
      </Suspense>
    );
  }

  if (liveOnly) {
    return (
      <Suspense fallback={null}>
        <LiveJoinPage />
      </Suspense>
    );
  }

  if (clientOnly) {
    return (
      <Suspense fallback={null}>
        <ClientPage />
      </Suspense>
    );
  }

  if (guestOnly) {
    return (
      <Suspense fallback={null}>
        <GuestPage />
      </Suspense>
    );
  }

  if (galleryOnly) {
    return (
      <Suspense fallback={null}>
        <Gallery />
      </Suspense>
    );
  }

  return (
    <>
      <App />
      {overlayOpen && (
        <div className="fixed inset-0 z-[200]">
          <Suspense fallback={null}>
            <Gallery />
          </Suspense>
        </div>
      )}
    </>
  );
};

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <Root />
  </ErrorBoundary>
);
