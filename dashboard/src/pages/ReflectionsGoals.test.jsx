import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, userEvent, waitFor } from '../test/test-utils';
import ReflectionsGoals from './ReflectionsGoals';

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

// ReflectionPanel/GrowthPlanPanel both fetch /api/qms/topics themselves on
// mount (see ReflectionPanel.test.jsx) — this page renders both panels
// unchanged, so that route needs a mock too even though this page never
// calls it directly.
const TOPICS_ROUTE = { '/api/qms/topics': { body: { topics: [{ id: 'TOPIC_ASSESSMENT', label: 'Assessment' }] } } };

const REFLECTIONS_RESPONSE = {
  reflections: [{ id: 'r1', term: 2, createdAt: '2026-05-10 09:00:00', content: 'Group work went well today.' }],
};

const GROWTH_PLANS_RESPONSE = {
  growthPlans: [{ id: 'g1', goalText: 'Improve fractions fluency', status: 'active', createdAt: '2026-05-01 09:00:00' }],
};

function renderPage() {
  return renderWithProviders(<ReflectionsGoals />, { authenticated: true });
}

describe('ReflectionsGoals page', () => {
  it('shows a loading spinner before either request resolves', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderPage();
    expect(screen.getByText(/loading reflections and goals/i)).toBeInTheDocument();
  });

  it('has a direct sidebar destination labeled "Reflections & Goals"', async () => {
    mockFetchRoutes({ ...TOPICS_ROUTE, '/api/reflections': { body: REFLECTIONS_RESPONSE }, '/api/growth-plans': { body: GROWTH_PLANS_RESPONSE } });
    renderPage();

    await screen.findByText('Group work went well today.');
    expect(screen.getByRole('link', { name: /reflections & goals/i })).toBeInTheDocument();
  });

  it('page heading reads "Reflections & Goals"', async () => {
    mockFetchRoutes({ ...TOPICS_ROUTE, '/api/reflections': { body: REFLECTIONS_RESPONSE }, '/api/growth-plans': { body: GROWTH_PLANS_RESPONSE } });
    renderPage();

    await screen.findByText('Group work went well today.');
    expect(screen.getByRole('heading', { name: 'Reflections & Goals' })).toBeInTheDocument();
  });

  it('loads and renders reflections from /api/reflections', async () => {
    mockFetchRoutes({ ...TOPICS_ROUTE, '/api/reflections': { body: REFLECTIONS_RESPONSE }, '/api/growth-plans': { body: GROWTH_PLANS_RESPONSE } });
    renderPage();

    expect(await screen.findByText('Group work went well today.')).toBeInTheDocument();
    expect(screen.getByText('Term 2')).toBeInTheDocument();
  });

  it('loads and renders growth plans from /api/growth-plans', async () => {
    mockFetchRoutes({ ...TOPICS_ROUTE, '/api/reflections': { body: REFLECTIONS_RESPONSE }, '/api/growth-plans': { body: GROWTH_PLANS_RESPONSE } });
    renderPage();

    expect(await screen.findByText('Improve fractions fluency')).toBeInTheDocument();
  });

  it('shows existing empty states for both panels when there is nothing saved yet', async () => {
    mockFetchRoutes({ ...TOPICS_ROUTE, '/api/reflections': { body: { reflections: [] } }, '/api/growth-plans': { body: { growthPlans: [] } } });
    renderPage();

    expect(await screen.findByText('No reflections yet')).toBeInTheDocument();
    expect(screen.getByText('No growth plans yet')).toBeInTheDocument();
  });

  it('shows one error banner for the page if either request fails', async () => {
    // Force the reflections call to fail specifically, while growth-plans
    // and topics succeed.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (url.includes('/api/reflections')) {
          return { ok: false, status: 503, text: async () => JSON.stringify({ error: 'Reflections service down' }) };
        }
        if (url.includes('/api/growth-plans')) {
          return { ok: true, status: 200, text: async () => JSON.stringify(GROWTH_PLANS_RESPONSE) };
        }
        return { ok: true, status: 200, text: async () => JSON.stringify(TOPICS_ROUTE['/api/qms/topics'].body) };
      })
    );
    renderPage();

    expect(await screen.findByText('Reflections service down')).toBeInTheDocument();
  });

  it('retries both requests when Retry is clicked after an error', async () => {
    let reflectionsShouldFail = true;
    const fetchMock = vi.fn(async (url) => {
      if (url.includes('/api/reflections')) {
        if (reflectionsShouldFail) {
          return { ok: false, status: 500, text: async () => JSON.stringify({ error: 'Snapshot down' }) };
        }
        return { ok: true, status: 200, text: async () => JSON.stringify(REFLECTIONS_RESPONSE) };
      }
      if (url.includes('/api/growth-plans')) {
        return { ok: true, status: 200, text: async () => JSON.stringify(GROWTH_PLANS_RESPONSE) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(TOPICS_ROUTE['/api/qms/topics'].body) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Snapshot down');
    reflectionsShouldFail = false;

    await user.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(screen.getByText('Group work went well today.')).toBeInTheDocument());
  });
});
