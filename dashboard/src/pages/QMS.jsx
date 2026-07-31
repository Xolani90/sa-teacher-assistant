// dashboard/src/pages/QMS.jsx
import { useCallback, useEffect, useState } from 'react';
import { useTeacher } from '../auth/TeacherContext';
import { ApiError } from '../api/client';
import Layout from '../components/Layout';
import {
  Card,
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

const CATEGORY_LABELS = {
  curriculum: 'Curriculum Coverage',
  assessment: 'Assessment',
  intervention: 'Learner Support',
  observation: 'Observation',
  resource: 'Resources',
};

/**
 * QMS Readiness dashboard page. Composes two existing, already-tested
 * backend endpoints:
 *   - GET /api/tse/status (services/tseEvidenceService.getStatusSnapshot):
 *     evidence category counts, missing categories, rule-based gaps,
 *     and an optional strength message.
 *   - GET /api/reflections (services/reflectionService.listReflections):
 *     professional reflections logged via the WhatsApp reflection flow.
 *
 * This page performs no computation of its own — it purely renders what
 * these two already-tested services produce, matching the "services
 * consume contracts, dashboard renders them verbatim" convention used
 * throughout this codebase (see AssessmentDetail.jsx, ClassDetail.jsx).
 */
export default function QMS() {
  const { authedFetch } = useTeacher();

  const [status, setStatus] = useState(STATUS_LOADING);
  const [error, setError] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [reflections, setReflections] = useState([]);

  const load = useCallback(async () => {
    setStatus(STATUS_LOADING);
    setError(null);
    try {
      const [snapshotData, reflectionsData] = await Promise.all([
        authedFetch('/api/tse/status'),
        authedFetch('/api/reflections'),
      ]);
      setSnapshot(snapshotData);
      setReflections(reflectionsData.reflections || []);
      setStatus(STATUS_READY);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong loading QMS readiness.');
      setStatus(STATUS_ERROR);
    }
  }, [authedFetch]);

  useEffect(() => {
    load();
  }, [load]);

  if (status === STATUS_LOADING) {
    return (
      <Layout>
        <Spinner label="Loading QMS readiness…" />
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

  const { counts, missingCategories, gaps, strength } = snapshot;

  return (
    <Layout>
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
          QMS Readiness
        </h1>
        <p style={{ color: 'var(--color-text-secondary)', margin: '0.3rem 0 0' }}>
          A snapshot of the evidence you've already built up this term, drawn
          from your assessments, curriculum coverage, learner support plans,
          observations, and reflections.
        </p>
      </div>

      {strength && (
        <Card
          style={{
            padding: 'var(--space-5)',
            marginBottom: 'var(--space-6)',
            background: 'var(--color-success-soft)',
            border: '1px solid rgba(0,0,0,0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <Pill tone="success">On track</Pill>
            <p style={{ margin: 0, color: 'var(--color-text-primary)' }}>{strength}</p>
          </div>
        </Card>
      )}

      <EvidenceGrid counts={counts} missingCategories={missingCategories} />

      {gaps.length > 0 && <GapsSection gaps={gaps} />}

      <ReflectionsSection reflections={reflections} />
    </Layout>
  );
}

// ── Evidence category grid ──────────────────────────────────────────────
function EvidenceGrid({ counts, missingCategories }) {
  const categories = Object.keys(CATEGORY_LABELS);

  return (
    <Card style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-6)' }}>
      <SectionHeader title="Evidence by Category" subtitle="This term" />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 'var(--space-4)',
        }}
      >
        {categories.map((cat) => {
          const isMissing = missingCategories.includes(cat);
          return (
            <div
              key={cat}
              style={{
                padding: 'var(--space-4)',
                borderRadius: 'var(--radius-md)',
                border: isMissing ? '1px dashed var(--color-border-strong)' : '1px solid var(--color-border)',
                background: isMissing ? 'var(--color-bg)' : 'var(--color-surface)',
              }}
            >
              <div
                style={{
                  fontSize: 'var(--text-2xl)',
                  fontWeight: 700,
                  color: isMissing ? 'var(--color-text-secondary)' : 'var(--color-text-primary)',
                  lineHeight: 1.1,
                }}
              >
                {counts[cat]}
              </div>
              <div style={{ marginTop: '0.2rem', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                {CATEGORY_LABELS[cat]}
              </div>
              {isMissing && (
                <div style={{ marginTop: 'var(--space-2)' }}>
                  <Pill tone="neutral">No evidence yet</Pill>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Growth gaps ──────────────────────────────────────────────────────────
function GapsSection({ gaps }) {
  return (
    <Card style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-6)' }}>
      <SectionHeader title="Things Worth Following Up" subtitle="Detected from your existing records" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {gaps.map((gap, i) => (
          <div
            key={gap.type + i}
            style={{
              padding: 'var(--space-4)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-warning-soft)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 'var(--space-3)',
            }}
          >
            <Pill tone="warning">{gap.count}</Pill>
            <p style={{ margin: 0, color: 'var(--color-text-primary)', fontSize: 'var(--text-sm)' }}>
              {gap.message}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Reflections ──────────────────────────────────────────────────────────
function ReflectionsSection({ reflections }) {
  return (
    <Card style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-6)' }}>
      <SectionHeader title="Recent Reflections" subtitle="Logged via WhatsApp" />
      {reflections.length === 0 ? (
        <EmptyState
          title="No reflections yet"
          description='Log one anytime by messaging your assistant on WhatsApp — just say "reflect" to get started.'
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {reflections.map((r) => (
            <div key={r.id} style={{ paddingBottom: 'var(--space-4)', borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                <Pill tone="neutral">{r.term ? `Term ${r.term}` : 'Unscoped'}</Pill>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                  {formatDate(r.createdAt)}
                </span>
              </div>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
                {r.content}
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T'));
  return d.toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric' });
}
