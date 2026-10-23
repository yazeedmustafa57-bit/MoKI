import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toast.jsx';

const AppContext = createContext(null);

function resolveTheme(theme) {
  if (theme === 'light' || theme === 'dark') return theme;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function AppProvider({ initialUser, onLoggedOut, children }) {
  const [user, setUser] = useState(initialUser);
  const [settings, setSettings] = useState(null);
  const { toast } = useToast();

  useEffect(() => {
    let active = true;
    api('/account/settings')
      .then((data) => {
        if (active) setSettings(data.settings);
      })
      .catch(() => {
        if (active) {
          setSettings({
            assistantName: 'Victor',
            theme: 'system',
            emailNotifications: true,
            pushNotifications: false,
            callRecording: false,
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const theme = settings?.theme || 'system';

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      root.dataset.theme = resolveTheme(theme);
      root.style.colorScheme = resolveTheme(theme);
    };
    apply();
    if (theme !== 'system') return undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST', skipUnauthorized: true });
    } catch {
      // The local session is cleared regardless of network state.
    }
    onLoggedOut();
  }, [onLoggedOut]);

  const updateUser = useCallback((nextUser) => {
    setUser((current) => ({ ...current, ...nextUser }));
  }, []);

  const applySettings = useCallback((nextSettings) => {
    setSettings(nextSettings);
  }, []);

  const refreshSettings = useCallback(async () => {
    try {
      const data = await api('/account/settings');
      setSettings(data.settings);
      return data.settings;
    } catch (error) {
      toast(error.message, 'error');
      return null;
    }
  }, [toast]);

  const value = useMemo(
    () => ({
      user,
      settings,
      updateUser,
      applySettings,
      refreshSettings,
      logout,
    }),
    [user, settings, updateUser, applySettings, refreshSettings, logout],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}
