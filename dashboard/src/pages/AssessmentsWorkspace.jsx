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

/**
 * Assessments Workspace — teacher-wide browse/filter list of assessments
 * (Dashboard IA v1, Phase B), backed directly by GET /api/assessments (a
 * thin wrapper around assessmentDetailService.getAssessmentHistory). No
 * aggregation service: this page composes an existing, already-tested
 * read, same convention as ObservationWorkspace.jsx composing
 * GET /api/observations.
 *
 * Previously assessments were only reachable per-class via ClassDetail;
 * this adds the missing teacher-wide destination. Each row links into
 * the existing AssessmentDetail page (/assessments/:assessmentId) — this
 * page adds browse/filter, it does not duplicate the detail/PDF view.
 */
export default function AssessmentsWorkspace() {
  const { authedFetch } = useTeacher();
  const navigate = useNavigate();

  const [status, setStatus] = useState(STATUS_LOADING);
  const [assessments, setAssessments] = useState([]);
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
        const body = await authedFetch(`/api/assessments${qs ? `?${qs}` : ''}`);
        if (cancelled) return;
        setAssessments(body?.assessments || []);
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
  // getAssessmentHistory's own filter params); free-text search over
  // title/subject is client-side, same convention as
  // ObservationWorkspace.jsx's search box.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return assessments;
    return assessments.filter((a) => {
      const haystack = [a.title, a.subject, a.class?.name, a.grade != null ? `grade ${a.grade}` : '']
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [assessments, query]);

  const grades = useMemo(
    () => [...new Set(assessments.map((a) => a.grade).filter((g) => g != null))].sort((a, b) => a - b),
    [assessments]
  );
  const subjects = useMemo(
    () => [...new Set(assessments.map((a) => a.subject).filter(Boolean))].sort(),
    [assessments]
  );

  return (
    <Layout>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>Assessments</h1>
        <input
          type="text"
          placeholder="Search by title, class, or subject…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={styles.search}
          aria-label="Search assessments"
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

      {status === STATUS_LOADING && <Spinner label="Loading your assessments…" />}

      {status === STATUS_ERROR && <ErrorBanner message={error} onRetry={() => window.location.reload()} />}

      {status === STATUS_READY && assessments.length === 0 && (
        <EmptyState
          title="No assessments saved yet"
          description={
            <>
              Assessments you record from WhatsApp or via a Blueprint will show up here once saved,
              with class averages and pass rates where available.
            </>
          }
        />
      )}

      {status === STATUS_READY && assessments.length > 0 && filtered.length === 0 && (
        <p style={{ color: 'var(--color-text-secondary)' }}>No assessments match "{query}".</p>
      )}

      {status === STATUS_READY && filtered.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {filtered.map((a) => (
            <Card key={a.id} onClick={() => navigate(`/assessments/${a.id}`)} style={styles.rowCard}>
              <div>
                <div style={{ fontWeight: 600 }}>{a.title || 'Untitled assessment'}</div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                  {a.class?.name || a.subject}
                  {a.grade != null ? ` · Grade ${a.grade}` : ''}
                  {' · '}
                  {formatDate(a.createdAt)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                {a.classAverage != null && <Pill tone="neutral">Avg {a.classAverage}%</Pill>}
                {a.passRate != null && <Pill tone="neutral">Pass {a.passRate}%</Pill>}
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
  select: {
    padding: '0.5rem var(--space-3)',
    fontSize: 'var(--text-sm)',
    border: '1px solid var(--color-border-strong)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--color-surface)',
    color: 'var(--color-text-primary)',
  },
  rowCard: {
    padding: 'var(--space-4) var(--space-5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
};
