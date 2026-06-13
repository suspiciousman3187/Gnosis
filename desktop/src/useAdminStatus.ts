import { useEffect, useState } from 'react';
import { SHARE_API_BASE_URL } from '@/lib/shareConfig';

const SHARE_TOKEN_KEY = 'gnosis_share_token';
const TOKEN_CHANGE_EVENT = 'gnosis-token-changed';

function loadToken(): string | null {
  try { return localStorage.getItem(SHARE_TOKEN_KEY) || null; } catch { return null; }
}

export function emitTokenChanged() {
  try { window.dispatchEvent(new Event(TOKEN_CHANGE_EVENT)); } catch { /* ignore */ }
}

export function useAdminStatus(): { isAdmin: boolean; signedIn: boolean; loading: boolean } {
  const [state, setState] = useState<{ isAdmin: boolean; signedIn: boolean; loading: boolean }>(
    { isAdmin: false, signedIn: !!loadToken(), loading: !!loadToken() },
  );

  useEffect(() => {
    let alive = true;
    const refetch = async () => {
      const token = loadToken();
      if (!token) {
        if (alive) setState({ isAdmin: false, signedIn: false, loading: false });
        return;
      }
      if (alive) setState(s => ({ ...s, signedIn: true, loading: true }));
      try {
        const res = await fetch(`${SHARE_API_BASE_URL}/api/account/whoami`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          if (alive) setState({ isAdmin: false, signedIn: true, loading: false });
          return;
        }
        const j = await res.json() as { isAdmin?: boolean };
        if (alive) setState({ isAdmin: j.isAdmin === true, signedIn: true, loading: false });
      } catch {
        if (alive) setState({ isAdmin: false, signedIn: true, loading: false });
      }
    };
    refetch();
    const onChange = () => { refetch(); };
    window.addEventListener(TOKEN_CHANGE_EVENT, onChange);
    return () => { alive = false; window.removeEventListener(TOKEN_CHANGE_EVENT, onChange); };
  }, []);

  return state;
}
