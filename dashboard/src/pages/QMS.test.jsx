import { describe, it, expect, vi } from 'vitest';
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

const REFLECTIONS_RESPONSE = {
  reflections: [{ id: 'r1', term: 2, createdAt: '2026-05-10 09:00:00', content: 'Good lesson today.' }],
};

const GROWTH_PLANS_RESPONSE = { growthPlans: [] };

function renderQMS() {
  return renderWithProviders(<QMS />, { authenticated: true });
}

describe('QMS page', () => {
  it('shows a loading spinner before either request resolves', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderQMS();
    expect(screen.getByText(/loading qms readiness/i)).toBeInTheDocument();
  });

  it('renders the summary banner, category cards, gaps, and reflections on success', async () => {
    mockFetchRoutes({
      '/tse/status': { body: SNAPSHOT },
      '/reflections': { body: REFLECTIONS_RESPONSE },
      '/growth-plans': { body: GROWTH_PLANS_RESPONSE },
    });
    renderQMS();

    expect(await screen.findByText('Your curriculum coverage is ahead of pace this term.')).toBeInTheDocument();

    // Category cards, one per configured category, showing their counts.
    expect(screen.getByText('Curriculum Coverage')).toBeInTheDocument();
    expect(screen.getByText('Learner Support')).toBeInTheDocument();
    expect(screen.getByText('Resources')).toBeInTheDocument();

    // Gaps section, since SNAPSHOT.gaps is non-empty.
    expect(screen.getByText('Things Worth Following Up')).toBeInTheDocument();
    expect(screen.getByText('3 learners have no assessment in the last 30 days.')).toBeInTheDocument();

    // Reflections panel wired up with the second endpoint's data.
    expect(screen.getByText('Good lesson today.')).toBeInTheDocument();
  });

  it('omits the gaps section when there are no gaps', async () => {
    mockFetchRoutes({
      '/tse/status': { body: { ...SNAPSHOT, gaps: [] } },
      '/reflections': { body: { reflections: [] } },
      '/growth-plans': { body: GROWTH_PLANS_RESPONSE },
    });
    renderQMS();

    await screen.findByText('Curriculum Coverage');
    expect(screen.queryByText('Things Worth Following Up')).not.toBeInTheDocument();
  });

  it('omits the summary banner when strength is null', async () => {
    mockFetchRoutes({
      '/tse/status': { body: { ...SNAPSHOT, strength: null, gaps: [] } },
      '/reflections': { body: { reflections: [] } },
      '/growth-plans': { body: GROWTH_PLANS_RESPONSE },
    });
    renderQMS();

    await screen.findByText('Curriculum Coverage');
    expect(screen.queryByText('On track')).not.toBeInTheDocument();
  });

  it('shows one error banner for the whole page if either request fails (Promise.all, unlike ClassDetail)', async () => {
    mockFetchRoutes({
      '/tse/status': { body: SNAPSHOT },
      '/reflections': { body: { error: 'Reflections service down' }, ok: false, status: 503 },
      '/growth-plans': { body: GROWTH_PLANS_RESPONSE },
    });
    renderQMS();

    expect(await screen.findByText('Reflections service down')).toBeInTheDocument();
    // Nothing from the successful /tse/status call renders either --
    // Promise.all means one failure takes the whole page down, which is
    // the deliberate difference from ClassDetail's per-request isolation.
    expect(screen.queryByText('Curriculum Coverage')).not.toBeInTheDocument();
  });

  it('retries both requests when Retry is clicked after an error', async () => {
    const fetchMock = mockFetchRoutes({
      '/tse/status': { body: { error: 'Snapshot down' }, ok: false, status: 500 },
      '/reflections': { body: REFLECTIONS_RESPONSE },
      '/growth-plans': { body: GROWTH_PLANS_RESPONSE },
    });
    const user = userEvent.setup();
    renderQMS();

    await screen.findByText('Snapshot down');

    // Fix the failing endpoint before retrying.
    fetchMock.mockImplementation(async (url) => {
      if (url.includes('/tse/status')) {
        return { ok: true, status: 200, text: async () => JSON.stringify(SNAPSHOT) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(REFLECTIONS_RESPONSE) };
    });

    await user.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(screen.getByText('Curriculum Coverage')).toBeInTheDocument());
  });
});
