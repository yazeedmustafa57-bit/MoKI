import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { LogOut, Menu, PanelLeftClose, X } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { useMediaQuery } from '../hooks/useApi.js';
import { NAV_ITEMS, findNavItem } from '../nav.js';
import { Avatar } from './ui.jsx';

export default function AppShell() {
  const { user, settings, logout } = useApp();
  const location = useLocation();
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const menuButtonRef = useRef(null);
  const closeButtonRef = useRef(null);
  const current = findNavItem(location.pathname);

  useEffect(() => {
    setSidebarOpen(isDesktop);
  }, [isDesktop]);

  useEffect(() => {
    if (!isDesktop) setSidebarOpen(false);
  }, [location.pathname, isDesktop]);

  useEffect(() => {
    if (sidebarOpen && !isDesktop) {
      const timer = setTimeout(() => closeButtonRef.current?.focus(), 80);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [sidebarOpen, isDesktop]);

  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const handleKey = (event) => {
      if (event.key === 'Escape') {
        setSidebarOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [sidebarOpen]);

  const closeOnMobile = () => {
    if (!isDesktop) setSidebarOpen(false);
  };

  const today = new Intl.DateTimeFormat('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  }).format(new Date());

  return (
    <div className={`shell ${sidebarOpen ? 'is-open' : 'is-collapsed'}`}>
      <button
        type="button"
        className={`scrim ${sidebarOpen && !isDesktop ? 'visible' : ''}`}
        aria-label="Menü schließen"
        tabIndex={sidebarOpen && !isDesktop ? 0 : -1}
        onClick={() => {
          setSidebarOpen(false);
          menuButtonRef.current?.focus();
        }}
      />

      <aside
        id="main-navigation"
        className={`sidebar ${sidebarOpen ? 'open' : ''}`}
        aria-label="Hauptnavigation"
      >
        <div className="sidebar-head">
          <NavLink to="/" className="brand-lockup" onClick={closeOnMobile}>
            <span className="brand-mark">V</span>
            <span>
              <strong>Victor</strong>
              <small>AI Assistant</small>
            </span>
          </NavLink>
          <button
            ref={closeButtonRef}
            type="button"
            className="icon-btn sidebar-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Menü schließen"
          >
            {isDesktop ? <PanelLeftClose size={19} /> : <X size={19} />}
          </button>
        </div>

        <nav className="sidebar-nav">
          <span className="nav-label">Arbeitsbereich</span>
          {NAV_ITEMS.slice(0, 7).map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.end}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              onClick={closeOnMobile}
            >
              <item.icon size={19} aria-hidden="true" />
              <span>{item.label}</span>
            </NavLink>
          ))}
          <span className="nav-label nav-label-spaced">Konto</span>
          {NAV_ITEMS.slice(7).map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              onClick={closeOnMobile}
            >
              <item.icon size={19} aria-hidden="true" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          <NavLink to="/profile" className="sidebar-user" onClick={closeOnMobile}>
            <Avatar name={user.name} color={user.avatarColor} size="sm" />
            <span>
              <strong>{user.name}</strong>
              <small>{user.email}</small>
            </span>
          </NavLink>
          <button type="button" className="icon-btn sidebar-logout" onClick={logout} aria-label="Abmelden">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <button
            ref={menuButtonRef}
            type="button"
            className="icon-btn menu-button"
            onClick={() => setSidebarOpen((value) => !value)}
            aria-label={sidebarOpen ? 'Menü schließen' : 'Menü öffnen'}
            aria-expanded={sidebarOpen}
            aria-controls="main-navigation"
          >
            <Menu size={21} />
          </button>
          <div className="topbar-title">
            <strong>{current.label}</strong>
            <span className="topbar-date">{today}</span>
          </div>
          <div className="topbar-actions">
            <span className="assistant-pill">
              <span className="status-dot online" aria-hidden="true" />
              {settings?.assistantName || 'Victor'}
            </span>
            <NavLink to="/profile" className="topbar-avatar" aria-label="Profil öffnen">
              <Avatar name={user.name} color={user.avatarColor} size="sm" />
            </NavLink>
          </div>
        </header>

        <main className="content" id="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
