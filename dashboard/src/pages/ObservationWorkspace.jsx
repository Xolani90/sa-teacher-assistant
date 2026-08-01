import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTeacher } from '../auth/TeacherContext';
import { ApiError } from '../api/client';
import Layout from '../components/Layout';
import { Card, EmptyState, ErrorBanner, Spinner, Pill } from '../components/ui';

const STATUS_LOADING = 'loading';
const STATUS_READY = 'ready';
const STATUS_ERROR = 'error';

/**
 * Observation Workspace — browse/filter list of observation sessions,
 * backed directly by GET /api/observations (a thin wrapper around
 * observationRepository.getObservationHistory). No aggregation service:
 * this page composes an existing, already-tested repository read, same
 * as Classes.jsx composes GET /api/classes.
 *
 * Each row links into the existing ObservationDetail page
 * (/observations/:assessmentId) — this page adds browse/filter, it
 * does not duplicate the detail/analysis view.
 */
export default function ObservationWorkspace() {
  const { authedFetch } = useTeacher();
  const navigate = useNavigate();

  const [status, setStatus] = useState(STATUS_LOADING);
  const [observations, setObservations] = useState([]);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus(STATUS_LOADING);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (gradeFilter) params.set('grade', gradeFilter);
        if (subjectFilter) params.set('subject', subjectFilter);
        const qs = params.toString();
        const body = await authedFetch(`/api/observations${qs ? `?${qs}` : ''}`);
        if (cancelled) return;
        setObservations(body?.observations || []);
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
  }, [authedFetch, gradeFilter, subjectFilter]);

  // Grade/subject are server-side filters (re-fetch on change, matching
  // getObservationHistory's own filter params); free-text search over
  // assessmentName/learner is client-side, same convention as
  // Classes.jsx's search box.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return observations;
    return observations.filter((o) => {
      const haystack = [o.assessmentName, o.subject, o.grade != null ? `grade ${o.grade}` : '']
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [observations, query]);

  const grades = useMemo(
    () => [...new Set(observations.map((o) => o.grade).filter((g) => g != null))].sort((a, b) => a - b),
    [observations]
  );
  const subjects = useMemo(
    () => [...new Set(observations.map((o) => o.subject).filter(Boolean))].sort(),
    [observations]
  );

  return (
    <Layout>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>Observations</h1>
        <input
          type="text"
          placeholder="Search by session, grade, or subject…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={styles.search}
          aria-label="Search observations"
        />
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-5)', flexWrap: 'wrap' }}>
        <select value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)} style={styles.select} aria-label="Filter by grade">
          <option value="">All grades</option>
          {grades.map((g) => (
            <option key={g} value={g}>Grade {g}</option>
          ))}
        </select>
        <select value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)} style={styles.select} aria-label="Filter by subject">
          <option value="">All subjects</option>
          {subjects.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {status === STATUS_LOADING && <Spinner label="Loading observations…" />}

      {status === STATUS_ERROR && <ErrorBanner message={error} onRetry={() => window.location.reload()} />}

      {status === STATUS_READY && observations.length === 0 && (
        <EmptyState
          title="No observations yet"
          description={
            <>
              Log your first classroom observation from WhatsApp — once saved, it will
              show up here and under <code style={styles.code}>MY OBSERVATIONS</code>.
            </>
          }
        />
      )}

      {status === STATUS_READY && observations.length > 0 && filtered.length === 0 && (
        <p style={{ color: 'var(--color-text-secondary)' }}>No observations match "{query}".</p>
      )}

      {status === STATUS_READY && filtered.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {filtered.map((o) => (
            <Card key={o.id} onClick={() => navigate(`/observations/${o.id}`)} style={styles.rowCard}>
              <div>
                <div style={{ fontWeight: 600 }}>{o.assessmentName || 'Observation session'}</div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                  {o.subject}
                  {o.grade != null ? ` · Grade ${o.grade}` : ''}
                  {' · '}
                  {formatDate(o.createdAt)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                <Pill tone="neutral">{o.learnerCount} {o.learnerCount === 1 ? 'learner' : 'learners'}</Pill>
                <Pill>View →</Pill>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Layout>
  );
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T'));
  return d.toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric' });
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
  select: {
    padding: '0.5rem var(--space-3)',
    fontSize: 'var(--text-sm)',
    border: '1px solid var(--color-border-strong)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--color-surface)',
    color: 'var(--color-text-primary)',
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
