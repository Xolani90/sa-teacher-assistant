import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTeacher } from '../auth/TeacherContext';
import { ApiError } from '../api/client';
import Layout from '../components/Layout';
import { Card, EmptyState, ErrorBanner, Spinner, Button } from '../components/ui';

const STATUS_LOADING = 'loading';
const STATUS_READY = 'ready';
const STATUS_ERROR = 'error';

export default function ClassDetail() {
  const { classId } = useParams();
  const navigate = useNavigate();
  const { authedFetch } = useTeacher();

  const [status, setStatus] = useState(STATUS_LOADING);
  const [cls, setCls] = useState(null);
  const [learners, setLearners] = useState([]);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus(STATUS_LOADING);
      setError(null);
      try {
        const [classesRes, learnersRes] = await Promise.all([
          authedFetch('/api/classes'),
          authedFetch('/api/learners'),
        ]);
        if (cancelled) return;

        const matchedClass = (classesRes?.classes || []).find((c) => String(c.id) === String(classId)) || null;
        // /api/learners has no classId filter server-side (ADR-008 scope);
        // filter client-side against the classId each learner already carries.
        const classLearners = (learnersRes?.learners || []).filter(
          (l) => String(l.classId) === String(classId)
        );

        setCls(matchedClass);
        setLearners(classLearners);
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
  }, [authedFetch, classId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return learners;
    return learners.filter((l) => (l.canonicalName || '').toLowerCase().includes(q));
  }, [learners, query]);

  return (
    <Layout>
      <button onClick={() => navigate('/classes')} style={styles.backButton}>
        ← Back to Classes
      </button>

      {status === STATUS_LOADING && <Spinner label="Loading class…" />}

      {status === STATUS_ERROR && <ErrorBanner message={error} onRetry={() => window.location.reload()} />}

      {status === STATUS_READY && (
        <>
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 var(--space-2)' }}>
              {cls?.name || `Class #${classId}`}
            </h1>
            <p style={{ color: 'var(--color-text-secondary)', margin: 0, fontSize: 'var(--text-base)' }}>
              {cls?.grade != null ? `Grade ${cls.grade}` : 'No grade set'}
              {cls?.subject ? ` · ${cls.subject}` : ''} · {learners.length} {learners.length === 1 ? 'learner' : 'learners'}
            </p>
          </div>

          {learners.length > 0 && (
            <input
              type="text"
              placeholder="Search learners…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={styles.search}
              aria-label="Search learners"
            />
          )}

          {learners.length === 0 && (
            <EmptyState
              title="No learners yet"
              description="Learners added to this class from WhatsApp will appear here."
            />
          )}

          {learners.length > 0 && filtered.length === 0 && (
            <p style={{ color: 'var(--color-text-secondary)' }}>No learners match "{query}".</p>
          )}

          {filtered.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
              {filtered.map((l) => (
                <Card key={l.id} style={{ padding: 'var(--space-4) var(--space-5)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 500 }}>{l.canonicalName}</span>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </Layout>
  );
}

const styles = {
  backButton: {
    background: 'none',
    border: 'none',
    color: 'var(--color-accent)',
    cursor: 'pointer',
    fontSize: 'var(--text-sm)',
    padding: 0,
    marginBottom: 'var(--space-5)',
    fontWeight: 500,
  },
  search: {
    padding: '0.55rem var(--space-4)',
    fontSize: 'var(--text-sm)',
    border: '1px solid var(--color-border-strong)',
    borderRadius: 'var(--radius-full)',
    minWidth: 260,
    background: 'var(--color-surface)',
    color: 'var(--color-text-primary)',
    outline: 'none',
    marginBottom: 'var(--space-4)',
  },
};
