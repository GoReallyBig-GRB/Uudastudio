import {lazy, Suspense} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

// Dev-only design-system preview: open the app with ?uigallery=1. Loaded lazily, so the normal app never fetches it.
const Gallery = lazy(() => import('./components/ui/Gallery'));
const showGallery = new URLSearchParams(window.location.search).has('uigallery');

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    {showGallery ? (
      <Suspense fallback={null}>
        <Gallery />
      </Suspense>
    ) : (
      <App />
    )}
  </ErrorBoundary>
);
