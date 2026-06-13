import { useEffect, useRef, useState } from 'react';
import LoadingScreen from './LoadingScreen';
import {
  subscribe as subscribeUpdater,
  subscribeAddon,
  checkForUpdates,
  checkAddonUpdate,
  type UpdateState,
  type AddonUpdateState,
} from './updater';

const MANIFEST_URL = 'https://gnosis-xi.com/updates/desktop.json';
const MIN_VISIBLE_MS = 3200;
const SAFETY_TIMEOUT_MS = 12000;
const SUCCESS_LINGER_MS = 1400;

export default function StartupUpdateCheck({ dataDir, onDone }: { dataDir: string; onDone: () => void }) {
  const [caption, setCaption] = useState('Checking for updates');
  const [exiting, setExiting] = useState(false);
  const desktopDoneRef = useRef(false);
  const addonDoneRef = useRef(false);
  const finishedRef = useRef(false);
  const startedAtRef = useRef(Date.now());
  const desktopAvailableRef = useRef(false);
  const addonAvailableRef = useRef(false);

  useEffect(() => {
    const finish = (caused: 'complete' | 'timeout') => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      if (caused === 'complete' && !desktopAvailableRef.current && !addonAvailableRef.current) {
        setCaption('Up to date! Loading Gnosis');
      } else if (caused === 'complete') {
        setCaption('Update available! Loading Gnosis');
      }
      const elapsed = Date.now() - startedAtRef.current;
      const wait = Math.max(MIN_VISIBLE_MS - elapsed, 0) + SUCCESS_LINGER_MS;
      window.setTimeout(() => {
        setExiting(true);
        window.setTimeout(onDone, 400);
      }, wait);
    };

    const tryFinish = () => {
      if (desktopDoneRef.current && addonDoneRef.current) finish('complete');
    };

    const unsubDesktop = subscribeUpdater((s: UpdateState) => {
      if (s.kind === 'checking' || s.kind === 'idle') return;
      if (desktopDoneRef.current) return;
      desktopDoneRef.current = true;
      if (s.kind === 'available') desktopAvailableRef.current = true;
      tryFinish();
    });
    const unsubAddon = subscribeAddon((s: AddonUpdateState) => {
      if (s.kind === 'checking' || s.kind === 'idle') return;
      if (addonDoneRef.current) return;
      addonDoneRef.current = true;
      if (s.kind === 'available') addonAvailableRef.current = true;
      tryFinish();
    });

    void checkForUpdates({ respectSkip: true });
    void checkAddonUpdate({ dataDir, manifestUrl: MANIFEST_URL, respectSkip: true });

    const safety = window.setTimeout(() => finish('timeout'), SAFETY_TIMEOUT_MS);
    return () => { unsubDesktop(); unsubAddon(); window.clearTimeout(safety); };
  }, [dataDir, onDone]);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <div className="styx-bg" />
      <LoadingScreen exiting={exiting} caption={caption} hideQuote={false} />
    </div>
  );
}
