import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTeacher } from '../auth/TeacherContext';
import { ApiError } from '../api/client';
import Layout from '../components/Layout';
import { Card, ErrorBanner, Spinner, SectionHeader, Pill } from '../components/ui';

const STATUS_LOADING = 'loading';
const STATUS_READY = 'ready';
const STATUS_ERROR = 'error';

const BLUEPRINT_STATUS_TONE = {
  draft: 'neutral',
  published: 'accent',
  archived: 'neutral',
};

/**
 * Single assessment blueprint view, backed by GET /api/blueprints/:id
 * (routes/api.js -> services/blueprintRepository.js's getBlueprintById —
 * the exact row + questions flows/blueprintAuthoringFlow.js's WhatsApp
 * flow wrote). No regeneration and no re-weighting happens here:
 * question topics/marks below are rendered verbatim from what the API
 * returns.
 *
 * The per-topic weighting percentage shown in the table is a plain
 * display-time derivation of the persisted totalMarks/max_marks values
 * already stored on this exact blueprint — it does not call a second
 * weighting engine and cannot diverge from what the WhatsApp weighting
 * flow computed, since it sums the same marks that flow itself wrote.
 */
export default function BlueprintDetail() {
  const { blueprintId } = useParams();
  const navigate = useNavigate();
  const { authedFetch } = useTeacher();

  const [status, setStatus] = useState(STATUS_LOADING);
  const [blueprint, setBlueprint] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(
    async ({ cancelledRef } = {}) => {
      setStatus(STATUS_LOADING);
      setError(null);
      try {
        const res = await authedFetch(`/api/blueprints/${blueprintId}`);
        if (cancelledRef?.current) return;
        setBlueprint(res?.blueprint || null);
        setStatus(STATUS_READY);
      } catch (err) {
        if (cancelledRef?.current) return;
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
        setStatus(STATUS_ERROR);
      }
    },
    [authedFetch, blueprintId]
  );

  // Guard against a slow-resolving request for a previous blueprintId
  // overwriting the currently-viewed blueprint's state after rapid
  // navigation between two blueprint detail pages (same pattern as
  // ClassDetail.jsx / LearnerDetail.jsx, Cycle 14).
  useEffect(() => {
    const cancelledRef = { current: false };
    load({ cancelledRef });
    return () => {
      cancelledRef.current = true;
    };
  }, [load]);

  const topicRows = blueprint ? buildTopicWeighting(blueprint) : [];

  return (
    <Layout>
      <button onClick={() => navigate('/blueprints')} style={styles.backButton}>
        ← Back to Blueprints
      </button>

      {status === STATUS_LOADING && <Spinner label="Loading blueprint…" />}

      {status === STATUS_ERROR && <ErrorBanner message={error} onRetry={load} />}

      {status === STATUS_READY && blueprint && (
        <>
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
              <Pill tone={BLUEPRINT_STATUS_TONE[blueprint.status] || 'neutral'}>{blueprint.status}</Pill>
              {blueprint.grade != null && <Pill>Grade {blueprint.grade}</Pill>}
              {blueprint.subject && <Pill>{blueprint.subject}</Pill>}
              {blueprint.term != null && <Pill tone="neutral">Term {blueprint.term}</Pill>}
              <Pill tone="neutral">v{blueprint.version}</Pill>
            </div>
            <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 var(--space-2)' }}>
              {blueprint.title || 'Untitled blueprint'}
            </h1>
            <p style={{ color: 'var(--color-text-secondary)', margin: 0, fontSize: 'var(--text-sm)' }}>
              Total {blueprint.totalMarks} marks · Last updated {formatDateTime(blueprint.updatedAt)}
            </p>
          </div>

          {/* Weighting allocation — the canonical persisted result, not
              recalculated here. Rendered as topic / marks / % of total. */}
          <Card style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-6)' }}>
            <SectionHeader title="Weighting Allocation" />
            {topicRows.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
                No questions recorded on this blueprint.
              </p>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Topic</th>
                    <th style={styles.thRight}>Marks</th>
                    <th style={styles.thRight}>Weighting</th>
                  </tr>
                </thead>
                <tbody>
                  {topicRows.map((row) => (
                    <tr key={row.topic}>
                      <td style={styles.td}>{row.topic}</td>
                      <td style={styles.tdRight}>{row.marks}</td>
                      <td style={styles.tdRight}>{row.percent}%</td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ ...styles.td, fontWeight: 700, borderTop: '1px solid var(--color-border-strong)' }}>Total</td>
                    <td style={{ ...styles.tdRight, fontWeight: 700, borderTop: '1px solid var(--color-border-strong)' }}>
                      {blueprint.totalMarks}
                    </td>
                    <td style={{ ...styles.tdRight, fontWeight: 700, borderTop: '1px solid var(--color-border-strong)' }}>100%</td>
                  </tr>
                </tbody>
              </table>
            )}
          </Card>

          {/* Full question list — verbatim, same rows persisted by the
              WhatsApp blueprint-authoring flow. */}
          <Card style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-6)' }}>
            <SectionHeader title="Questions" />
            {blueprint.questions && blueprint.questions.length > 0 ? (
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>#</th>
                    <th style={styles.th}>Topic</th>
                    <th style={styles.th}>Subtopic</th>
                    <th style={styles.th}>Bloom Level</th>
                    <th style={styles.thRight}>Max Marks</th>
                  </tr>
                </thead>
                <tbody>
                  {blueprint.questions.map((q) => (
                    <tr key={q.id}>
                      <td style={styles.td}>{q.questionNumber}</td>
                      <td style={styles.td}>{q.topic}</td>
                      <td style={styles.td}>{q.subtopic || '—'}</td>
                      <td style={styles.td}>{q.bloomLevel || '—'}</td>
                      <td style={styles.tdRight}>{q.maxMarks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
                No questions recorded on this blueprint.
              </p>
            )}
          </Card>
        </>
      )}
    </Layout>
  );
}

// Groups the blueprint's already-persisted questions by topic and sums
// their already-persisted max_marks — a plain display aggregation of
// data that exists, not a second weighting calculation. Percentage is
// against blueprint.totalMarks (the persisted header value), rounded to
// one decimal for display only.
function buildTopicWeighting(blueprint) {
  const questions = blueprint.questions || [];
  const totalMarks = blueprint.totalMarks || 0;
  const marksByTopic = new Map();

  for (const q of questions) {
    const topic = q.topic || 'Untitled topic';
    marksByTopic.set(topic, (marksByTopic.get(topic) || 0) + (q.maxMarks || 0));
  }

  return Array.from(marksByTopic.entries()).map(([topic, marks]) => ({
    topic,
    marks,
    percent: totalMarks > 0 ? Math.round((marks / totalMarks) * 1000) / 10 : 0,
  }));
}

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T'));
  return d.toLocaleString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
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
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 'var(--text-sm)',
  },
  th: {
    textAlign: 'left',
    padding: 'var(--space-2) var(--space-3)',
    color: 'var(--color-text-secondary)',
    fontWeight: 600,
    borderBottom: '1px solid var(--color-border-strong)',
  },
  thRight: {
    textAlign: 'right',
    padding: 'var(--space-2) var(--space-3)',
    color: 'var(--color-text-secondary)',
    fontWeight: 600,
    borderBottom: '1px solid var(--color-border-strong)',
  },
  td: {
    padding: 'var(--space-2) var(--space-3)',
    color: 'var(--color-text-primary)',
  },
  tdRight: {
    padding: 'var(--space-2) var(--space-3)',
    color: 'var(--color-text-primary)',
    textAlign: 'right',
  },
};
