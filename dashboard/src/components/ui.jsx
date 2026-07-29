// src/components/ui.jsx
//
// Small, dependency-free primitives shared across pages. Kept in one file
// on purpose — none of these are complex enough to earn their own file,
// and having them in one place makes the visual language easy to audit.

export function Card({ children, style, onClick, as = 'div', ...rest }) {
  const Tag = as;
  const interactive = typeof onClick === 'function';
  return (
    <Tag
      onClick={onClick}
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-sm)',
        transition: `transform var(--duration-base) var(--ease-standard), box-shadow var(--duration-base) var(--ease-standard)`,
        cursor: interactive ? 'pointer' : 'default',
        textAlign: 'left',
        fontFamily: 'inherit',
        color: 'inherit',
        ...style,
      }}
      onMouseEnter={
        interactive
          ? (e) => {
              e.currentTarget.style.boxShadow = 'var(--shadow-md)';
              e.currentTarget.style.transform = 'translateY(-2px)';
            }
          : undefined
      }
      onMouseLeave={
        interactive
          ? (e) => {
              e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
              e.currentTarget.style.transform = 'translateY(0)';
            }
          : undefined
      }
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function Button({ variant = 'primary', style, children, ...rest }) {
  const variants = {
    primary: {
      background: 'var(--color-accent)',
      color: '#fff',
      border: '1px solid transparent',
    },
    secondary: {
      background: 'var(--color-surface)',
      color: 'var(--color-text-primary)',
      border: '1px solid var(--color-border-strong)',
    },
    ghost: {
      background: 'transparent',
      color: 'var(--color-accent)',
      border: '1px solid transparent',
      padding: '0.4rem 0.2rem',
    },
    danger: {
      background: 'var(--color-danger)',
      color: '#fff',
      border: '1px solid transparent',
    },
  };

  return (
    <button
      style={{
        padding: '0.65rem 1.15rem',
        borderRadius: 'var(--radius-full)',
        fontSize: 'var(--text-sm)',
        fontWeight: 600,
        cursor: 'pointer',
        transition: `background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast)`,
        ...variants[variant],
        ...style,
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.transform = 'scale(0.97)';
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = 'scale(1)';
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Stat({ label, value, accent, icon, tone = 'indigo' }) {
  return (
    <Card style={{ padding: 'var(--space-5)', animation: 'fadeSlideUp var(--duration-base) var(--ease-standard)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
        {icon && <IconBadge tone={tone}>{icon}</IconBadge>}
        <div>
          <div
            style={{
              fontSize: 'var(--text-2xl)',
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: accent ? 'var(--color-accent)' : 'var(--color-text-primary)',
              lineHeight: 1.1,
            }}
          >
            {value}
          </div>
          <div style={{ marginTop: '0.2rem', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
            {label}
          </div>
        </div>
      </div>
    </Card>
  );
}

export function EmptyState({ title, description, action }) {
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px dashed var(--color-border-strong)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-7)',
        textAlign: 'center',
      }}
    >
      <p style={{ fontWeight: 600, fontSize: 'var(--text-md)', margin: '0 0 var(--space-2)' }}>{title}</p>
      {description && (
        <p style={{ color: 'var(--color-text-secondary)', margin: '0 0 var(--space-4)', fontSize: 'var(--text-base)' }}>
          {description}
        </p>
      )}
      {action}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }) {
  return (
    <div
      style={{
        background: 'var(--color-danger-soft)',
        border: '1px solid rgba(217, 48, 37, 0.2)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-4) var(--space-5)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 'var(--space-3)',
      }}
    >
      <p style={{ color: 'var(--color-danger)', margin: 0, fontSize: 'var(--text-base)' }}>{message}</p>
      {onRetry && (
        <Button variant="danger" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Spinner({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', color: 'var(--color-text-secondary)' }}>
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: '50%',
          border: '2px solid var(--color-border-strong)',
          borderTopColor: 'var(--color-accent)',
          animation: 'spin 0.8s linear infinite',
          display: 'inline-block',
        }}
      />
      <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
      {label && <span style={{ fontSize: 'var(--text-base)' }}>{label}</span>}
    </div>
  );
}

// Gradient icon tile used in stat cards / action cards, Apple-Health-style.
export function IconBadge({ children, tone = 'indigo', size = 44 }) {
  const tones = {
    indigo: 'var(--grad-indigo-soft)',
    lavender: 'var(--grad-lavender-soft)',
    mint: 'var(--grad-mint-soft)',
    amber: 'var(--grad-amber-soft)',
  };
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 'var(--radius-sm)',
        background: tones[tone] || tones.indigo,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.45,
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  );
}

// Consistent "Title + optional trailing link/action" row used above every
// section on the dashboard, so rhythm stays identical across sections.
export function SectionHeader({ title, subtitle, action }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        marginBottom: 'var(--space-4)',
        gap: 'var(--space-3)',
      }}
    >
      <div>
        <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 700, margin: 0, letterSpacing: '-0.01em' }}>{title}</h2>
        {subtitle && (
          <p style={{ margin: '0.2rem 0 0', color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
            {subtitle}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

export function Pill({ children, tone = 'neutral' }) {
  const tones = {
    neutral: { background: 'var(--color-bg)', color: 'var(--color-text-secondary)' },
    accent: { background: 'var(--color-accent-soft)', color: 'var(--color-accent)' },
    success: { background: 'var(--color-success-soft)', color: 'var(--color-success)' },
    warning: { background: 'var(--color-warning-soft)', color: 'var(--color-warning)' },
  };
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '0.2rem 0.6rem',
        borderRadius: 'var(--radius-full)',
        fontSize: 'var(--text-xs)',
        fontWeight: 600,
        ...tones[tone],
      }}
    >
      {children}
    </span>
  );
}
