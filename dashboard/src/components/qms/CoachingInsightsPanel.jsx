// dashboard/src/components/qms/CoachingInsightsPanel.jsx
import { Card, SectionHeader, Pill, EmptyState } from '../ui';

/**
 * Coaching Insights panel — the dashboard half of PR40 (ADR-016 §9's
 * "surface trends in teacher experience: WhatsApp first, dashboard
 * later"). The WhatsApp half already shipped as ADR-018's
 * coachingMessageRenderer; this is the deferred other half.
 *
 * Purely presentational and read-only: renders whatever
 * GET /api/coaching/insights (services/coachingEngineService.getCoachingInsights,
 * itself already trend-aware per PR38/PR39) returns. No thresholds,
 * confidence math, or trend logic live here — this component only
 * decides how to lay the already-computed result out, mirroring the
 * compute/decide-vs-render split ADR-016/ADR-018 established for the
 * WhatsApp side. Descriptive only: it states what the evidence shows
 * (rising/falling/gained/stable), never a verdict on the teacher.
 */
export default function CoachingInsightsPanel({ insights }) {
  if (!insights || insights.status === 'insufficient_data') {
    return (
      <Card style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-6)' }}>
        <SectionHeader
          title="Coaching Insights"
          subtitle="Patterns in your teaching evidence over time"
        />
        <EmptyState
          title="Not enough evidence yet"
          description="Log a bit more teaching evidence this term and this section will start surfacing patterns over time."
        />
      </Card>
    );
  }

  const { recommendations = [] } = insights;

  return (
    <Card style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-6)' }}>
      <SectionHeader
        title="Coaching Insights"
        subtitle="Patterns in your teaching evidence over time"
      />
      {recommendations.length === 0 ? (
        <EmptyState
          title="Nothing standing out right now"
          description="No notable pattern in your evidence at the moment — check back after your next update."
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {recommendations.map((rec) => (
            <CoachingInsightRow key={rec.topicId} rec={rec} />
          ))}
        </div>
      )}
    </Card>
  );
}

const TREND_TONE = {
  trend_rising: 'success',
  trend_falling: 'warning',
  evidence_gained: 'accent',
  evidence_removed: 'neutral',
};

function CoachingInsightRow({ rec }) {
  const tone = TREND_TONE[rec.ruleId] || 'neutral';

  return (
    <div
      style={{
        padding: 'var(--space-4)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-bg)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--space-3)',
      }}
    >
      <Pill tone={tone}>{rec.topicLabel}</Pill>
      <div>
        <p style={{ margin: 0, color: 'var(--color-text-primary)', fontSize: 'var(--text-sm)' }}>
          {rec.recommendation}
        </p>
        {rec.explanation && (
          <p
            style={{
              margin: '0.3rem 0 0',
              color: 'var(--color-text-secondary)',
              fontSize: 'var(--text-xs)',
            }}
          >
            {rec.explanation}
          </p>
        )}
      </div>
    </div>
  );
}
