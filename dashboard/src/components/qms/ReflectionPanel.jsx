// dashboard/src/components/qms/ReflectionPanel.jsx
import { Card, EmptyState, Pill, SectionHeader } from '../ui';

/**
 * Recent reflections list, extracted unchanged from the original
 * QMS.jsx per ADR-012 §4.3.
 */
export default function ReflectionPanel({ reflections }) {
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
