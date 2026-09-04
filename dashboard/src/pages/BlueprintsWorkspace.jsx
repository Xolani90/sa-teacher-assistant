import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTeacher } from '../auth/TeacherContext';
import { ApiError } from '../api/client';
import Layout from '../components/Layout';
import { Card, EmptyState, ErrorBanner, Spinner, Pill } from '../components/ui';
import { formatDate } from '../utils/dateFormat';

const STATUS_LOADING = 'loading';
const STATUS_READY = 'ready';
const STATUS_ERROR = 'error';

const BLUEPRINT_STATUS_TONE = {
  draft: 'neutral',
  published: 'accent',
  archived: 'neutral',
};

/**
 * Assessment Blueprints Workspace — browse a teacher's CAPS-weighted
 * assessment blueprints (ADR-005), backed directly by GET /api/blueprints
 * (a thin wrapper around services/blueprintRepository.js's listBlueprints
 * — the SAME repository the WhatsApp blueprint-authoring flow
 * (flows/blueprintAuthoringFlow.js) writes to). No aggregation service,
 * no dashboard-only blueprint system: this page displays exactly what
 * was already persisted, same convention as ResourcesWorkspace.jsx
 * composing GET /api/resources.
 *
 * This is a READ surface only (Phase 1 of the WhatsApp ↔ Dashboard
 * mirroring work) — blueprint authoring/editing stays on WhatsApp.
 *
 * Each row links into BlueprintDetail (/blueprints/:id) for the full
 * weighting allocation.
 */
export default function BlueprintsWorkspace() {
  const { authedFetch } = useTeacher();
  const navigate = useNavigate();

  const [status, setStatus] = useState(STATUS_LOADING);
  const [blueprints, setBlueprints] = useState([]);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus(STATUS_LOADING);
      setError(null);
      try {
        const body = await authedFetch('/api/blueprints');
        if (cancelled) return;
        setBlueprints(body?.blueprints || []);
        setStatus(STATUS_READY);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
        setStatus(STATUS_ERROR);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [authedFetch]);

  // Free-text search over title/subject is client-side, same convention
  // as ResourcesWorkspace.jsx's search box.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return blueprints;
    return blueprints.filter((b) => {
      const haystack = [b.title, b.subject, b.grade != null ? `grade ${b.grade}` : '']
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [blueprints, query]);

  return (
    <Layout>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>Assessment Blueprints</h1>
        <input
          type="text"
          placeholder="Search by title, subject, or grade…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={styles.search}
          aria-label="Search assessment blueprints"
        />
      </div>

      {status === STATUS_LOADING && <Spinner label="Loading your assessment blueprints…" />}

      {status === STATUS_ERROR && <ErrorBanner message={error} onRetry={() => window.location.reload()} />}

      {status === STATUS_READY && blueprints.length === 0 && (
        <EmptyState
          title="No assessment blueprints yet"
          description={
            <>
              Create one from WhatsApp — e.g. <code style={styles.code}>Assessment blueprint Grade 7 Mathematics</code> —
              and its CAPS weighting allocation will show up here once saved.
            </>
          }
        />
      )}

      {status === STATUS_READY && blueprints.length > 0 && filtered.length === 0 && (
        <p style={{ color: 'var(--color-text-secondary)' }}>No blueprints match "{query}".</p>
      )}

      {status === STATUS_READY && filtered.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {filtered.map((b) => (
            <Card key={b.id} onClick={() => navigate(`/blueprints/${b.id}`)} style={styles.rowCard}>
              <div>
                <div style={{ fontWeight: 600 }}>{b.title || 'Untitled blueprint'}</div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                  {b.subject}
                  {b.grade != null ? ` · Grade ${b.grade}` : ''}
                  {b.term != null ? ` · Term ${b.term}` : ''}
                  {' · '}
                  {b.totalMarks != null ? `${b.totalMarks} marks` : ''}
                  {' · '}
                  {formatDate(b.updatedAt)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                <Pill tone="neutral">{b.questionCount != null ? `${b.questionCount} question${b.questionCount === 1 ? '' : 's'}` : ''}</Pill>
                <Pill tone={BLUEPRINT_STATUS_TONE[b.status] || 'neutral'}>{b.status}</Pill>
                <Pill>View →</Pill>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Layout>
  );
}


const styles = {
  search: {
    padding: '0.55rem var(--space-4)',
    fontSize: 'var(--text-sm)',
    border: '1px solid var(--color-border-strong)',
    borderRadius: 'var(--radius-full)',
    minWidth: 260,
    background: 'var(--color-surface)',
    color: 'var(--color-text-primary)',
    outline: 'none',
  },
  code: {
    background: 'var(--color-bg)',
    padding: '0.1rem 0.4rem',
    borderRadius: 4,
    fontSize: '0.9em',
  },
  rowCard: {
    padding: 'var(--space-4) var(--space-5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
};
