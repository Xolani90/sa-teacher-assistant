// dashboard/src/components/ClassSnapshotSection.jsx
import { Card, EmptyState, Pill, SectionHeader, Spinner } from './ui';

/**
 * Renders the GET /api/classes/:classId/snapshot payload
 * (services/classSnapshotService.js, ADR-014) as three sub-cards:
 * Analytics, Intervention, QMS. Each section is independently
 * fault-isolated by the backend (§3.2), so this component renders each
 * section's own `status` ("ok" | "error" | "unavailable") rather than
 * assuming the whole snapshot succeeded or failed together — a failed
 * analytics section never hides a working intervention section.
 *
 * Deliberately separate from ClassDetail's existing "Intervention
 * priorities" list (backed by GET /api/classes/:classId/detail's
 * `interventions` field) — that block stays as-is; this section is the
 * new ADR-014 snapshot, shown alongside it.
 */
export default function ClassSnapshotSection({ status, error, snapshot, onRetry }) {
  if (status === 'loading') {
    return (
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <SectionHeader title="Class snapshot" />
        <Spinner label="Loading snapshot…" />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <SectionHeader title="Class snapshot" />
        <EmptyState
          title="Couldn't load the class snapshot"
          description={error || 'Something went wrong. Please try again.'}
          action={
            onRetry && (
              <button
                onClick={onRetry}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-accent)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: 'var(--text-sm)',
                }}
              >
                Retry
              </button>
            )
          }
        />
      </div>
    );
  }

  if (!snapshot) return null;

  return (
    <div style={{ marginBottom: 'var(--space-6)' }}>
      <SectionHeader
        title="Class snapshot"
        subtitle={snapshot.metadata?.partial ? 'Some sections are unavailable right now' : undefined}
      />
      <div style={styles.grid}>
        <AnalyticsSnapshotCard section={snapshot.snapshot?.analytics} />
        <InterventionSnapshotCard section={snapshot.snapshot?.intervention} />
        <QmsSnapshotCard section={snapshot.snapshot?.qms} />
      </div>
    </div>
  );
}

// ── Analytics ────────────────────────────────────────────────────────────

function AnalyticsSnapshotCard({ section }) {
  return (
    <SnapshotCard title="Analytics" section={section} unavailableLabel="Analytics not available">
      {(data) => {
        const summary = data.classSummary || {};
        return (
          <div style={styles.statRow}>
            <SnapshotStat label="Avg. mastery" value={formatPercent(summary.averageMastery)} />
            <SnapshotStat label="Avg. coverage" value={formatPercent(summary.averageCoverage)} />
            <SnapshotStat label="Avg. progress" value={formatPercent(summary.averageProgress)} />
          </div>
        );
      }}
    </SnapshotCard>
  );
}

// ── Intervention ─────────────────────────────────────────────────────────

function InterventionSnapshotCard({ section }) {
  return (
    <SnapshotCard title="Intervention" section={section} unavailableLabel="Intervention data not available">
      {(data) => {
        const counts = data.priorityCounts || {};
        return (
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <Pill tone="warning">{counts.high || 0} high</Pill>
            <Pill tone="accent">{counts.medium || 0} medium</Pill>
            <Pill tone="neutral">{counts.low || 0} low</Pill>
          </div>
        );
      }}
    </SnapshotCard>
  );
}

// ── QMS ──────────────────────────────────────────────────────────────────
// Per ADR-014 §3.4, this section always reports "unavailable" today —
// tseGrowthInsightService is phone-hash/term-scoped, not class-scoped, so
// there is no per-class QMS data to show yet. Rendered honestly as
// "not available", same convention as ADR-012's Type 3 CTA policy rather
// than hiding the card or pretending it has data.
function QmsSnapshotCard({ section }) {
  return (
    <SnapshotCard title="QMS" section={section} unavailableLabel="Not available at the class level yet">
      {() => null}
    </SnapshotCard>
  );
}

// ── Shared per-section wrapper ──────────────────────────────────────────

function SnapshotCard({ title, section, unavailableLabel, children }) {
  const status = section?.status;

  return (
    <Card style={{ padding: 'var(--space-5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
        <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, margin: 0, textTransform: 'uppercase', letterSpacing: '0.02em', color: 'var(--color-text-secondary)' }}>
          {title}
        </h3>
        {status && status !== 'ok' && <Pill tone="neutral">{statusLabel(status)}</Pill>}
      </div>

      {status === 'ok' && children(section.data)}

      {status === 'error' && (
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
          {unavailableLabel}.
        </p>
      )}

      {status === 'unavailable' && (
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
          {unavailableLabel}.
        </p>
      )}
    </Card>
  );
}

function SnapshotStat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ marginTop: '0.15rem', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
        {label}
      </div>
    </div>
  );
}

function formatPercent(value) {
  return value == null ? '—' : `${Math.round(value)}%`;
}

function statusLabel(status) {
  if (status === 'error') return 'Error';
  if (status === 'unavailable') return 'Not available';
  return status;
}

const styles = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 'var(--space-4)',
  },
  statRow: {
    display: 'flex',
    gap: 'var(--space-5)',
  },
};
