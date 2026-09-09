// dashboard/src/pages/QMS.jsx
import { useCallback, useEffect, useState } from 'react';
import { useTeacher } from '../auth/TeacherContext';
import { ApiError } from '../api/client';
import Layout from '../components/Layout';
import { Card, ErrorBanner, Spinner, SectionHeader, Pill } from '../components/ui';
import QMSSummaryBanner from '../components/qms/QMSSummaryBanner';
import QMSCategoryCard from '../components/qms/QMSCategoryCard';
import CoachingInsightsPanel from '../components/qms/CoachingInsightsPanel';

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
 * QMS & Readiness dashboard page — the QMS Action Centre (ADR-012).
 *
 * Composes two backend endpoints:
 *   - GET /api/tse/status (services/tseEvidenceService.getStatusSnapshot)
 *   - GET /api/coaching/insights (services/coachingEngineService.getCoachingInsights)
 *
 * Per ADR-012, the primary evidence-by-category layout remains a single
 * orchestration page. Each evidence category is a QMSCategoryCard that
 * expands inline to show static, rule-based recommendations and CTAs
 * (config/qmsRecommendations.js) — no schema changes in this phase.
 *
 * The Coaching Insights section (CoachingInsightsPanel) is PR40's
 * dashboard surface for ADR-016's trend-aware coaching engine (PR38/PR39
 * already compute confidence trends and trend-based recommendations for
 * WhatsApp via ADR-018's coachingMessageRenderer) — it fetches
 * independently and degrades quietly if that call fails, exactly like
 * the dashboard's weekly-pulse card, so it never blocks or errors the
 * rest of this page.
 *
 * Dashboard IA v1: Reflections and Growth Plans now have their own direct
 * sidebar destination (see ReflectionsGoals.jsx at /reflections) and are no
 * longer rendered here — this page no longer fetches /api/reflections or
 * /api/growth-plans. QMS evidence/gaps/recommendations behaviour is
 * unchanged.
 */
export default function QMS() {
  const { authedFetch } = useTeacher();

  const [status, setStatus] = useState(STATUS_LOADING);
  const [error, setError] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  // Coaching insights are fetched and rendered independently of the
  // primary tse/status snapshot above — a failure here never blocks or
  // errors the rest of the page (same "fails independently and quietly"
  // pattern used for the dashboard's weekly-pulse card). null means
  // "not loaded yet or failed to load", in which case the panel simply
  // isn't rendered rather than showing a misleading empty/error state.
  const [coachingInsights, setCoachingInsights] = useState(null);

  const load = useCallback(async () => {
    setStatus(STATUS_LOADING);
    setError(null);
    try {
      const snapshotData = await authedFetch('/api/tse/status');
      setSnapshot(snapshotData);
      setStatus(STATUS_READY);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong loading QMS readiness.');
      setStatus(STATUS_ERROR);
    }
  }, [authedFetch]);

  const loadCoachingInsights = useCallback(async () => {
    try {
      const data = await authedFetch('/api/coaching/insights');
      setCoachingInsights(data);
    } catch (err) {
      // Deliberately silent — see the state comment above.
      console.error('Failed to load coaching insights:', err);
    }
  }, [authedFetch]);

  useEffect(() => {
    load();
    loadCoachingInsights();
  }, [load, loadCoachingInsights]);

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
          QMS &amp; Readiness
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

      {coachingInsights && <CoachingInsightsPanel insights={coachingInsights} />}
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
