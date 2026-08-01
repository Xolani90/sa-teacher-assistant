// dashboard/src/pages/QMS.jsx
import { useCallback, useEffect, useState } from 'react';
import { useTeacher } from '../auth/TeacherContext';
import { ApiError } from '../api/client';
import Layout from '../components/Layout';
import { Card, ErrorBanner, Spinner, SectionHeader, Pill } from '../components/ui';
import QMSSummaryBanner from '../components/qms/QMSSummaryBanner';
import QMSCategoryCard from '../components/qms/QMSCategoryCard';
import ReflectionPanel from '../components/qms/ReflectionPanel';

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
 * QMS Readiness dashboard page — the QMS Action Centre (ADR-012).
 *
 * Composes two existing, already-tested backend endpoints:
 *   - GET /api/tse/status (services/tseEvidenceService.getStatusSnapshot)
 *   - GET /api/reflections (services/reflectionService.listReflections)
 *
 * Per ADR-012, this page remains a single orchestration page. Each
 * evidence category is a QMSCategoryCard that expands inline to show
 * static, rule-based recommendations and CTAs (config/qmsRecommendations.js)
 * — no new backend routes, services, or schema changes in this phase.
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
  const categories = Object.keys(CATEGORY_LABELS);

  return (
    <Layout>
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
          QMS Readiness
        </h1>
        <p style={{ color: 'var(--color-text-secondary)', margin: '0.3rem 0 0' }}>
          A snapshot of the evidence you've already built up this term — expand
          any category below to see what to do next.
        </p>
      </div>

      <QMSSummaryBanner strength={strength} />

      <Card style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-6)' }}>
        <SectionHeader title="Evidence by Category" subtitle="This term — tap a card for recommended next steps" />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 'var(--space-4)',
          }}
        >
          {categories.map((cat) => (
            <QMSCategoryCard
              key={cat}
              categoryKey={cat}
              label={CATEGORY_LABELS[cat]}
              count={counts[cat]}
              isMissing={missingCategories.includes(cat)}
            />
          ))}
        </div>
      </Card>

      {gaps.length > 0 && <GapsSection gaps={gaps} />}

      <ReflectionPanel reflections={reflections} onChange={load} />
    </Layout>
  );
}

// ── Growth gaps ──────────────────────────────────────────────────────────
// Small, single-use, no reusable behaviour — kept inline per ADR-012's
// component plan rather than extracted to its own file.
function GapsSection({ gaps }) {
  return (
    <Card style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-6)' }}>
      <SectionHeader title="Things Worth Following Up" subtitle="Detected from your existing records" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {gaps.map((gap, i) => (
          <div
            key={(gap.type || 'gap') + i}
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
