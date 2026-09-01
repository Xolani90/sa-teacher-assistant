import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTeacher } from '../auth/TeacherContext';
import { ApiError } from '../api/client';
import Layout from '../components/Layout';
import { Card, EmptyState, ErrorBanner, Spinner, Pill } from '../components/ui';

const STATUS_LOADING = 'loading';
const STATUS_READY = 'ready';
const STATUS_ERROR = 'error';

const RESOURCE_TYPE_LABELS = {
  lessonPlan: 'Lesson Plan',
  worksheet: 'Worksheet',
  test: 'Test',
  atp: 'ATP',
  sbaTask: 'SBA Task',
  examPaper: 'Exam Paper',
  rubric: 'Rubric',
  moderationPack: 'Moderation Pack',
  mentalMaths: 'Mental Maths',
};

/**
 * Resources Workspace — browse/filter saved resources (Feature 2
 * dashboard integration), backed directly by GET /api/resources (a
 * thin wrapper around teacherWorkspaceService.getSavedResources — the
 * SAME function/table the WhatsApp SAVE command writes to). No
 * aggregation service, no dashboard-only resource system: this page
 * displays exactly what was already persisted, same convention as
 * ObservationWorkspace.jsx composing GET /api/observations.
 *
 * Defaults to showing lesson plans first (the resource type Feature 2
 * is about), but a teacher can filter to any saved resource type —
 * this reuses the general saved_resources infrastructure rather than
 * building a lesson-plan-only page.
 *
 * Each row links into ResourceDetail (/resources/:id) for the full
 * content and, for a lesson plan, the persisted homework.
 */
export default function ResourcesWorkspace() {
  const { authedFetch } = useTeacher();
  const navigate = useNavigate();

  const [status, setStatus] = useState(STATUS_LOADING);
  const [resources, setResources] = useState([]);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('lessonPlan');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus(STATUS_LOADING);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (typeFilter) params.set('resourceType', typeFilter);
        const qs = params.toString();
        const body = await authedFetch(`/api/resources${qs ? `?${qs}` : ''}`);
        if (cancelled) return;
        setResources(body?.resources || []);
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
  }, [authedFetch, typeFilter]);

  // Free-text search over title/topic/subject is client-side, same
  // convention as ObservationWorkspace.jsx's search box — resourceType
  // is the only server-side filter, matching getSavedResources()'s own
  // filter params.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return resources;
    return resources.filter((r) => {
      const haystack = [r.title, r.topic, r.subject, r.grade != null ? `grade ${r.grade}` : '']
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [resources, query]);

  return (
    <Layout>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>Lesson Plans &amp; Resources</h1>
        <input
          type="text"
          placeholder="Search by title, topic, or subject…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={styles.search}
          aria-label="Search resources"
        />
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-5)', flexWrap: 'wrap' }}>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={styles.select} aria-label="Filter by resource type">
          <option value="lessonPlan">Lesson Plans</option>
          <option value="">All resource types</option>
          <option value="worksheet">Worksheets</option>
          <option value="test">Tests</option>
          <option value="sbaTask">SBA Tasks</option>
          <option value="examPaper">Exam Papers</option>
          <option value="rubric">Rubrics</option>
          <option value="atp">ATPs</option>
        </select>
      </div>

      {status === STATUS_LOADING && <Spinner label="Loading your saved resources…" />}

      {status === STATUS_ERROR && <ErrorBanner message={error} onRetry={() => window.location.reload()} />}

      {status === STATUS_READY && resources.length === 0 && (
        <EmptyState
          title={typeFilter === 'lessonPlan' ? 'No lesson plans saved yet' : 'No resources saved yet'}
          description={
            <>
              Generate one from WhatsApp — e.g. <code style={styles.code}>Lesson plan Grade 7 Mathematics fractions</code> —
              then reply <code style={styles.code}>SAVE</code>. It will show up here, homework included.
            </>
          }
        />
      )}

      {status === STATUS_READY && resources.length > 0 && filtered.length === 0 && (
        <p style={{ color: 'var(--color-text-secondary)' }}>No resources match "{query}".</p>
      )}

      {status === STATUS_READY && filtered.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {filtered.map((r) => (
            <Card key={r.id} onClick={() => navigate(`/resources/${r.id}`)} style={styles.rowCard}>
              <div>
                <div style={{ fontWeight: 600 }}>{r.title || 'Untitled resource'}</div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                  {r.subject}
                  {r.grade != null ? ` · Grade ${r.grade}` : ''}
                  {' · '}
                  {formatDate(r.createdAt)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                <Pill tone="neutral">{RESOURCE_TYPE_LABELS[r.resourceType] || r.resourceType}</Pill>
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
