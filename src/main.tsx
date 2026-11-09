import {lazy, Suspense, useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import { isJoinHash } from './guest/job';
import { isTalentHash } from './jobs/links';
import './index.css';

// Dev-only design-system preview, loaded lazily so the normal app never fetches it. Open it with:
//   ?uigallery=1 (or #uigallery) on the app's own address: shows the gallery instead of the app, or
//   Alt+Shift+G inside the app: toggles the gallery as an overlay, so the open project stays loaded underneath.
const Gallery = lazy(() => import('./components/ui/Gallery'));
const galleryOnly =
  new URLSearchParams(window.location.search).has('uigallery') || window.location.hash === '#uigallery';

// A voice talent's recording link (#/join/...) opens only the small recording page: no editor code, no sign-in.
const GuestPage = lazy(() => import('./guest/GuestPage'));
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
