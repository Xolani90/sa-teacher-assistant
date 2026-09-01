import { describe, it, expect, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders, screen, userEvent, waitFor } from '../test/test-utils';
import IncidentDetail from './IncidentDetail';

function mockFetchRoutes(routes) {
  const fetchMock = vi.fn(async (url, options = {}) => {
    const key = Object.keys(routes).find(
      (k) => url.includes(k) && (!routes[k].method || routes[k].method === (options.method || 'GET'))
    );
    if (!key) throw new Error(`Unmocked fetch in test: ${options.method || 'GET'} ${url}`);
    const { body, ok = true, status = ok ? 200 : 400 } = routes[key];
    return { ok, status, text: async () => JSON.stringify(body) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const INCIDENT = {
  id: 1,
  incidentDate: '2026-05-10',
  incidentTime: '10:30',
  incidentType: 'INJURY',
  description: 'Learner fell during break and scraped their knee.',
  actionTaken: 'Cleaned wound, applied plaster, informed parent via phone.',
  createdAt: '2026-05-10 11:00:00',
};

function renderDetail(options) {
  return renderWithProviders(
    <Routes>
      <Route path="/incidents/:incidentId" element={<IncidentDetail />} />
      <Route path="/incidents" element={<div>Incidents list page</div>} />
    </Routes>,
    { route: '/incidents/1', authenticated: true, ...options }
  );
}

describe('IncidentDetail', () => {
  it('shows a loading spinner before the request resolves', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderDetail();
    expect(screen.getByText(/loading incident/i)).toBeInTheDocument();
  });

  it('loads and displays the incident: date, time, type, description, and action taken', async () => {
    mockFetchRoutes({ '/api/incidents/1': { method: 'GET', body: { incident: INCIDENT } } });
    renderDetail();

    expect(await screen.findByText(/Incident on 10 May 2026/)).toBeInTheDocument();
    expect(screen.getByText(/10:30/)).toBeInTheDocument();
    expect(screen.getByText('Injury')).toBeInTheDocument();
    expect(screen.getByText('Learner fell during break and scraped their knee.')).toBeInTheDocument();
    expect(screen.getByText('Cleaned wound, applied plaster, informed parent via phone.')).toBeInTheDocument();
  });

  it('shows an error banner when the incident is missing (404, no existence oracle)', async () => {
    mockFetchRoutes({ '/api/incidents/1': { method: 'GET', body: { error: 'Incident not found' }, ok: false, status: 404 } });
    renderDetail();

    expect(await screen.findByText('Incident not found')).toBeInTheDocument();
    expect(screen.queryByText(/Incident on/)).not.toBeInTheDocument();
  });

  it('shows an error banner on a generic server failure', async () => {
    mockFetchRoutes({ '/api/incidents/1': { method: 'GET', body: { error: 'Internal server error' }, ok: false, status: 500 } });
    renderDetail();

    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
  });

  it('navigates back to the Incident Book when the back button is clicked', async () => {
    mockFetchRoutes({ '/api/incidents/1': { method: 'GET', body: { incident: INCIDENT } } });
    const user = userEvent.setup();
    renderDetail();

    await screen.findByText(/Incident on 10 May 2026/);
    await user.click(screen.getByRole('button', { name: /back to incident book/i }));

    expect(screen.getByText('Incidents list page')).toBeInTheDocument();
  });

  it('opens the edit form pre-filled with the current incident values', async () => {
    mockFetchRoutes({ '/api/incidents/1': { method: 'GET', body: { incident: INCIDENT } } });
    const user = userEvent.setup();
    renderDetail();

    await screen.findByText(/Incident on 10 May 2026/);
    await user.click(screen.getByRole('button', { name: /^edit$/i }));

    expect(screen.getByText('Edit Incident')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Learner fell during break and scraped their knee.')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Cleaned wound, applied plaster, informed parent via phone.')).toBeInTheDocument();
  });

  it('saves an edit: PATCHes /api/incidents/:id and updates the displayed incident', async () => {
    const fetchMock = mockFetchRoutes({
      '/api/incidents/1': {
        method: 'GET',
        body: { incident: INCIDENT },
      },
    });
    // Override to distinguish GET vs PATCH on the same URL.
    fetchMock.mockImplementation(async (url, options = {}) => {
      const method = options.method || 'GET';
      if (method === 'PATCH') {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ incident: { ...INCIDENT, description: 'Updated description text.' } }),
        };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ incident: INCIDENT }) };
    });

    const user = userEvent.setup();
    renderDetail();

    await screen.findByText(/Incident on 10 May 2026/);
    await user.click(screen.getByRole('button', { name: /^edit$/i }));

    const textarea = screen.getByDisplayValue('Learner fell during break and scraped their knee.');
    await user.clear(textarea);
    await user.type(textarea, 'Updated description text.');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([, opts]) => opts?.method === 'PATCH');
      expect(patchCall).toBeTruthy();
    });
    const [url, options] = fetchMock.mock.calls.find(([, opts]) => opts?.method === 'PATCH');
    expect(url).toContain('/api/incidents/1');
    expect(JSON.parse(options.body).description).toBe('Updated description text.');

    // Re-renders from the PATCH response, back to read-only view.
    expect(await screen.findByText('Updated description text.')).toBeInTheDocument();
    expect(screen.queryByText('Edit Incident')).not.toBeInTheDocument();
  });

  it('shows an error and keeps the edit form open when saving fails', async () => {
    const fetchMock = vi.fn(async (url, options = {}) => {
      const method = options.method || 'GET';
      if (method === 'PATCH') {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({ error: 'updateIncident: description is required' }),
        };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ incident: INCIDENT }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderDetail();

    await screen.findByText(/Incident on 10 May 2026/);
    await user.click(screen.getByRole('button', { name: /^edit$/i }));
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText('updateIncident: description is required')).toBeInTheDocument();
    // Form stays open so the teacher doesn't lose their edits.
    expect(screen.getByText('Edit Incident')).toBeInTheDocument();
  });

  it('cancelling the edit form discards changes and returns to the read-only view', async () => {
    mockFetchRoutes({ '/api/incidents/1': { method: 'GET', body: { incident: INCIDENT } } });
    const user = userEvent.setup();
    renderDetail();

    await screen.findByText(/Incident on 10 May 2026/);
    await user.click(screen.getByRole('button', { name: /^edit$/i }));

    const textarea = screen.getByDisplayValue('Learner fell during break and scraped their knee.');
    await user.clear(textarea);
    await user.type(textarea, 'A change that should be discarded.');
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(screen.queryByText('Edit Incident')).not.toBeInTheDocument();
    // Original content still shown, unaffected by the discarded edit.
    expect(screen.getByText('Learner fell during break and scraped their knee.')).toBeInTheDocument();
  });
});
