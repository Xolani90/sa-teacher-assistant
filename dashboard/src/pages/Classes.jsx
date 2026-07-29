import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTeacher } from '../auth/TeacherContext';
import { ApiError } from '../api/client';
import Layout from '../components/Layout';
import { Card, EmptyState, ErrorBanner, Spinner, Pill } from '../components/ui';

const STATUS_LOADING = 'loading';
const STATUS_READY = 'ready';
const STATUS_ERROR = 'error';

export default function Classes() {
  const { authedFetch } = useTeacher();
  const navigate = useNavigate();

  const [status, setStatus] = useState(STATUS_LOADING);
  const [classes, setClasses] = useState([]);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus(STATUS_LOADING);
      setError(null);
      try {
        const body = await authedFetch('/api/classes');
        if (cancelled) return;
        setClasses(body?.classes || []);
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return classes;
    return classes.filter((c) => {
      const haystack = [c.name, c.subject, c.grade != null ? `grade ${c.grade}` : '']
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [classes, query]);

  return (
    <Layout>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>Classes</h1>
        {status === STATUS_READY && classes.length > 0 && (
          <input
            type="text"
            placeholder="Search by name, grade, or subject…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={styles.search}
            aria-label="Search classes"
          />
        )}
      </div>

      {status === STATUS_LOADING && <Spinner label="Loading your classes…" />}

      {status === STATUS_ERROR && <ErrorBanner message={error} onRetry={() => window.location.reload()} />}

      {status === STATUS_READY && classes.length === 0 && (
        <EmptyState
          title="No classes yet"
          description={
            <>
              Create your first class from WhatsApp with <code style={styles.code}>NEW CLASS Grade 7A, 34</code> and it
              will show up here.
            </>
          }
        />
      )}

      {status === STATUS_READY && classes.length > 0 && filtered.length === 0 && (
        <p style={{ color: 'var(--color-text-secondary)' }}>No classes match "{query}".</p>
      )}

      {status === STATUS_READY && filtered.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 'var(--space-4)' }}>
          {filtered.map((cls) => (
            <Card key={cls.id} onClick={() => navigate(`/classes/${cls.id}`)} style={{ padding: 'var(--space-5)' }}>
              <div style={{ fontWeight: 600, fontSize: 'var(--text-md)', marginBottom: 'var(--space-2)' }}>{cls.name}</div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
                {cls.grade != null && <Pill>Grade {cls.grade}</Pill>}
                {cls.subject && <Pill tone="accent">{cls.subject}</Pill>}
              </div>
              <div style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
                {cls.learnerCount} {cls.learnerCount === 1 ? 'learner' : 'learners'}
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
};
