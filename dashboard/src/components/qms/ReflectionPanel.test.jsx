import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, userEvent, waitFor } from '../../test/test-utils';
import ReflectionPanel from './ReflectionPanel';

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

const REFLECTIONS = [
  { id: 'r1', term: 2, createdAt: '2026-05-10 09:00:00', content: 'Group work went well today.' },
  { id: 'r2', term: null, createdAt: '2026-05-08 14:30:00', content: 'Need to slow down on fractions.' },
];

describe('ReflectionPanel', () => {
  it('shows an empty state with an "Add Reflection" button when there are no reflections', () => {
    renderWithProviders(<ReflectionPanel reflections={[]} onChange={vi.fn()} />, { authenticated: true });
    expect(screen.getByText('No reflections yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add reflection/i })).toBeInTheDocument();
  });

  it('lists existing reflections with their term pill, date, and content', () => {
    renderWithProviders(<ReflectionPanel reflections={REFLECTIONS} onChange={vi.fn()} />, { authenticated: true });
    expect(screen.getByText('Term 2')).toBeInTheDocument();
    expect(screen.getByText('Unscoped')).toBeInTheDocument();
    expect(screen.getByText('Group work went well today.')).toBeInTheDocument();
    expect(screen.getByText('Need to slow down on fractions.')).toBeInTheDocument();
  });

  it('adds a new reflection: POSTs the content and refreshes via onChange', async () => {
    const fetchMock = mockFetchRoutes({ '/api/reflections': { method: 'POST', body: { id: 'r3' } } });
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<ReflectionPanel reflections={[]} onChange={onChange} />, { authenticated: true });

    await user.click(screen.getByRole('button', { name: /add reflection/i }));
    await user.type(screen.getByPlaceholderText(/what went well/i), 'Learners engaged well with the fractions worksheet.');
    await user.click(screen.getByRole('button', { name: /save reflection/i }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const [, options] = fetchMock.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ content: 'Learners engaged well with the fractions worksheet.' });

    // Form closes back to idle after a successful save.
    expect(screen.queryByPlaceholderText(/what went well/i)).not.toBeInTheDocument();
  });

  it('refuses to save an empty reflection without calling the network', async () => {
    const fetchMock = mockFetchRoutes({ '/api/reflections': { method: 'POST', body: {} } });
    const user = userEvent.setup();
    renderWithProviders(<ReflectionPanel reflections={[]} onChange={vi.fn()} />, { authenticated: true });

    await user.click(screen.getByRole('button', { name: /add reflection/i }));
    await user.click(screen.getByRole('button', { name: /save reflection/i }));

    expect(await screen.findByText('Reflection cannot be empty.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('edits an existing reflection: pre-fills the form and PATCHes on save', async () => {
    const fetchMock = mockFetchRoutes({ '/api/reflections/r1': { method: 'PATCH', body: {} } });
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<ReflectionPanel reflections={REFLECTIONS} onChange={onChange} />, { authenticated: true });

    await user.click(screen.getAllByRole('button', { name: /^edit$/i })[0]);

    const textarea = screen.getByDisplayValue('Group work went well today.');
    await user.clear(textarea);
    await user.type(textarea, 'Group work went very well today.');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/reflections/r1');
    expect(options.method).toBe('PATCH');
    expect(JSON.parse(options.body)).toEqual({ content: 'Group work went very well today.' });
  });

  it('deletes a reflection only after the confirm step, then calls onChange', async () => {
    const fetchMock = mockFetchRoutes({ '/api/reflections/r1': { method: 'DELETE', body: {} } });
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<ReflectionPanel reflections={REFLECTIONS} onChange={onChange} />, { authenticated: true });

    await user.click(screen.getAllByRole('button', { name: /^delete$/i })[0]);
    expect(screen.getByText('Delete this reflection?')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled(); // not deleted yet, just asking

    await user.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/reflections/r1');
    expect(options.method).toBe('DELETE');
  });

  it('cancelling the delete confirmation makes no network call', async () => {
    const fetchMock = mockFetchRoutes({ '/api/reflections/r1': { method: 'DELETE', body: {} } });
    const user = userEvent.setup();
    renderWithProviders(<ReflectionPanel reflections={REFLECTIONS} onChange={vi.fn()} />, { authenticated: true });

    await user.click(screen.getAllByRole('button', { name: /^delete$/i })[0]);
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(screen.queryByText('Delete this reflection?')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows an error and keeps the form open when saving fails', async () => {
    const fetchMock = mockFetchRoutes({
      '/api/reflections': { method: 'POST', body: { error: 'Reflection service unavailable' }, ok: false, status: 503 },
    });
    const user = userEvent.setup();
    renderWithProviders(<ReflectionPanel reflections={[]} onChange={vi.fn()} />, { authenticated: true });

    await user.click(screen.getByRole('button', { name: /add reflection/i }));
    await user.type(screen.getByPlaceholderText(/what went well/i), 'A reflection that will fail to save.');
    await user.click(screen.getByRole('button', { name: /save reflection/i }));

    expect(await screen.findByText('Reflection service unavailable')).toBeInTheDocument();
    // Form stays open with the content intact so the teacher doesn't lose it.
    expect(screen.getByDisplayValue('A reflection that will fail to save.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
