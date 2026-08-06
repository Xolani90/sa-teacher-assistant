import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ClassSnapshotSection from './ClassSnapshotSection';

// No providers needed: this component is pure presentational (props in,
// JSX out) — it doesn't call useTheme()/useTeacher() or fetch anything
// itself. That's also why it's a good first test: it exercises the render
// pipeline (jsdom, RTL, jest-dom matchers) without needing the Theme/
// Teacher provider stack from test-utils.

describe('ClassSnapshotSection', () => {
  it('shows a loading state', () => {
    render(<ClassSnapshotSection status="loading" />);
    expect(screen.getByText(/loading snapshot/i)).toBeInTheDocument();
  });

  it('shows a top-level error state and calls onRetry when clicked', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(<ClassSnapshotSection status="error" error="Network down" onRetry={onRetry} />);

    expect(screen.getByText(/couldn't load the class snapshot/i)).toBeInTheDocument();
    expect(screen.getByText('Network down')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders nothing once loaded with no snapshot', () => {
    const { container } = render(<ClassSnapshotSection status="ok" snapshot={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('isolates per-section faults: one section erroring does not hide another that succeeded', () => {
    // This is the behavior called out as fragile in ADR-014 §3.2 — a
    // failed analytics section must never take down a working
    // intervention section, since the backend fetches them independently.
    render(
      <ClassSnapshotSection
        status="ok"
        snapshot={{
          snapshot: {
            analytics: {
              status: 'ok',
              data: { classSummary: { averageMastery: 82, averageCoverage: 60, averageProgress: 71 } },
            },
            intervention: { status: 'error' },
            qms: { status: 'unavailable' },
          },
        }}
      />
    );

    // Analytics: status "ok" -> renders real numbers, no status pill.
    expect(screen.getByText('82%')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.getByText('71%')).toBeInTheDocument();

    // Intervention: status "error" -> falls back to its unavailable copy,
    // does not throw, does not affect the analytics card above.
    expect(screen.getByText(/intervention data not available/i)).toBeInTheDocument();

    // QMS: status "unavailable" -> same fallback path as "error", per
    // ADR-014 §3.4 (no per-class QMS data exists yet).
    expect(screen.getByText(/not available at the class level yet/i)).toBeInTheDocument();

    // Two of the three sections should show a non-"ok" status pill.
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('Not available')).toBeInTheDocument();
  });

  it('formats missing analytics values as an em dash rather than "0%" or "null"', () => {
    render(
      <ClassSnapshotSection
        status="ok"
        snapshot={{
          snapshot: {
            analytics: { status: 'ok', data: { classSummary: {} } },
            intervention: { status: 'ok', data: { priorityCounts: {} } },
            qms: { status: 'unavailable' },
          },
        }}
      />
    );

    expect(screen.getAllByText('—')).toHaveLength(3);
    // priorityCounts defaults each missing count to 0, not a dash.
    expect(screen.getByText('0 high')).toBeInTheDocument();
    expect(screen.getByText('0 medium')).toBeInTheDocument();
    expect(screen.getByText('0 low')).toBeInTheDocument();
  });

  it('shows a "partial" subtitle when metadata.partial is true', () => {
    render(
      <ClassSnapshotSection
        status="ok"
        snapshot={{
          metadata: { partial: true },
          snapshot: { analytics: { status: 'unavailable' }, intervention: { status: 'unavailable' }, qms: { status: 'unavailable' } },
        }}
      />
    );
    expect(screen.getByText(/some sections are unavailable right now/i)).toBeInTheDocument();
  });
});
