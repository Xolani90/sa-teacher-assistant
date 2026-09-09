import { describe, it, expect, vi } from 'vitest';
import { within } from '@testing-library/react';
import { renderWithProviders, screen, userEvent, waitFor } from '../test/test-utils';
import QMS from './QMS';

function mockFetchRoutes(routes) {
  const fetchMock = vi.fn(async (url) => {
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`Unmocked fetch in test: ${url}`);
    const { body, ok = true, status = ok ? 200 : 400 } = routes[key];
    return { ok, status, text: async () => JSON.stringify(body) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const SNAPSHOT = {
  counts: { curriculum: 5, assessment: 0, intervention: 2, observation: 0, resource: 1 },
  missingCategories: ['assessment', 'observation'],
  gaps: [{ type: 'no_recent_assessment', count: 3, message: '3 learners have no assessment in the last 30 days.' }],
  strength: 'Your curriculum coverage is ahead of pace this term.',
};

const INSUFFICIENT_INSIGHTS = {
  status: 'insufficient_data',
  summary: null,
  recommendations: [],
  generatedAt: '2026-09-09T00:00:00.000Z',
};

const RISING_INSIGHTS = {
  status: 'ok',
  summary: null,
  recommendations: [
    {
      topicId: 'TOPIC_A',
      topicLabel: 'Formative Assessment',
      ruleId: 'trend_rising',
      messageId: 'trend_rising',
      templateData: { currentConfidence: 0.7, previousConfidence: 0.4 },
      recommendation: 'Your evidence for Formative Assessment is trending upward.',
      confidence: 0.7,
      confidenceLabel: 'high',
      evidence: { reflections: 3, growthPlans: 1 },
      explanation: 'Based on recent reflections and an active growth plan.',
    },
  ],
  generatedAt: '2026-09-09T00:00:00.000Z',
};

function renderQMS() {
  return renderWithProviders(<QMS />, { authenticated: true });
}

describe('QMS page', () => {
  it('shows a loading spinner before the request resolves', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderQMS();
    expect(screen.getByText(/loading qms readiness/i)).toBeInTheDocument();
  });

  it('sidebar label reads "QMS & Readiness"', async () => {
    mockFetchRoutes({ '/tse/status': { body: SNAPSHOT }, '/coaching/insights': { body: INSUFFICIENT_INSIGHTS } });
    renderQMS();

    await screen.findByText('Curriculum Coverage');
    expect(screen.getByRole('link', { name: /qms & readiness/i })).toBeInTheDocument();
  });

  it('page heading reads "QMS & Readiness"', async () => {
    mockFetchRoutes({ '/tse/status': { body: SNAPSHOT }, '/coaching/insights': { body: INSUFFICIENT_INSIGHTS } });
    renderQMS();

    // Scoped to <main>: the sidebar nav link text now overlaps with the
    // page heading ("QMS & Readiness" appears in both), and the "Resources"
    // category card label overlaps with the sidebar's "Resources" nav
    // link (Dashboard IA v1 renamed "Lesson Plans" -> "Resources").
    await screen.findByText('Curriculum Coverage');
    const main = screen.getByRole('main');
    expect(main.querySelector('h1')).toHaveTextContent('QMS & Readiness');
  });

  it('renders the summary banner, category cards, and gaps on success', async () => {
    mockFetchRoutes({ '/tse/status': { body: SNAPSHOT }, '/coaching/insights': { body: INSUFFICIENT_INSIGHTS } });
    renderQMS();

    expect(await screen.findByText('Your curriculum coverage is ahead of pace this term.')).toBeInTheDocument();

    // Category cards, one per configured category, showing their counts.
    const main = screen.getByRole('main');
    expect(within(main).getByText('Curriculum Coverage')).toBeInTheDocument();
    expect(within(main).getByText('Learner Support')).toBeInTheDocument();
    expect(within(main).getByText('Resources')).toBeInTheDocument();

    // Gaps section, since SNAPSHOT.gaps is non-empty.
    expect(screen.getByText('Things Worth Following Up')).toBeInTheDocument();
    expect(screen.getByText('3 learners have no assessment in the last 30 days.')).toBeInTheDocument();
  });

  it('does not render the Reflections or Growth Plans panels (moved to /reflections)', async () => {
    mockFetchRoutes({ '/tse/status': { body: SNAPSHOT }, '/coaching/insights': { body: INSUFFICIENT_INSIGHTS } });
    renderQMS();

    await screen.findByText('Your curriculum coverage is ahead of pace this term.');

    // Scoped to <main>: the sidebar's own "Reflections & Goals" nav link
    // text would otherwise match a bare /reflections/i query too.
    const main = screen.getByRole('main');
    expect(within(main).queryByText(/reflections/i)).not.toBeInTheDocument();
    expect(within(main).queryByText(/growth plans/i)).not.toBeInTheDocument();
  });

  it('only fetches /api/tse/status — no /api/reflections or /api/growth-plans calls', async () => {
    const fetchMock = mockFetchRoutes({ '/tse/status': { body: SNAPSHOT }, '/coaching/insights': { body: INSUFFICIENT_INSIGHTS } });
    renderQMS();

    await screen.findByText('Your curriculum coverage is ahead of pace this term.');

    const calledUrls = fetchMock.mock.calls.map((call) => call[0]);
    expect(calledUrls.some((u) => u.includes('/tse/status'))).toBe(true);
    expect(calledUrls.some((u) => u.includes('/reflections'))).toBe(false);
    expect(calledUrls.some((u) => u.includes('/growth-plans'))).toBe(false);
  });

  it('omits the gaps section when there are no gaps', async () => {
    mockFetchRoutes({ '/tse/status': { body: { ...SNAPSHOT, gaps: [] } }, '/coaching/insights': { body: INSUFFICIENT_INSIGHTS } });
    renderQMS();

    await screen.findByText('Curriculum Coverage');
    expect(screen.queryByText('Things Worth Following Up')).not.toBeInTheDocument();
  });

  it('omits the summary banner when strength is null', async () => {
    mockFetchRoutes({ '/tse/status': { body: { ...SNAPSHOT, strength: null, gaps: [] } }, '/coaching/insights': { body: INSUFFICIENT_INSIGHTS } });
    renderQMS();

    await screen.findByText('Curriculum Coverage');
    expect(screen.queryByText('On track')).not.toBeInTheDocument();
  });

  it('shows an error banner if the request fails', async () => {
    mockFetchRoutes({
      '/tse/status': { body: { error: 'Snapshot service down' }, ok: false, status: 503 },
    });
    renderQMS();

    expect(await screen.findByText('Snapshot service down')).toBeInTheDocument();
    expect(screen.queryByText('Curriculum Coverage')).not.toBeInTheDocument();
  });

  it('retries the request when Retry is clicked after an error', async () => {
    const fetchMock = mockFetchRoutes({
      '/tse/status': { body: { error: 'Snapshot down' }, ok: false, status: 500 },
    });
    const user = userEvent.setup();
    renderQMS();

    await screen.findByText('Snapshot down');

    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(SNAPSHOT),
    }));

    await user.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(screen.getByText('Curriculum Coverage')).toBeInTheDocument());
  });

  it('shows the Coaching Insights panel with a rendered recommendation on trend data', async () => {
    mockFetchRoutes({
      '/tse/status': { body: SNAPSHOT },
      '/coaching/insights': { body: RISING_INSIGHTS },
    });
    renderQMS();

    expect(await screen.findByText('Coaching Insights')).toBeInTheDocument();
    expect(screen.getByText('Your evidence for Formative Assessment is trending upward.')).toBeInTheDocument();
  });

  it('shows an insufficient-evidence empty state in Coaching Insights when data is thin', async () => {
    mockFetchRoutes({
      '/tse/status': { body: SNAPSHOT },
      '/coaching/insights': { body: INSUFFICIENT_INSIGHTS },
    });
    renderQMS();

    expect(await screen.findByText('Coaching Insights')).toBeInTheDocument();
    expect(screen.getByText('Not enough evidence yet')).toBeInTheDocument();
  });

  it('omits the Coaching Insights panel entirely (not an error state) if that fetch fails', async () => {
    mockFetchRoutes({
      '/tse/status': { body: SNAPSHOT },
      '/coaching/insights': { body: { error: 'down' }, ok: false, status: 500 },
    });
    renderQMS();

    await screen.findByText('Curriculum Coverage');
    expect(screen.queryByText('Coaching Insights')).not.toBeInTheDocument();
    // The rest of the page is completely unaffected by the failure.
    expect(screen.getByText('Your curriculum coverage is ahead of pace this term.')).toBeInTheDocument();
  });
});
