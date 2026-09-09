import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTeacher } from '../auth/TeacherContext';
import { NAV_ITEMS } from './Layout';

/**
 * Global quick-jump search (⌘K / Ctrl+K), mounted once in Layout so it's
 * available from every authenticated page.
 *
 * Searches three things, in this order:
 *   1. "Go to" — the same NAV_ITEMS the sidebar renders, so keyboard-first
 *      teachers never have to reach for the mouse to switch sections.
 *   2. Classes — from GET /api/classes (already-fetched-elsewhere data,
 *      fetched here lazily on first open and cached for the session; no
 *      new backend endpoint).
 *   3. Learners — from GET /api/learners, same convention.
 *
 * Deliberately client-side substring matching, not fuzzy/AI matching —
 * fast, predictable, and needs no network round-trip per keystroke.
 */
export default function CommandPalette() {
  const { authedFetch } = useTeacher();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [classes, setClasses] = useState(null); // null = not yet loaded
  const [learners, setLearners] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const inputRef = useRef(null);
  const loadedOnceRef = useRef(false);

  const loadData = useCallback(async () => {
    if (loadedOnceRef.current) return;
    loadedOnceRef.current = true;
    try {
      const [classesRes, learnersRes] = await Promise.all([
        authedFetch('/api/classes'),
        authedFetch('/api/learners'),
      ]);
      setClasses(classesRes?.classes || []);
      setLearners(learnersRes?.learners || []);
    } catch {
      // Quick-jump degrading to nav-only search on a fetch failure is fine
      // — it's a convenience layer, not the source of truth for this data.
      setLoadError(true);
      setClasses([]);
      setLearners([]);
    }
  }, [authedFetch]);

  const openPalette = useCallback(() => {
    setOpen(true);
    setQuery('');
    setActiveIndex(0);
    loadData();
  }, [loadData]);

  const closePalette = useCallback(() => {
    setOpen(false);
  }, []);

  // Global keyboard shortcut: ⌘K (Mac) / Ctrl+K (Windows/Linux) opens from
  // anywhere; Escape closes. Registered once, cleaned up on unmount.
  // Also listens for a same-purpose custom event so the visible "Search"
  // button in Layout's header can trigger the exact same open path,
  // without CommandPalette needing to lift its open state up to Layout.
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((prev) => {
          if (!prev) loadData();
          return true;
        });
        return;
      }
      if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    function handleOpenEvent() {
      setOpen(true);
      loadData();
    }
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('open-command-palette', handleOpenEvent);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('open-command-palette', handleOpenEvent);
    };
  }, [loadData]);

  useEffect(() => {
    if (open) {
      // Focus after the overlay mounts, not before.
      const id = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
  }, [open]);

  const q = query.trim().toLowerCase();

  const navResults = q
    ? NAV_ITEMS.filter((item) => item.label.toLowerCase().includes(q))
    : NAV_ITEMS;

  const classResults = q && classes
    ? classes.filter((c) => (c.name || '').toLowerCase().includes(q)).slice(0, 6)
    : [];

  const learnerResults = q && learners
    ? learners.filter((l) => (l.canonicalName || '').toLowerCase().includes(q)).slice(0, 6)
    : [];

  // Flat list, in display order, so ArrowUp/ArrowDown and Enter work
  // against a single index regardless of which group an item is in.
  const flatResults = [
    ...navResults.map((item) => ({ kind: 'nav', item })),
    ...classResults.map((item) => ({ kind: 'class', item })),
    ...learnerResults.map((item) => ({ kind: 'learner', item })),
  ];

  function select(entry) {
    if (!entry) return;
    if (entry.kind === 'nav') navigate(entry.item.to);
    else if (entry.kind === 'class') navigate(`/classes/${entry.item.id}`);
    else if (entry.kind === 'learner') navigate(`/learners/${entry.item.id}`);
    closePalette();
  }

  function handleInputKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      select(flatResults[activeIndex]);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div
      role="presentation"
      onClick={closePalette}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 15, 20, 0.45)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '12vh 1rem 1rem',
      }}
    >
      <div
        role="dialog"
        aria-label="Quick jump"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 560,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-md)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--color-border)' }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="Jump to a class, learner, or section…"
            aria-label="Quick jump search"
            style={{
              width: '100%',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: 'var(--text-md)',
              color: 'var(--color-text-primary)',
            }}
          />
        </div>

        <div style={{ maxHeight: '55vh', overflowY: 'auto', padding: 'var(--space-2)' }}>
          {flatResults.length === 0 && (
            <p style={{ padding: 'var(--space-4)', margin: 0, color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
              {loadError ? 'No matching sections (classes/learners search unavailable right now).' : 'No matches.'}
            </p>
          )}

          {navResults.length > 0 && (
            <ResultGroup label="Go to">
              {navResults.map((item) => {
                const flatIdx = flatResults.findIndex((r) => r.kind === 'nav' && r.item.to === item.to);
                return (
                  <ResultRow
                    key={item.to}
                    active={flatIdx === activeIndex}
                    onMouseEnter={() => setActiveIndex(flatIdx)}
                    onClick={() => select({ kind: 'nav', item })}
                  >
                    <span aria-hidden="true" style={{ marginRight: 'var(--space-3)' }}>{item.icon}</span>
                    {item.label}
                  </ResultRow>
                );
              })}
            </ResultGroup>
          )}

          {classResults.length > 0 && (
            <ResultGroup label="Classes">
              {classResults.map((c) => {
                const flatIdx = flatResults.findIndex((r) => r.kind === 'class' && r.item.id === c.id);
                return (
                  <ResultRow
                    key={c.id}
                    active={flatIdx === activeIndex}
                    onMouseEnter={() => setActiveIndex(flatIdx)}
                    onClick={() => select({ kind: 'class', item: c })}
                  >
                    <span aria-hidden="true" style={{ marginRight: 'var(--space-3)' }}>👥</span>
                    {c.name}
                    {c.grade && <span style={{ color: 'var(--color-text-tertiary)', marginLeft: 'var(--space-2)', fontSize: 'var(--text-xs)' }}>Grade {c.grade}</span>}
                  </ResultRow>
                );
              })}
            </ResultGroup>
          )}

          {learnerResults.length > 0 && (
            <ResultGroup label="Learners">
              {learnerResults.map((l) => {
                const flatIdx = flatResults.findIndex((r) => r.kind === 'learner' && r.item.id === l.id);
                return (
                  <ResultRow
                    key={l.id}
                    active={flatIdx === activeIndex}
                    onMouseEnter={() => setActiveIndex(flatIdx)}
                    onClick={() => select({ kind: 'learner', item: l })}
                  >
                    <span aria-hidden="true" style={{ marginRight: 'var(--space-3)' }}>🧑‍🎓</span>
                    {l.canonicalName}
                  </ResultRow>
                );
              })}
            </ResultGroup>
          )}
        </div>

        <div
          style={{
            borderTop: '1px solid var(--color-border)',
            padding: 'var(--space-2) var(--space-4)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-tertiary)',
            display: 'flex',
            gap: 'var(--space-4)',
          }}
        >
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}

function ResultGroup({ label, children }) {
  return (
    <div style={{ marginBottom: 'var(--space-2)' }}>
      <div
        style={{
          padding: 'var(--space-2) var(--space-3) var(--space-1)',
          fontSize: 'var(--text-xs)',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--color-text-tertiary)',
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function ResultRow({ active, onClick, onMouseEnter, children }) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      style={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        textAlign: 'left',
        padding: '0.55rem var(--space-3)',
        borderRadius: 'var(--radius-sm)',
        border: 'none',
        background: active ? 'var(--color-accent-soft)' : 'transparent',
        color: active ? 'var(--color-accent)' : 'var(--color-text-primary)',
        fontSize: 'var(--text-base)',
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}
