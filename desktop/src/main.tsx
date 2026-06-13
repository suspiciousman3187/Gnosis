import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App';
import OverlayApp from './OverlayApp';

const isOverlay = window.location.hash === '#overlay';
if (isOverlay) {
  document.documentElement.style.background = 'transparent';
  document.body.style.background = 'transparent';
}


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isOverlay ? <OverlayApp /> : <App />}
  </StrictMode>,
);

if (!isOverlay) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const splash = document.getElementById('boot-splash');
    if (!splash) return;
    splash.classList.add('is-exiting');
    splash.addEventListener('transitionend', () => splash.remove(), { once: true });
    // Belt-and-suspenders: hard removal if transitionend never fires (e.g.
    // prefers-reduced-motion kills the transition).
    window.setTimeout(() => splash.remove(), 700);
  }));
}
