import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, userEvent, waitFor } from '../../test/test-utils';
import GrowthPlanPanel from './GrowthPlanPanel';

function mockFetchRoutes(routes) {
  const fetchMock = vi.fn(async (url, options = {}) => {
    const key = Object.keys(routes).find((k) => url.includes(k) && (!routes[k].method || routes[k].method === (options.method || 'GET')));
    if (!key) throw new Error(`Unmocked fetch in test: ${options.method || 'GET'} ${url}`);
    const { body, ok = true, status = ok ? 200 : 400 } = routes[key];
    return { ok, status, text: async () => JSON.stringify(body) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const TOPICS_ROUTE = { '/api/qms/topics': { method: 'GET', body: { topics: [
  { id: 'TOPIC_ASSESSMENT', label: 'Assessment' },
  { id: 'TOPIC_DIFFERENTIATION', label: 'Differentiation' },
] } } };

const GROWTH_PLANS = [
  { id: 'g1', term: 2, status: 'active', createdAt: '2026-05-10 09:00:00', goalText: 'Give more specific written feedback.', topicId: 'TOPIC_ASSESSMENT' },
  { id: 'g2', term: null, status: 'completed', createdAt: '2026-05-08 14:30:00', goalText: 'Build a differentiated fractions unit.', topicId: 'TOPIC_DIFFERENTIATION' },
];

describe('GrowthPlanPanel', () => {
  it('shows an empty state with an "Add Goal" button when there are no growth plans', () => {
    renderWithProviders(<GrowthPlanPanel growthPlans={[]} onChange={vi.fn()} />, { authenticated: true });
    expect(screen.getByText('No growth plans yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add goal/i })).toBeInTheDocument();
  });

  it('lists existing growth plans with their status pill, term pill, date, and goal text', () => {
    renderWithProviders(<GrowthPlanPanel growthPlans={GROWTH_PLANS} onChange={vi.fn()} />, { authenticated: true });
    expect(screen.getByText('Term 2')).toBeInTheDocument();
    expect(screen.getByText('Unscoped')).toBeInTheDocument();
    expect(screen.getByText('Give more specific written feedback.')).toBeInTheDocument();
    expect(screen.getByText('Build a differentiated fractions unit.')).toBeInTheDocument();
  });

  it('adds a new growth plan: POSTs goalText + topicId and refreshes via onChange', async () => {
    const fetchMock = mockFetchRoutes({
      ...TOPICS_ROUTE,
      '/api/growth-plans': { method: 'POST', body: { id: 'g3' } },
    });
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<GrowthPlanPanel growthPlans={[]} onChange={onChange} />, { authenticated: true });

    await user.click(screen.getByRole('button', { name: /add goal/i }));
    await user.type(screen.getByPlaceholderText(/what are you working towards/i), 'Improve questioning technique in class discussions.');
    await user.selectOptions(screen.getByRole('combobox'), 'TOPIC_ASSESSMENT');
    await user.click(screen.getByRole('button', { name: /save goal/i }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    // fetchMock.mock.calls[0] is the /api/qms/topics GET fired on mount;
    // the save action is the POST to /api/growth-plans that follows it.
    const postCall = fetchMock.mock.calls.find(([, opts]) => opts?.method === 'POST');
    const [, options] = postCall;
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({
      goalText: 'Improve questioning technique in class discussions.',
      topicId: 'TOPIC_ASSESSMENT',
    });

    // Form closes back to idle after a successful save.
    expect(screen.queryByPlaceholderText(/what are you working towards/i)).not.toBeInTheDocument();
  });

  it('refuses to save a new goal without a topic selected', async () => {
    const fetchMock = mockFetchRoutes({ ...TOPICS_ROUTE, '/api/growth-plans': { method: 'POST', body: {} } });
    const user = userEvent.setup();
    renderWithProviders(<GrowthPlanPanel growthPlans={[]} onChange={vi.fn()} />, { authenticated: true });

    await user.click(screen.getByRole('button', { name: /add goal/i }));
    await user.type(screen.getByPlaceholderText(/what are you working towards/i), 'Goal without a topic.');
    await user.click(screen.getByRole('button', { name: /save goal/i }));

    expect(await screen.findByText('Please select a coaching area.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, opts]) => opts?.method === 'POST')).toBe(false);
  });

  it('refuses to save an empty goal without calling the network', async () => {
    const fetchMock = mockFetchRoutes({ ...TOPICS_ROUTE, '/api/growth-plans': { method: 'POST', body: {} } });
    const user = userEvent.setup();
    renderWithProviders(<GrowthPlanPanel growthPlans={[]} onChange={vi.fn()} />, { authenticated: true });

    await user.click(screen.getByRole('button', { name: /add goal/i }));
    await user.selectOptions(screen.getByRole('combobox'), 'TOPIC_ASSESSMENT');
    await user.click(screen.getByRole('button', { name: /save goal/i }));

    expect(await screen.findByText('Goal cannot be empty.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, opts]) => opts?.method === 'POST')).toBe(false);
  });

  it('edits an existing growth plan: pre-fills the form (including topic) and PATCHes on save', async () => {
    const fetchMock = mockFetchRoutes({ ...TOPICS_ROUTE, '/api/growth-plans/g1': { method: 'PATCH', body: {} } });
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<GrowthPlanPanel growthPlans={GROWTH_PLANS} onChange={onChange} />, { authenticated: true });

    await user.click(screen.getAllByRole('button', { name: /^edit$/i })[0]);

    const textarea = screen.getByDisplayValue('Give more specific written feedback.');
    await user.clear(textarea);
    await user.type(textarea, 'Give more specific written feedback on every homework.');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const patchCall = fetchMock.mock.calls.find(([, opts]) => opts?.method === 'PATCH');
    const [url, options] = patchCall;
    expect(url).toContain('/api/growth-plans/g1');
    expect(options.method).toBe('PATCH');
    expect(JSON.parse(options.body)).toEqual({
      goalText: 'Give more specific written feedback on every homework.',
      topicId: 'TOPIC_ASSESSMENT',
    });
  });

  it('changing the status dropdown PATCHes a status-only body and refreshes via onChange', async () => {
    const fetchMock = mockFetchRoutes({ ...TOPICS_ROUTE, '/api/growth-plans/g1': { method: 'PATCH', body: {} } });
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<GrowthPlanPanel growthPlans={GROWTH_PLANS} onChange={onChange} />, { authenticated: true });

    const statusSelect = screen.getByRole('combobox', { name: /update status for goal: give more specific written feedback\./i });
    await user.selectOptions(statusSelect, 'completed');

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const patchCall = fetchMock.mock.calls.find(([, opts]) => opts?.method === 'PATCH');
    const [url, options] = patchCall;
    expect(url).toContain('/api/growth-plans/g1');
    expect(JSON.parse(options.body)).toEqual({ status: 'completed' });
  });

  it('deletes a growth plan only after the confirm step, then calls onChange', async () => {
    const fetchMock = mockFetchRoutes({ ...TOPICS_ROUTE, '/api/growth-plans/g1': { method: 'DELETE', body: {} } });
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<GrowthPlanPanel growthPlans={GROWTH_PLANS} onChange={onChange} />, { authenticated: true });

    await user.click(screen.getAllByRole('button', { name: /^delete$/i })[0]);
    expect(screen.getByText('Delete this goal?')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, opts]) => opts?.method === 'DELETE')).toBe(false);

    await user.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const deleteCall = fetchMock.mock.calls.find(([, opts]) => opts?.method === 'DELETE');
    const [url, options] = deleteCall;
    expect(url).toContain('/api/growth-plans/g1');
    expect(options.method).toBe('DELETE');
  });

  it('cancelling the delete confirmation makes no network call', async () => {
    const fetchMock = mockFetchRoutes({ ...TOPICS_ROUTE, '/api/growth-plans/g1': { method: 'DELETE', body: {} } });
    const user = userEvent.setup();
    renderWithProviders(<GrowthPlanPanel growthPlans={GROWTH_PLANS} onChange={vi.fn()} />, { authenticated: true });

    await user.click(screen.getAllByRole('button', { name: /^delete$/i })[0]);
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(screen.queryByText('Delete this goal?')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, opts]) => opts?.method === 'DELETE')).toBe(false);
  });

  it('shows an error and keeps the form open when saving fails', async () => {
    const fetchMock = mockFetchRoutes({
      ...TOPICS_ROUTE,
      '/api/growth-plans': { method: 'POST', body: { error: 'Growth plan service unavailable' }, ok: false, status: 503 },
    });
    const user = userEvent.setup();
    renderWithProviders(<GrowthPlanPanel growthPlans={[]} onChange={vi.fn()} />, { authenticated: true });

    await user.click(screen.getByRole('button', { name: /add goal/i }));
    await user.type(screen.getByPlaceholderText(/what are you working towards/i), 'A goal that will fail to save.');
    await user.selectOptions(screen.getByRole('combobox'), 'TOPIC_ASSESSMENT');
    await user.click(screen.getByRole('button', { name: /save goal/i }));

    expect(await screen.findByText('Growth plan service unavailable')).toBeInTheDocument();
    // Form stays open with the goal text intact so the teacher doesn't lose it.
    expect(screen.getByDisplayValue('A goal that will fail to save.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, opts]) => opts?.method === 'POST')).toBe(true);
  });
});