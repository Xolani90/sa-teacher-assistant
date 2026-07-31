// dashboard/src/components/qms/QMSSummaryBanner.jsx
import { Card, Pill } from '../ui';

/**
 * Strength banner shown at the top of the QMS Readiness page when the
 * backend snapshot includes a non-null `strength` message. Extracted
 * unchanged from the original QMS.jsx per ADR-012 §4.3.
 */
export default function QMSSummaryBanner({ strength }) {
  if (!strength) return null;

  return (
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
  );
}
