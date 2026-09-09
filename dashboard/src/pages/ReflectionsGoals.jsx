// dashboard/src/pages/ReflectionsGoals.jsx
import { useCallback, useEffect, useState } from 'react';
import { useTeacher } from '../auth/TeacherContext';
import { ApiError } from '../api/client';
import Layout from '../components/Layout';
import { ErrorBanner, Spinner } from '../components/ui';
import ReflectionPanel from '../components/qms/ReflectionPanel';
import GrowthPlanPanel from '../components/qms/GrowthPlanPanel';

const STATUS_LOADING = 'loading';
const STATUS_READY = 'ready';
const STATUS_ERROR = 'error';

/**
 * Reflections & Goals dashboard page (Dashboard IA v1, Phase B).
 *
 * Gives Reflections and Growth Plans a direct sidebar destination —
 * previously they were only discoverable by opening QMS and scrolling
 * down. Reuses ReflectionPanel/GrowthPlanPanel UNCHANGED: their
 * create/edit/delete/status/goal-management behaviour and their existing
 * write routes (POST/PATCH/DELETE /api/reflections, /api/growth-plans)
 * are not touched. This page only fetches and renders the existing
 * reflection/growth-plan data using the existing read routes:
 *   - GET /api/reflections (services/reflectionService.listReflections)
 *   - GET /api/growth-plans (services/growthPlanService.listGrowthPlans)
 *
 * QMS.jsx no longer renders these panels — see its own doc comment.
 * The same underlying data may still contribute to QMS evidence where
 * the existing tseEvidenceService implementation already does so.
 */
export default function ReflectionsGoals() {
  const { authedFetch } = useTeacher();

  const [status, setStatus] = useState(STATUS_LOADING);
  const [error, setError] = useState(null);
  const [reflections, setReflections] = useState([]);
  const [growthPlans, setGrowthPlans] = useState([]);

  const load = useCallback(async () => {
    setStatus(STATUS_LOADING);
    setError(null);
    try {
      const [reflectionsData, growthPlansData] = await Promise.all([
        authedFetch('/api/reflections'),
        authedFetch('/api/growth-plans'),
      ]);
      setReflections(reflectionsData.reflections || []);
      setGrowthPlans(growthPlansData.growthPlans || []);
      setStatus(STATUS_READY);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong loading reflections and goals.');
      setStatus(STATUS_ERROR);
    }
  }, [authedFetch]);

  useEffect(() => {
    load();
  }, [load]);

  if (status === STATUS_LOADING) {
    return (
      <Layout>
        <Spinner label="Loading reflections and goals…" />
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

  return (
    <Layout>
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
          Reflections &amp; Goals
        </h1>
        <p style={{ color: 'var(--color-text-secondary)', margin: '0.3rem 0 0' }}>
          Your logged reflections and growth plan goals — add, edit, or track progress here.
        </p>
      </div>

      <ReflectionPanel reflections={reflections} onChange={load} />

      <GrowthPlanPanel growthPlans={growthPlans} onChange={load} />
    </Layout>
  );
}
