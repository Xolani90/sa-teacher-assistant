// dashboard/src/pages/AssessmentDetail.jsx
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTeacher } from '../auth/TeacherContext';
import { ApiError } from '../api/client';
import Layout from '../components/Layout';
import {
  Card,
  Button,
  Stat,
  EmptyState,
  ErrorBanner,
  Spinner,
  SectionHeader,
  Pill,
} from '../components/ui';

const STATUS_LOADING = 'loading';
const STATUS_READY = 'ready';
const STATUS_ERROR = 'error';

/**
 * Single assessment view, backed by the aggregated
 * GET /api/assessments/:assessmentId/detail payload
 * (services/assessmentDetailService.js). Header + KPI summary + learner
 * results + blueprint topic analytics (class-level and per-learner) when
 * blueprint-backed. Free-form assessments still render the learner table;
 * the topic-analytics sections are simply omitted when
 * analytics.available is false, matching the same "no data yet"
 * convention as ClassDetail's coverage/intervention sections rather than
 * treating it as an error.
 */
export default function AssessmentDetail() {
  const { assessmentId } = useParams();
  const navigate = useNavigate();
  const { authedFetch } = useTeacher();

  const [status, setStatus] = useState(STATUS_LOADING);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState(null);
  const [expandedLearner, setExpandedLearner] = useState(null);

  const load = useCallback(async () => {
    setStatus(STATUS_LOADING);
    setError(null);
    try {
      const data = await authedFetch(`/api/assessments/${assessmentId}/detail`);
      setDetail(data);
      setStatus(STATUS_READY);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong loading this assessment.');
      setStatus(STATUS_ERROR);
    }
  }, [authedFetch, assessmentId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDownloadPdf = async () => {
    setPdfLoading(true);
    setPdfError(null);
    try {
      const { url } = await authedFetch(`/api/assessments/${assessmentId}/pdf`);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setPdfError(err instanceof ApiError ? err.message : 'Could not generate the PDF right now.');
    } finally {
      setPdfLoading(false);
    }
  };

  if (status === STATUS_LOADING) {
    return (
      <Layout>
        <Spinner label="Loading assessment…" />
      </Layout>
    );
  }

  if (status === STATUS_ERROR) {
    return (
      <Layout>
        <ErrorBanner message={error} onRetry={load} />
      </Layout>
    );
  }

  const { assessment, class: classInfo, summary, learners, analytics, savedReports } = detail;

  return (
    <Layout>
      <Header
        assessment={assessment}
        classInfo={classInfo}
        onBack={() => navigate(-1)}
        onDownloadPdf={handleDownloadPdf}
        pdfLoading={pdfLoading}
      />

      {pdfError && (
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <ErrorBanner message={pdfError} onRetry={handleDownloadPdf} />
        </div>
      )}

      <KpiRow summary={summary} analytics={analytics} />

      <LearnerResultsTable learners={learners} />

      <SavedReportsList reports={savedReports} />

      {analytics.available && (
        <>
          <TopicAnalytics topics={analytics.topics} />
          <LearnerTopicBreakdown
            perLearnerTopics={analytics.perLearnerTopics}
            expandedLearner={expandedLearner}
            onToggle={setExpandedLearner}
          />
        </>
      )}
    </Layout>
  );
}

// ── Header ───────────────────────────────────────────────────────────────
function Header({ assessment, classInfo, onBack, onDownloadPdf, pdfLoading }) {
  return (
    <div style={{ marginBottom: 'var(--space-6)' }}>
      <button
        onClick={onBack}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--color-text-secondary)',
          fontSize: 'var(--text-sm)',
          padding: 0,
          marginBottom: 'var(--space-2)',
        }}
      >
        ← Back
      </button>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
            {assessment.title}
          </h1>
          <p style={{ color: 'var(--color-text-secondary)', margin: '0.3rem 0 0' }}>
            {classInfo?.name || 'Unassigned class'} · {formatDate(assessment.createdAt)}
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            <Pill tone="neutral">{capitalize(assessment.assessmentType)}</Pill>
            {assessment.isBlueprintBacked && <Pill tone="accent">Blueprint Assessment</Pill>}
          </div>
        </div>
        <Button variant="primary" onClick={onDownloadPdf} disabled={pdfLoading}>
          {pdfLoading ? 'Generating…' : 'Download PDF'}
        </Button>
      </div>
    </div>
  );
}

// ── KPI cards ────────────────────────────────────────────────────────────
function KpiRow({ summary, analytics }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 'var(--space-4)',
        marginBottom: 'var(--space-6)',
      }}
    >
      <Stat label="Class Average" value={`${round(summary.classAverage)}%`} />
      <Stat label="Pass Rate" value={`${round(summary.passRate)}%`} />
      <Stat label="Learners" value={summary.learnerCount} />
      <Stat label="Topics" value={analytics.available ? analytics.topics.length : '—'} />
    </div>
  );
}

// ── Learner results table ───────────────────────────────────────────────
function LearnerResultsTable({ learners }) {
  return (
    <Card style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-6)' }}>
      <SectionHeader title="Learner Results" />
      {learners.length === 0 ? (
        <EmptyState
          title="No results yet"
          description="No learner results recorded for this assessment yet."
        />
      ) : (
        <table style={{ width: '100%', fontSize: 'var(--text-sm)', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>
              <th style={{ padding: '0.5rem 1rem 0.5rem 0' }}>Learner</th>
              <th style={{ padding: '0.5rem 1rem 0.5rem 0' }}>Mark</th>
              <th style={{ padding: '0.5rem 1rem 0.5rem 0' }}>%</th>
              <th style={{ padding: '0.5rem 1rem 0.5rem 0' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {learners.map((l) => (
              <tr key={l.resultId} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: '0.5rem 1rem 0.5rem 0', fontWeight: 600 }}>{l.learnerName}</td>
                <td style={{ padding: '0.5rem 1rem 0.5rem 0', color: 'var(--color-text-secondary)' }}>
                  {l.mark}/{l.totalMarks}
                </td>
                <td style={{ padding: '0.5rem 1rem 0.5rem 0', color: 'var(--color-text-secondary)' }}>
                  {round(l.percentage)}%
                </td>
                <td style={{ padding: '0.5rem 1rem 0.5rem 0' }}>
                  <PercentagePill percentage={l.percentage} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ── Saved reports (diagnostic / HOD / parent) ───────────────────────────
const REPORT_TYPE_LABELS = {
  diagnostic: 'Diagnostic Report',
  hod: 'HOD Report',
  parent: 'Parent Report',
};

function SavedReportsList({ reports }) {
  const list = reports || [];
  const [expandedId, setExpandedId] = useState(null);

  return (
    <Card style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-6)' }}>
      <SectionHeader title="Saved Reports" />
      {list.length === 0 ? (
        <EmptyState
          title="No saved reports yet"
          description="Diagnostic, HOD, and parent reports generated for this assessment on WhatsApp will appear here."
        />
      ) : (
        <div>
          {list.map((r) => {
            const isOpen = expandedId === r.id;
            const label = REPORT_TYPE_LABELS[r.reportType] || capitalize(r.reportType);
            return (
              <div key={r.id} style={{ padding: 'var(--space-3) 0', borderBottom: '1px solid var(--color-border)' }}>
                <button
                  onClick={() => setExpandedId(isOpen ? null : r.id)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    textAlign: 'left',
                    font: 'inherit',
                    color: 'inherit',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <Pill tone="neutral">{label}</Pill>
                    {r.learnerName && (
                      <span style={{ fontWeight: 600 }}>{r.learnerName}</span>
                    )}
                    <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
                      {formatDate(r.createdAt)}
                    </span>
                  </span>
                  <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
                    {isOpen ? '▲' : '▼'}
                  </span>
                </button>
                {isOpen && (
                  <pre
                    style={{
                      marginTop: 'var(--space-3)',
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'inherit',
                      fontSize: 'var(--text-sm)',
                      background: 'var(--color-bg)',
                      borderRadius: 'var(--radius-md)',
                      padding: 'var(--space-4)',
                    }}
                  >
                    {r.content}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ── Topic analytics (class-level) ───────────────────────────────────────
function TopicAnalytics({ topics }) {
  return (
    <Card style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-6)' }}>
      <SectionHeader title="Topic Analytics" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {topics.map((t) => (
          <div key={t.topic}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)', marginBottom: '0.25rem' }}>
              <span style={{ fontWeight: 600 }}>{t.topic}</span>
              <span style={{ color: 'var(--color-text-secondary)' }}>{round(t.classAveragePercentage)}%</span>
            </div>
            <BarTrack percentage={t.classAveragePercentage} />
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Learner topic breakdown (expandable) ────────────────────────────────
function LearnerTopicBreakdown({ perLearnerTopics, expandedLearner, onToggle }) {
  return (
    <Card style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-6)' }}>
      <SectionHeader title="Learner Topic Breakdown" />
      <div>
        {perLearnerTopics.map((l) => {
          const isOpen = expandedLearner === l.learnerName;
          return (
            <div key={l.learnerName} style={{ padding: 'var(--space-3) 0', borderBottom: '1px solid var(--color-border)' }}>
              <button
                onClick={() => onToggle(isOpen ? null : l.learnerName)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  textAlign: 'left',
                  font: 'inherit',
                  color: 'inherit',
                }}
              >
                <span style={{ fontWeight: 600 }}>{l.learnerName}</span>
                <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
                  {isOpen ? '▲' : '▼'} Topic Breakdown
                </span>
              </button>
              {isOpen && (
                <div style={{ marginTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', paddingLeft: 'var(--space-2)' }}>
                  {l.topics.map((t) => (
                    <div key={t.topic}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)', marginBottom: '0.25rem' }}>
                        <span style={{ color: 'var(--color-text-secondary)' }}>{t.topic}</span>
                        <span style={{ color: 'var(--color-text-secondary)' }}>{round(t.percentage)}%</span>
                      </div>
                      <BarTrack percentage={t.percentage} thin />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────
function BarTrack({ percentage, thin = false }) {
  const height = thin ? 6 : 10;
  return (
    <div style={{ width: '100%', height, borderRadius: 'var(--radius-full)', background: 'var(--color-bg)', overflow: 'hidden' }}>
      <div
        style={{
          height,
          borderRadius: 'var(--radius-full)',
          width: `${Math.max(0, Math.min(100, percentage))}%`,
          background: barColor(percentage),
          transition: 'width var(--duration-base) var(--ease-standard)',
        }}
      />
    </div>
  );
}

function PercentagePill({ percentage }) {
  if (percentage >= 75) return <Pill tone="success">Strong</Pill>;
  if (percentage >= 50) return <Pill tone="warning">Developing</Pill>;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '0.2rem 0.6rem',
        borderRadius: 'var(--radius-full)',
        fontSize: 'var(--text-xs)',
        fontWeight: 600,
        background: 'var(--color-danger-soft)',
        color: 'var(--color-danger)',
      }}
    >
      At Risk
    </span>
  );
}

function barColor(percentage) {
  if (percentage >= 75) return 'var(--color-success)';
  if (percentage >= 50) return 'var(--color-warning)';
  return 'var(--color-danger)';
}

function round(n) {
  return Math.round(n * 10) / 10;
}

function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T'));
  return d.toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric' });
}
