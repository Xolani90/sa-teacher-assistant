import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTeacher } from '../auth/TeacherContext';
import { ApiError } from '../api/client';
import Layout from '../components/Layout';
import { Card, EmptyState, ErrorBanner, Spinner, IconBadge, SectionHeader, Pill, Button } from '../components/ui';
import ClassSnapshotSection from '../components/ClassSnapshotSection';

const STATUS_LOADING = 'loading';
const STATUS_READY = 'ready';
const STATUS_ERROR = 'error';

const PRIORITY_TONE = { high: 'warning', medium: 'accent', low: 'neutral' };
const PRIORITY_LABEL = { high: 'High priority', medium: 'Medium priority', low: 'Low priority' };

/**
 * Command-center view of a single class, backed by the aggregated
 * GET /api/classes/:classId/detail payload (services/classDetailService.js).
 * One request, one screen: class health, recent assessments, curriculum
 * coverage, intervention priorities, and the roster with per-learner
 * averages.
 */
export default function ClassDetail() {
  const { classId } = useParams();
  const navigate = useNavigate();
  const { authedFetch } = useTeacher();

  const [status, setStatus] = useState(STATUS_LOADING);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');

  // Class editing (Phase 6 continuation) — a thin wrapper around
  // PATCH/DELETE /api/classes/:classId, which are themselves thin
  // wrappers over the pre-existing services/teacherWorkspaceService.js
  // updateClass()/deleteClass(). Same idle/editing mode + confirm-then-
  // delete pattern as GrowthPlanPanel.jsx, scoped to this one class.
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editGrade, setEditGrade] = useState('');
  const [editSubject, setEditSubject] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const [snapshotStatus, setSnapshotStatus] = useState(STATUS_LOADING);
  const [snapshot, setSnapshot] = useState(null);
  const [snapshotError, setSnapshotError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus(STATUS_LOADING);
      setError(null);
      try {
        const res = await authedFetch(`/api/classes/${classId}/detail`);
        if (cancelled) return;
        setDetail(res);
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

  // Re-fetch after a successful edit — same "reload the aggregated view
  // rather than patch local state by hand" convention the snapshot
  // reload below already uses, so class/detail stays the single source
  // of truth for what's rendered.
  const reloadDetail = useCallback(async () => {
    try {
      const res = await authedFetch(`/api/classes/${classId}/detail`);
      setDetail(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setStatus(STATUS_ERROR);
    }
  }, [authedFetch, classId]);

  function startEdit() {
    setEditName(detail?.class?.name || '');
    setEditGrade(detail?.class?.grade != null ? String(detail.class.grade) : '');
    setEditSubject(detail?.class?.subject || '');
    setEditError(null);
    setIsEditing(true);
  }

  function cancelEdit() {
    setIsEditing(false);
    setEditError(null);
  }

  async function saveEdit() {
    const trimmedName = editName.trim();
    const trimmedSubject = editSubject.trim();
    if (!trimmedName) {
      setEditError('Name cannot be empty.');
      return;
    }
    const gradeNum = Number(editGrade);
    if (!Number.isInteger(gradeNum) || gradeNum <= 0) {
      setEditError('Grade must be a positive number.');
      return;
    }
    if (!trimmedSubject) {
      setEditError('Subject cannot be empty.');
      return;
    }

    setSavingEdit(true);
    setEditError(null);
    try {
      await authedFetch(`/api/classes/${classId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName, grade: gradeNum, subject: trimmedSubject }),
      });
      setIsEditing(false);
      await reloadDetail();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : 'Could not save changes. Please try again.');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDeleteClass() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await authedFetch(`/api/classes/${classId}`, { method: 'DELETE' });
      navigate('/classes');
    } catch (err) {
      // Most commonly a 409 from the dependent-record guard (this class
      // still has learners/assessments/observations linked) — surface
      // the service's own explanatory message rather than a generic one.
      setDeleteError(err instanceof ApiError ? err.message : 'Could not delete this class. Please try again.');
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  // Independent of the /detail load above (deliberately not Promise.all'd
  // together): GET /api/classes/:classId/snapshot (ADR-014) is a newer,
  // separate endpoint. Keeping the fetch/error state isolated means a
  // snapshot failure never blocks the rest of the page from rendering,
  // and vice versa — same fault-isolation principle classSnapshotService
  // itself applies at the section level.
  const loadSnapshot = useCallback(async () => {
    setSnapshotStatus(STATUS_LOADING);
    setSnapshotError(null);
    try {
      const res = await authedFetch(`/api/classes/${classId}/snapshot`);
      setSnapshot(res);
      setSnapshotStatus(STATUS_READY);
    } catch (err) {
      setSnapshotError(err instanceof ApiError ? err.message : 'Something went wrong loading the class snapshot.');
      setSnapshotStatus(STATUS_ERROR);
    }
  }, [authedFetch, classId]);

  useEffect(() => {
    loadSnapshot();
  }, [loadSnapshot]);

  const learners = detail?.learners || [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return learners;
    return learners.filter((l) => (l.learnerName || '').toLowerCase().includes(q));
  }, [learners, query]);

  const cls = detail?.class;
  const health = detail?.classHealth;

  return (
    <Layout>
      <button onClick={() => navigate('/classes')} style={styles.backButton}>
        ← Back to Classes
      </button>

      {status === STATUS_LOADING && <Spinner label="Loading class…" />}

      {status === STATUS_ERROR && <ErrorBanner message={error} onRetry={() => window.location.reload()} />}

      {status === STATUS_READY && detail && (
        <>
          <div style={{ marginBottom: 'var(--space-6)' }}>
            {isEditing ? (
              <div style={styles.editForm}>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Class name"
                  aria-label="Class name"
                  style={styles.editInput}
                  autoFocus
                />
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <input
                    type="number"
                    value={editGrade}
                    onChange={(e) => setEditGrade(e.target.value)}
                    placeholder="Grade"
                    aria-label="Grade"
                    style={{ ...styles.editInput, maxWidth: 120 }}
                  />
                  <input
                    type="text"
                    value={editSubject}
                    onChange={(e) => setEditSubject(e.target.value)}
                    placeholder="Subject"
                    aria-label="Subject"
                    style={styles.editInput}
                  />
                </div>
                {editError && <p style={styles.formError}>{editError}</p>}
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <Button onClick={saveEdit} disabled={savingEdit}>
                    {savingEdit ? 'Saving…' : 'Save Changes'}
                  </Button>
                  <Button variant="secondary" onClick={cancelEdit} disabled={savingEdit}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
                  <div>
                    <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 var(--space-2)' }}>
                      {cls?.name || `Class #${classId}`}
                    </h1>
                    <p style={{ color: 'var(--color-text-secondary)', margin: 0, fontSize: 'var(--text-base)' }}>
                      {cls?.grade != null ? `Grade ${cls.grade}` : 'No grade set'}
                      {cls?.subject ? ` · ${cls.subject}` : ''} · {learners.length} {learners.length === 1 ? 'learner' : 'learners'}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                    <Button variant="ghost" onClick={startEdit}>
                      Edit
                    </Button>
                    {confirmDelete ? (
                      <>
                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                          Delete this class?
                        </span>
                        <Button variant="danger" onClick={handleDeleteClass} disabled={deleting}>
                          {deleting ? 'Deleting…' : 'Confirm'}
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
                {deleteError && <p style={styles.formError}>{deleteError}</p>}
              </>
            )}
          </div>

          {/* Class health */}
          <div style={styles.healthGrid}>
            <HealthStat icon="📊" tone="indigo" label="Class average" value={health?.average != null ? `${health.average}%` : '—'} />
            <HealthStat icon="✅" tone="mint" label="Pass rate" value={health?.passRate != null ? `${health.passRate}%` : '—'} />
            <HealthStat icon="⚠️" tone="amber" label="At risk" value={health?.atRisk ?? '—'} />
            <HealthStat icon="🎯" tone="lavender" label="Active interventions" value={health?.activeInterventions ?? '—'} />
          </div>

          {/* ADR-014 class snapshot (analytics/intervention/qms) */}
          <ClassSnapshotSection
            status={snapshotStatus}
            error={snapshotError}
            snapshot={snapshot}
            onRetry={loadSnapshot}
          />

          {/* Curriculum coverage */}
          <Card style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-6)' }}>
            <SectionHeader
              title="Curriculum coverage"
              subtitle={
                detail.curriculumCoverage?.dataAvailable
                  ? `${detail.curriculumCoverage.percentage}% of the ATP covered so far`
                  : 'No coverage data yet'
              }
            />
            {detail.curriculumCoverage?.dataAvailable && (
              <>
                <div style={styles.coverageTrack}>
                  <div
                    style={{
                      ...styles.coverageFill,
                      width: `${Math.min(100, Math.max(0, detail.curriculumCoverage.percentage))}%`,
                    }}
                  />
                </div>
                {detail.curriculumCoverage.remainingTopics?.length > 0 && (
                  <p style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                    Still outstanding: {detail.curriculumCoverage.remainingTopics.slice(0, 6).join(', ')}
                    {detail.curriculumCoverage.remainingTopics.length > 6 ? '…' : ''}
                  </p>
                )}
              </>
            )}
          </Card>

          {/* Recent assessments */}
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <SectionHeader title="Recent assessments" />
            {detail.recentAssessments?.length === 0 ? (
              <EmptyState title="No assessments yet" description="Marks captured from WhatsApp will show up here." />
            ) : (
              <div style={styles.cardList}>
                {detail.recentAssessments.map((a) => (
                  <Card key={a.assessmentId} style={styles.rowCard} onClick={() => navigate(`/assessments/${a.assessmentId}`)}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{a.title}</div>
                      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                        {a.subject}
                        {a.term ? ` · Term ${a.term}` : ''} · {a.learnerCount} {a.learnerCount === 1 ? 'learner' : 'learners'}
                      </div>
                    </div>
                    <Pill tone={a.classAverage >= 50 ? 'success' : 'warning'}>{a.classAverage}% avg</Pill>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Intervention priorities */}
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <SectionHeader
              title="Intervention priorities"
              subtitle={
                detail.interventions?.summary
                  ? `${detail.interventions.summary.evaluatedLearners} evaluated · ${detail.interventions.summary.insufficientData} need more data`
                  : undefined
              }
            />
            {['high', 'medium'].every((p) => (detail.interventions?.priorityLearners?.[p]?.length || 0) === 0) ? (
              <EmptyState title="Nothing urgent right now" description="High and medium priority learners will appear here." />
            ) : (
              <div style={styles.cardList}>
                {['high', 'medium'].flatMap((priority) =>
                  (detail.interventions.priorityLearners[priority] || []).map((l) => (
                    <Card key={`${priority}-${l.learnerId}`} style={styles.rowCard}>
                      <span style={{ fontWeight: 500 }}>{l.learnerName}</span>
                      <Pill tone={PRIORITY_TONE[priority]}>{PRIORITY_LABEL[priority]}</Pill>
                    </Card>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Roster */}
          <div>
            <SectionHeader title="Roster" />
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
              <div style={styles.cardList}>
                {filtered.map((l) => (
                  <Card
                    key={l.learnerId}
                    onClick={() => navigate(`/learners/${l.learnerId}`)}
                    style={styles.rowCard}
                  >
                    <span style={{ fontWeight: 500 }}>{l.learnerName}</span>
                    {l.average != null ? (
                      <Pill tone={l.passing ? 'success' : 'warning'}>
                        {l.average}% · {l.assessmentCount} {l.assessmentCount === 1 ? 'mark' : 'marks'}
                      </Pill>
                    ) : (
                      <Pill>No data yet</Pill>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </Layout>
  );
}

function HealthStat({ icon, tone, label, value }) {
  return (
    <Card style={{ padding: 'var(--space-5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
        <IconBadge tone={tone}>{icon}</IconBadge>
        <div>
          <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            {value}
          </div>
          <div style={{ marginTop: '0.2rem', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
            {label}
          </div>
        </div>
      </div>
    </Card>
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
  editForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-3)',
    padding: 'var(--space-4)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--color-bg)',
    border: '1px solid var(--color-border)',
    maxWidth: 480,
  },
  editInput: {
    width: '100%',
    padding: 'var(--space-3)',
    fontSize: 'var(--text-sm)',
    fontFamily: 'inherit',
    border: '1px solid var(--color-border-strong)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--color-surface)',
    color: 'var(--color-text-primary)',
    boxSizing: 'border-box',
  },
  formError: {
    color: 'var(--color-danger)',
    fontSize: 'var(--text-sm)',
    margin: '0.4rem 0 0',
  },
  healthGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 'var(--space-4)',
    marginBottom: 'var(--space-6)',
  },
  coverageTrack: {
    width: '100%',
    height: 10,
    borderRadius: 'var(--radius-full)',
    background: 'var(--color-bg)',
    overflow: 'hidden',
  },
  coverageFill: {
    height: '100%',
    borderRadius: 'var(--radius-full)',
    background: 'var(--color-accent)',
    transition: 'width var(--duration-base) var(--ease-standard)',
  },
  cardList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
  },
  rowCard: {
    padding: 'var(--space-4) var(--space-5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
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
