import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTeacher } from '../auth/TeacherContext';
import { ApiError } from '../api/client';
import Layout from '../components/Layout';
import { Card, EmptyState, ErrorBanner, Spinner, IconBadge, SectionHeader, Pill, Button } from '../components/ui';

const STATUS_LOADING = 'loading';
const STATUS_READY = 'ready';
const STATUS_ERROR = 'error';

const PRIORITY_TONE = { high: 'warning', medium: 'accent', low: 'neutral' };
const PRIORITY_LABEL = { high: 'High priority', medium: 'Medium priority', low: 'Low priority' };
const TREND_LABEL = {
  improving: 'Improving',
  declining: 'Needs attention',
  stable: 'Stable',
  'insufficient-data': 'Not enough data yet',
};
const TREND_TONE = {
  improving: 'success',
  declining: 'warning',
  stable: 'neutral',
  'insufficient-data': 'neutral',
};

/**
 * Full-profile view of a single learner, backed by the aggregated
 * GET /api/learners/:learnerId/detail payload
 * (services/learnerDetailService.js). One request, one screen: KPIs,
 * assessment history, curriculum coverage, intervention priorities,
 * observation history, and recommended actions.
 */
export default function LearnerDetail() {
  const { learnerId } = useParams();
  const navigate = useNavigate();
  const { authedFetch } = useTeacher();

  const [status, setStatus] = useState(STATUS_LOADING);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);

  // Dashboard mirror of the WhatsApp "REMOVE LEARNER <name>" command
  // (DELETE /api/learners/:learnerId -> services/learnerRosterService.js
  // #removeLearner). Same confirm-then-delete pattern as ClassDetail.jsx.
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState(null);

  const load = useCallback(async () => {
    setStatus(STATUS_LOADING);
    setError(null);
    try {
      const res = await authedFetch(`/api/learners/${learnerId}/detail`);
      setDetail(res);
      setStatus(STATUS_READY);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setStatus(STATUS_ERROR);
    }
  }, [authedFetch, learnerId]);

  useEffect(() => {
    load();
  }, [load]);

  const learner = detail?.learner;
  const performance = detail?.performance;

  async function handleRemoveLearner() {
    setRemoving(true);
    setRemoveError(null);
    try {
      await authedFetch(`/api/learners/${learnerId}`, { method: 'DELETE' });
      navigate(learner?.classId ? `/classes/${learner.classId}` : '/classes');
    } catch (err) {
      setRemoveError(err instanceof ApiError ? err.message : 'Could not remove this learner. Please try again.');
      setConfirmRemove(false);
    } finally {
      setRemoving(false);
    }
  }

  const highMediumPlans = useMemo(
    () => (detail?.interventions?.plans || []).filter((p) => p.priority === 'high' || p.priority === 'medium'),
    [detail]
  );

  return (
    <Layout>
      <button
        onClick={() => (learner?.classId ? navigate(`/classes/${learner.classId}`) : navigate('/classes'))}
        style={styles.backButton}
      >
        ← Back to {learner?.className || 'Class'}
      </button>

      {status === STATUS_LOADING && <Spinner label="Loading learner…" />}

      {status === STATUS_ERROR && <ErrorBanner message={error} onRetry={load} />}

      {status === STATUS_READY && detail && (
        <>
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
              <div>
                <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 var(--space-2)' }}>
                  {learner?.name}
                </h1>
                <p style={{ color: 'var(--color-text-secondary)', margin: 0, fontSize: 'var(--text-base)' }}>
                  {learner?.className || 'No class set'}
                  {learner?.grade != null ? ` · Grade ${learner.grade}` : ''}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                {confirmRemove ? (
                  <>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                      Remove from roster?
                    </span>
                    <Button variant="danger" onClick={handleRemoveLearner} disabled={removing}>
                      {removing ? 'Removing…' : 'Confirm'}
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmRemove(false)} disabled={removing}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" onClick={() => setConfirmRemove(true)}>
                    Remove learner
                  </Button>
                )}
              </div>
            </div>
            {removeError && (
              <p style={{ color: 'var(--color-danger, #c0392b)', fontSize: 'var(--text-sm)', marginTop: 'var(--space-2)' }}>
                {removeError}
              </p>
            )}
          </div>

          {/* KPI cards */}
          <div style={styles.kpiGrid}>
            <Kpi
              icon="📊"
              tone="indigo"
              label="Overall average"
              value={performance?.overallAverage != null ? `${performance.overallAverage}%` : '—'}
            />
            <Kpi
              icon="✅"
              tone="mint"
              label="Pass rate"
              value={performance?.passRate != null ? `${performance.passRate}%` : '—'}
            />
            <Kpi
              icon="📈"
              tone="lavender"
              label="Trend"
              value={<Pill tone={TREND_TONE[performance?.trend]}>{TREND_LABEL[performance?.trend] || '—'}</Pill>}
            />
          </div>

          {/* Assessment history */}
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <SectionHeader title="Assessment history" />
            {detail.assessmentHistory.length === 0 ? (
              <EmptyState title="No assessments yet" description="Marks captured from WhatsApp will show up here." />
            ) : (
              <div style={styles.cardList}>
                {detail.assessmentHistory.map((a) => (
                  <Card key={a.resultId} style={styles.rowCard}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{a.title}</div>
                      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                        {a.subject}
                        {a.term ? ` · Term ${a.term}` : ''}
                      </div>
                    </div>
                    <Pill tone={a.percentage >= 50 ? 'success' : 'warning'}>{a.percentage}%</Pill>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Curriculum coverage */}
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <SectionHeader title="CAPS coverage" />
            {!detail.curriculumCoverage.dataAvailable ? (
              <EmptyState
                title="Coverage data will appear after your first blueprint assessment."
                description="Once a CAPS-aligned assessment is captured, subject coverage will show up here."
              />
            ) : (
              <div style={styles.cardList}>
                {detail.curriculumCoverage.bySubject.map((s) => (
                  <Card key={s.subject} style={styles.rowCard}>
                    <span style={{ fontWeight: 500 }}>{s.subject}</span>
                    {s.dataAvailable ? <Pill>{s.averagePercentage}% covered</Pill> : <Pill>No data yet</Pill>}
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Interventions */}
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <SectionHeader title="Intervention priorities" />
            {highMediumPlans.length === 0 ? (
              <EmptyState title="Nothing urgent right now" description="High and medium priority subjects will appear here." />
            ) : (
              <div style={styles.cardList}>
                {highMediumPlans.map((p) => (
                  <Card key={p.subject} style={styles.rowCard}>
                    <span style={{ fontWeight: 500 }}>{p.subject}</span>
                    <Pill tone={PRIORITY_TONE[p.priority]}>{PRIORITY_LABEL[p.priority]}</Pill>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Observations */}
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <SectionHeader title="Observations" />
            {detail.observations.totalSessions === 0 ? (
              <EmptyState
                title="No observations recorded yet"
                description="Complete your first classroom observation to start tracking this learner's progress over time."
              />
            ) : (
              <div style={styles.cardList}>
                {detail.observations.recent.map((o) => (
                  <Card
                    key={o.assessmentId}
                    onClick={() => navigate(`/observations/${o.assessmentId}`)}
                    style={styles.rowCard}
                  >
                    <div>
                      <div style={{ fontWeight: 600 }}>{o.title}</div>
                      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{o.createdAt}</div>
                    </div>
                    <Pill>View Session →</Pill>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Recommended actions */}
          <div>
            <SectionHeader title="Recommended actions" />
            {detail.recommendedActions.length === 0 ? (
              <EmptyState title="No recommendations yet" description="Recommendations appear once there's enough evidence." />
            ) : (
              <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--color-text-primary)' }}>
                {detail.recommendedActions.map((action, i) => (
                  <li key={i} style={{ marginBottom: 'var(--space-2)' }}>{action}</li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </Layout>
  );
}

function Kpi({ icon, tone, label, value }) {
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
  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 'var(--space-4)',
    marginBottom: 'var(--space-6)',
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
};
