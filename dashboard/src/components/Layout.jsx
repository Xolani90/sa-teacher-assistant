import { NavLink, useNavigate } from 'react-router-dom';
import { useTeacher } from '../auth/TeacherContext';
import { useTheme } from '../theme/ThemeContext';
import CommandPalette from './CommandPalette';
import logo from '../assets/logo.png';

// Dashboard IA v1: flat sidebar, no grouping headers.
// 'Resources' (was 'Lesson Plans') now covers all saved resource types, not
// just lesson plans. 'Assessments' and 'Reflections & Goals' are new direct
// destinations (previously only reachable via ClassDetail / QMS respectively).
// 'QMS & Readiness' (was 'QMS Readiness') no longer hosts Reflections/Growth
// Plans — see QMS.jsx and ReflectionsGoals.jsx.
// 'Assessment Blueprints' is placed directly after 'Assessments': a
// Blueprint (ADR-005) is reusable question metadata that an Assessment can
// optionally be generated from — related-but-distinct concepts a teacher
// should be able to move between without scanning past unrelated items
// (Observations, Reflections, Incidents) in the sidebar.
// Exported so CommandPalette.jsx can reuse the exact same destination
// list/order for its "Go to" results, instead of maintaining a second copy
// that could drift out of sync with the sidebar.
export const NAV_ITEMS = [
  { to: '/app', label: 'Overview', icon: '◆', end: true },
  { to: '/classes', label: 'Classes', icon: '▤' },
  { to: '/resources', label: 'Resources', icon: '▦' },
  { to: '/assessments', label: 'Assessments', icon: '▥' },
  { to: '/blueprints', label: 'Assessment Blueprints', icon: '⚖' },
  { to: '/observations', label: 'Observations', icon: '◎' },
  { to: '/reflections', label: 'Reflections & Goals', icon: '✎' },
  { to: '/incidents', label: 'Incidents', icon: '⚠' },
  { to: '/qms', label: 'QMS & Readiness', icon: '✓' },
];

export default function Layout({ children }) {
  const { teacher, logout } = useTeacher();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  const initial = (teacher?.name || 'T').trim().charAt(0).toUpperCase();

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--color-bg)' }}>
      <aside
        style={{
          width: 'var(--sidebar-width)',
          flexShrink: 0,
          borderRight: '1px solid var(--color-border)',
          padding: 'var(--space-5) var(--space-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-6)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '0 var(--space-2)' }}>
          <img
            src={logo}
            alt="SA Teacher Assistant"
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              objectFit: 'cover',
              flexShrink: 0,
            }}
          />
          <span style={{ fontWeight: 600, fontSize: 'var(--text-base)' }}>SA Teacher</span>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                padding: '0.6rem var(--space-3)',
                borderRadius: 'var(--radius-sm)',
                textDecoration: 'none',
                fontSize: 'var(--text-base)',
                fontWeight: isActive ? 600 : 500,
                color: isActive ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                background: isActive ? 'var(--color-accent-soft)' : 'transparent',
                transition: 'background var(--duration-fast) var(--ease-standard)',
              })}
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <button
            onClick={toggleTheme}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.55rem var(--space-3)',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
            }}
          >
            {theme === 'dark' ? '☀︎ Light mode' : '☾ Dark mode'}
          </button>
        </div>
      </aside>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 'var(--space-4)',
            padding: 'var(--space-4) var(--space-6)',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('open-command-palette'))}
            aria-label="Quick jump search"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-full)',
              padding: '0.4rem 0.85rem',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              marginRight: 'auto',
            }}
          >
            <span aria-hidden="true">⌕</span>
            Search
            <kbd
              style={{
                marginLeft: 'var(--space-2)',
                fontSize: 'var(--text-xs)',
                border: '1px solid var(--color-border-strong)',
                borderRadius: 'var(--radius-xs, 4px)',
                padding: '0.05rem 0.35rem',
                color: 'var(--color-text-tertiary)',
              }}
            >
              ⌘K
            </kbd>
          </button>
          <button
            onClick={handleLogout}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-text-secondary)',
              fontSize: 'var(--text-sm)',
              cursor: 'pointer',
            }}
          >
            Log out
          </button>
          <div
            title={teacher?.name || 'Teacher'}
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'var(--color-accent-soft)',
              color: 'var(--color-accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: 'var(--text-sm)',
            }}
          >
            {initial}
          </div>
        </header>

        <main style={{ flex: 1, padding: 'var(--space-6)', maxWidth: 1100, width: '100%', margin: '0 auto' }}>
          {children}
        </main>
      </div>

      <CommandPalette />
    </div>
  );
}
