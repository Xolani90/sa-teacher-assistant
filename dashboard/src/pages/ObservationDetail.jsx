import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTeacher } from '../auth/TeacherContext';
import { ApiError } from '../api/client';
import Layout from '../components/Layout';
import { Card, EmptyState, ErrorBanner, Spinner, SectionHeader, Pill, Button } from '../components/ui';

const STATUS_LOADING = 'loading';
const STATUS_READY = 'ready';
const STATUS_ERROR = 'error';

/**
 * Single observation session view, backed by the aggregated
 * GET /api/observations/:assessmentId payload
 * (services/observationDetailService.js). Header + correction lineage
 * + per-record evidence (domain, developmental status, notes, resolved
 * flag) — deliberately no "observer" or "overall rating" fields, since
 * those don't exist in the underlying observation schema (PR27 scope).
 */
export default function ObservationDetail() {
  const { assessmentId } = useParams();
  const navigate = useNavigate();
  const { authedFetch } = useTeacher();

  const [status, setStatus] = useState(STATUS_LOADING);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);

  // Dashboard mirror of the WhatsApp "RESOLVE" command
  // (PATCH /api/observations/records/:recordId ->
  // services/observationRepository.js#resolveObservationRecord). Tracks
  // in-flight/failed state per record id so multiple resolves can be
  // attempted independently without one's spinner blocking another's.
  const [resolvingId, setResolvingId] = useState(null);
  const [resolveError, setResolveError] = useState(null);

  const load = useCallback(
    async ({ cancelledRef } = {}) => {
      setStatus(STATUS_LOADING);
      setError(null);
      try {
        const res = await authedFetch(`/api/observations/${assessmentId}`);
        if (cancelledRef?.current) return;
        setDetail(res);
        setStatus(STATUS_READY);
      } catch (err) {
        if (cancelledRef?.current) return;
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
        setStatus(STATUS_ERROR);
      }
    },
    [authedFetch, assessmentId]
  );

  // Guard against a slow-resolving request for a previous assessmentId
  // overwriting the currently-viewed observation's state after rapid
  // navigation between two observation detail pages (same pattern as
  // ClassDetail.jsx / ObservationWorkspace.jsx).
  useEffect(() => {
    const cancelledRef = { current: false };
    load({ cancelledRef });
    return () => {
      cancelledRef.current = true;
    };
  }, [load]);

  const session = detail?.session;
  const lineage = detail?.correctionLineage;

  async function handleResolve(recordId) {
    setResolvingId(recordId);
    setResolveError(null);
    try {
      await authedFetch(`/api/observations/records/${recordId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved: true }),
      });
      setDetail((prev) => ({
        ...prev,
        records: prev.records.map((r) => (r.id === recordId ? { ...r, resolved: true } : r)),
      }));
    } catch (err) {
      setResolveError(err instanceof ApiError ? err.message : 'Could not resolve this record. Please try again.');
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <Layout>
      <button onClick={() => navigate(-1)} style={styles.backButton}>
        ← Back
      </button>

      {status === STATUS_LOADING && <Spinner label="Loading observation…" />}

      {status === STATUS_ERROR && <ErrorBanner message={error} onRetry={load} />}

      {status === STATUS_READY && detail && (
        <>
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 var(--space-2)' }}>
              {session.assessmentName || 'Observation session'}
            </h1>
            <p style={{ color: 'var(--color-text-secondary)', margin: 0, fontSize: 'var(--text-base)' }}>
              {session.subject || 'No subject set'}
              {session.grade ? ` · Grade ${session.grade}` : ''} · {session.createdAt}
            </p>
            <p style={{ color: 'var(--color-text-secondary)', margin: '0.3rem 0 0', fontSize: 'var(--text-sm)' }}>
              {session.recordCount} {session.recordCount === 1 ? 'record' : 'records'} ·{' '}
              {session.learnerCount} {session.learnerCount === 1 ? 'learner' : 'learners'}
            </p>
          </div>

          {/* Correction lineage */}
          <Card style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-6)' }}>
            {lineage.isCurrent ? (
              <Pill tone="success">✓ Current Version</Pill>
            ) : (
              <div>
                <Pill tone="warning">Superseded by correction</Pill>
                {lineage.supersededByCreatedAt && (
                  <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                    Corrected on {lineage.supersededByCreatedAt}.{' '}
                    <button
                      onClick={() => navigate(`/observations/${lineage.supersededByAssessmentId}`)}
                      style={styles.linkButton}
                    >
                      View corrected version →
                    </button>
                  </p>
                )}
              </div>
            )}
            {lineage.correctsAssessmentId && (
              <p style={{ margin: 'var(--space-3) 0 0', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                Corrects observation from {lineage.correctsCreatedAt || 'an earlier session'}.{' '}
                <button
                  onClick={() => navigate(`/observations/${lineage.correctsAssessmentId}`)}
                  style={styles.linkButton}
                >
                  View original →
                </button>
              </p>
            )}
          </Card>

          {/* Records */}
          <div>
            <SectionHeader title="Records" />
            {resolveError && (
              <p style={{ color: 'var(--color-danger, #c0392b)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-3)' }}>
                {resolveError}
              </p>
            )}
            {detail.records.length === 0 ? (
              <EmptyState title="No records" description="This session has no observation records." />
            ) : (
              <div style={styles.cardList}>
                {detail.records.map((r) => (
                  <Card key={r.id} style={{ padding: 'var(--space-5)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: 'var(--space-1)' }}>{r.learnerName}</div>
                        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                          {r.domain && <Pill>{r.domain}</Pill>}
                          {r.developmentalStatus && <Pill tone="accent">{r.developmentalStatus}</Pill>}
                          {r.resolved ? <Pill tone="success">Resolved</Pill> : <Pill tone="warning">Follow-up required</Pill>}
                        </div>
                      </div>
                      {!r.resolved && (
                        <Button variant="ghost" onClick={() => handleResolve(r.id)} disabled={resolvingId === r.id}>
                          {resolvingId === r.id ? 'Resolving…' : 'Mark resolved'}
                        </Button>
                      )}
                    </div>
                    {r.notes && (
                      <p style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                        {r.notes}
                      </p>
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
  linkButton: {
    background: 'none',
    border: 'none',
    color: 'var(--color-accent)',
    cursor: 'pointer',
    fontSize: 'inherit',
    padding: 0,
    fontWeight: 500,
    textDecoration: 'underline',
  },
  cardList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
  },
};
