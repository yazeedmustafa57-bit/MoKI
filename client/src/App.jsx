import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { api } from './api.js';
import { AppProvider } from './context/AppContext.jsx';
import AppShell from './components/AppShell.jsx';
import AuthPage from './pages/AuthPage.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Talk from './pages/Talk.jsx';
import Calls from './pages/Calls.jsx';
import Transcripts from './pages/Transcripts.jsx';
import Tasks from './pages/Tasks.jsx';
import Contacts from './pages/Contacts.jsx';
import CalendarPage from './pages/CalendarPage.jsx';
import Profile from './pages/Profile.jsx';
import Integrations from './pages/Integrations.jsx';
import Settings from './pages/Settings.jsx';

export default function App() {
  const [auth, setAuth] = useState({
    loading: true,
    authenticated: false,
    user: null,
    error: null,
  });

  const loadAuth = useCallback(async () => {
    setAuth((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await api('/auth/status', { skipUnauthorized: true });
      setAuth({
        loading: false,
        authenticated: data.authenticated,
        user: data.user,
        error: null,
      });
    } catch (error) {
      setAuth((current) => ({ ...current, loading: false, error }));
    }
  }, []);

  useEffect(() => {
    loadAuth();
  }, [loadAuth]);

  useEffect(() => {
    const handleUnauthorized = () => {
      setAuth((current) => ({
        ...current,
        authenticated: false,
        user: null,
      }));
    };
    window.addEventListener('victor:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('victor:unauthorized', handleUnauthorized);
  }, []);

  const handleAuthenticated = (user) => {
    setAuth({
      loading: false,
      authenticated: true,
      user,
      error: null,
    });
  };

  const handleLoggedOut = () => {
    setAuth((current) => ({
      ...current,
      authenticated: false,
      user: null,
    }));
  };

  if (auth.loading) {
    return (
      <div className="boot-screen" role="status" aria-live="polite">
        <span className="brand-mark brand-mark-large">V</span>
        <span className="boot-title">Victor AI Assistant</span>
        <span className="boot-sub">
          <LoaderCircle size={16} className="spin" aria-hidden="true" /> Verbindung wird geprüft …
        </span>
      </div>
    );
  }

  if (auth.error) {
    return (
      <div className="boot-screen" role="alert">
        <span className="brand-mark brand-mark-large">V</span>
        <span className="boot-title">Server nicht erreichbar</span>
        <span className="boot-sub">{auth.error.message}</span>
        <button type="button" className="btn btn-primary" onClick={loadAuth}>
          <RefreshCw size={16} /> Erneut versuchen
        </button>
      </div>
    );
  }

  if (!auth.authenticated) {
    return <AuthPage onAuthenticated={handleAuthenticated} />;
  }

  return (
    <AppProvider initialUser={auth.user} onLoggedOut={handleLoggedOut}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="talk" element={<Talk />} />
          <Route path="calls" element={<Calls />} />
          <Route path="transcripts" element={<Transcripts />} />
          <Route path="tasks" element={<Tasks />} />
          <Route path="contacts" element={<Contacts />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="profile" element={<Profile />} />
          <Route path="integrations" element={<Integrations />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AppProvider>
  );
}
