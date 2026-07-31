// dashboard/src/components/qms/QMSCategoryCard.jsx
import { useState } from 'react';
import { Pill } from '../ui';
import QMSCategoryActions from './QMSCategoryActions';
import { qmsRecommendations } from '../../config/qmsRecommendations';

/**
 * A single expandable evidence category card on the QMS Readiness page.
 * Owns expand/collapse state, status badge, and evidence count; delegates
 * recommendation/CTA rendering to QMSCategoryActions. See ADR-012 §4.3.
 */
export default function QMSCategoryCard({ categoryKey, label, count, isMissing }) {
  const [expanded, setExpanded] = useState(false);

  const config = qmsRecommendations[categoryKey];
  const variant = count === 0 ? config?.empty : config?.populated;

  return (
    <div
      style={{
        borderRadius: 'var(--radius-md)',
        border: isMissing ? '1px dashed var(--color-border-strong)' : '1px solid var(--color-border)',
        background: isMissing ? 'var(--color-bg)' : 'var(--color-surface)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-4)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div>
          <div
            style={{
              fontSize: 'var(--text-2xl)',
              fontWeight: 700,
              color: isMissing ? 'var(--color-text-secondary)' : 'var(--color-text-primary)',
              lineHeight: 1.1,
            }}
          >
            {count}
          </div>
          <div style={{ marginTop: '0.2rem', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
            {label}
          </div>
          {isMissing && (
            <div style={{ marginTop: 'var(--space-2)' }}>
              <Pill tone="neutral">No evidence yet</Pill>
            </div>
          )}
        </div>
        <span
          aria-hidden="true"
          style={{
            fontSize: 'var(--text-base)',
            color: 'var(--color-text-secondary)',
            transform: expanded ? 'rotate(180deg)' : 'none',
            transition: 'transform var(--duration-fast) var(--ease-standard)',
          }}
        >
          &#9662;
        </span>
      </button>

      {expanded && variant && (
        <div style={{ padding: '0 var(--space-4) var(--space-4)', borderTop: '1px solid var(--color-border)' }}>
          <QMSCategoryActions
            status={variant.status}
            recommendations={variant.recommendations}
            ctas={variant.ctas}
          />
        </div>
      )}
    </div>
  );
}
