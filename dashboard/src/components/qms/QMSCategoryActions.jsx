// dashboard/src/components/qms/QMSCategoryActions.jsx
import { useNavigate } from 'react-router-dom';
import { Pill } from '../ui';

/**
 * Renders recommendation text and CTA buttons for a single QMS category,
 * per ADR-012 §4.1 / §4.2.
 *
 * This component has no knowledge of *why* a recommendation was chosen —
 * it only knows how to render `{ status, recommendations, ctas }`, which
 * today comes from the static config/qmsRecommendations.js and later
 * could come from a real qmsRecommendationService response without this
 * component changing (ADR-012 §4.3).
 *
 * CTA `type` determines rendering, per the three-type policy in §4.1:
 *   - 'route'      → navigates to an existing dashboard route
 *   - 'whatsapp'   → shows the WhatsApp command as instruction text,
 *                    never a dead link
 *   - 'comingSoon' → disabled button
 */
export default function QMSCategoryActions({ status, recommendations, ctas }) {
  const navigate = useNavigate();

  return (
    <div style={{ paddingTop: 'var(--space-3)' }}>
      <p style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
        {status}
      </p>

      {recommendations?.length > 0 && (
        <ul style={{ margin: '0 0 var(--space-4)', paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          {recommendations.map((rec, i) => (
            <li key={i} style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
              {rec}
            </li>
          ))}
        </ul>
      )}

      {ctas?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          {ctas.map((cta, i) => (
            <CTAButton key={i} cta={cta} navigate={navigate} />
          ))}
        </div>
      )}
    </div>
  );
}

function CTAButton({ cta, navigate }) {
  const baseStyle = {
    fontSize: 'var(--text-sm)',
    fontWeight: 600,
    padding: '0.5rem 0.9rem',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--color-border)',
    cursor: 'pointer',
    background: 'var(--color-accent-soft)',
    color: 'var(--color-accent)',
  };

  if (cta.type === 'route') {
    return (
      <button type="button" style={baseStyle} onClick={() => navigate(cta.target)}>
        {cta.label}
      </button>
    );
  }

  if (cta.type === 'whatsapp') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: '0.5rem 0.9rem',
          borderRadius: 'var(--radius-sm)',
          border: '1px dashed var(--color-border-strong)',
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text-secondary)',
        }}
      >
        <Pill tone="neutral">WhatsApp</Pill>
        <span>
          {cta.label} — message your assistant: <strong>&ldquo;{cta.command}&rdquo;</strong>
        </span>
      </div>
    );
  }

  // 'comingSoon'
  return (
    <button
      type="button"
      disabled
      style={{
        ...baseStyle,
        background: 'var(--color-bg)',
        color: 'var(--color-text-secondary)',
        cursor: 'not-allowed',
        opacity: 0.7,
      }}
    >
      {cta.label} · Coming soon
    </button>
  );
}
