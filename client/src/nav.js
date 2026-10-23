import {
  AudioLines,
  CalendarDays,
  Cable,
  LayoutDashboard,
  ListChecks,
  Phone,
  ScrollText,
  Settings2,
  UserRound,
  Users,
} from 'lucide-react';

export const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { path: '/talk', label: 'Mit Victor sprechen', icon: AudioLines },
  { path: '/calls', label: 'Anrufe', icon: Phone },
  { path: '/transcripts', label: 'Transkripte', icon: ScrollText },
  { path: '/tasks', label: 'Aufgaben', icon: ListChecks },
  { path: '/contacts', label: 'Kontakte', icon: Users },
  { path: '/calendar', label: 'Kalender', icon: CalendarDays },
  { path: '/profile', label: 'Profil', icon: UserRound },
  { path: '/integrations', label: 'Integrationen', icon: Cable },
  { path: '/settings', label: 'Einstellungen', icon: Settings2 },
];

export function findNavItem(pathname) {
  return (
    NAV_ITEMS.find((item) => (item.end ? item.path === pathname : pathname.startsWith(item.path))) ||
    NAV_ITEMS[0]
  );
}
