import { describe, it, expect, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders, screen, userEvent, waitFor } from '../test/test-utils';
import IncidentsWorkspace from './IncidentsWorkspace';

/**
 * Mimics the real server contract for GET /api/incidents: honors
 * incidentType/fromDate/toDate query params against the full fixture
 * set, same convention as ObservationWorkspace.test.jsx's
 * mockFetchObservations. Non-GET requests (the create form's POST) are
 * routed through the same mock so a single stub covers the whole page.
 */
function mockFetchIncidents(fixture = INCIDENTS, { ok = true, status = ok ? 200 : 400 } = {}) {
  const fetchMock = vi.fn(async (url, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'POST') {
      return { ok: true, status: 201, text: async () => JSON.stringify({ incident: { id: 'new1' } }) };
    }
    if (!ok) return { ok, status, text: async () => JSON.stringify({ error: 'Something went wrong.' }) };
    const params = new URL(url, 'http://localhost').searchParams;
    const incidentType = params.get('incidentType');
    const fromDate = params.get('fromDate');
    const toDate = params.get('toDate');
    const incidents = fixture.filter(
      (i) =>
        (!incidentType || i.incidentType === incidentType) &&
        (!fromDate || i.incidentDate >= fromDate) &&
        (!toDate || i.incidentDate <= toDate)
    );
    return { ok: true, status: 200, text: async () => JSON.stringify({ incidents }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const INCIDENTS = [
  {
    id: 1,
    incidentDate: '2026-05-10',
    incidentTime: '10:30',
    incidentType: 'INJURY',
    description: 'Learner fell during break and scraped their knee.',
    actionTaken: 'Cleaned wound, applied plaster, informed parent via phone.',
    createdAt: '2026-05-10 11:00:00',
  },
  {
    id: 2,
    incidentDate: '2026-05-12',
    incidentTime: '13:15',
    incidentType: 'DISCIPLINE',
    description: 'Two learners arguing during group work.',
    actionTaken: 'Separated learners, spoke to both individually.',
    createdAt: '2026-05-12 13:45:00',
  },
];

function renderWorkspace(options) {
  return renderWithProviders(
    <Routes>
      <Route path="/incidents" element={<IncidentsWorkspace />} />
      <Route path="/incidents/:incidentId" element={<div>Incident detail page</div>} />
    </Routes>,
    { route: '/incidents', authenticated: true, ...options }
  );
}

describe('IncidentsWorkspace', () => {
  it('renders the page heading', async () => {
    mockFetchIncidents();
    renderWorkspace();
    expect(await screen.findByRole('heading', { name: 'Incident Book' })).toBeInTheDocument();
  });

  it('shows a loading spinner before the request resolves', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderWorkspace();
    expect(screen.getByText(/loading incidents/i)).toBeInTheDocument();
  });

  it('loads incidents from GET /api/incidents on mount', async () => {
    const fetchMock = mockFetchIncidents();
    renderWorkspace();
    await screen.findByText(/Learner fell during break/);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/incidents'), expect.anything());
  });

  it('shows an error banner when the request fails', async () => {
    mockFetchIncidents(undefined, { ok: false, status: 500 });
    renderWorkspace();
    expect(await screen.findByText('Something went wrong.')).toBeInTheDocument();
  });

  it('shows the empty state when there are no incidents at all', async () => {
    mockFetchIncidents([]);
    renderWorkspace();
    expect(await screen.findByText('No incidents logged yet')).toBeInTheDocument();
  });

  it('renders each incident row with its truncated description, date, time, and type pill', async () => {
    mockFetchIncidents();
    renderWorkspace();

    expect(await screen.findByText(/Learner fell during break/)).toBeInTheDocument();
    expect(screen.getByText(/Two learners arguing/)).toBeInTheDocument();

    // Date + time
    expect(screen.getByText(/10 May 2026/)).toBeInTheDocument();
    expect(screen.getByText(/10:30/)).toBeInTheDocument();
    expect(screen.getByText(/13:15/)).toBeInTheDocument();

    // Incident type labels (mapped from the raw type id), shown as pills
    // on each row — scoped with a selector since "Injury"/"Discipline /
    // Behaviour" also appear as <option> text in the type filter dropdown.
    expect(screen.getByText('Injury', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Discipline / Behaviour', { selector: 'span' })).toBeInTheDocument();
  });

  it('navigates to the incident detail page when a row is clicked', async () => {
    mockFetchIncidents();
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(await screen.findByText(/Learner fell during break/));
    expect(screen.getByText('Incident detail page')).toBeInTheDocument();
  });

  it('filters client-side by search text across description and action taken', async () => {
    mockFetchIncidents();
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText(/Learner fell during break/);
    await user.type(screen.getByLabelText('Search incidents'), 'plaster');

    expect(screen.getByText(/Learner fell during break/)).toBeInTheDocument();
    expect(screen.queryByText(/Two learners arguing/)).not.toBeInTheDocument();
  });

  it('shows a "no match" message when the search text matches nothing, without showing the zero-incidents empty state', async () => {
    mockFetchIncidents();
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText(/Learner fell during break/);
    await user.type(screen.getByLabelText('Search incidents'), 'nonexistent xyz');

    expect(screen.getByText('No incidents match "nonexistent xyz".')).toBeInTheDocument();
    expect(screen.queryByText('No incidents logged yet')).not.toBeInTheDocument();
  });

  it('re-fetches with the incidentType query param when the type filter changes', async () => {
    const fetchMock = mockFetchIncidents();
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText(/Learner fell during break/);
    fetchMock.mockClear();
    await user.selectOptions(screen.getByLabelText('Filter by incident type'), 'DISCIPLINE');

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('incidentType=DISCIPLINE'), expect.anything())
    );
    await screen.findByText(/Two learners arguing/);
    expect(screen.queryByText(/Learner fell during break/)).not.toBeInTheDocument();
  });

  it('opens the create form, submits it, and reloads the list on success', async () => {
    const fetchMock = mockFetchIncidents();
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText(/Learner fell during break/);
    await user.click(screen.getByRole('button', { name: /log incident/i }));

    expect(screen.getByText('Log a New Incident')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('What happened?'), 'A learner felt unwell during class.');
    await user.type(
      screen.getByPlaceholderText('What was done in response?'),
      'Sent to the office and called the parent.'
    );
    await user.selectOptions(screen.getByDisplayValue('Select a type…'), 'HEALTH');

    fetchMock.mockClear();
    await user.click(screen.getByRole('button', { name: /save incident/i }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([, opts]) => opts?.method === 'POST');
      expect(postCall).toBeTruthy();
    });
    const [, postOptions] = fetchMock.mock.calls.find(([, opts]) => opts?.method === 'POST');
    const body = JSON.parse(postOptions.body);
    expect(body.description).toBe('A learner felt unwell during class.');
    expect(body.actionTaken).toBe('Sent to the office and called the parent.');
    expect(body.incidentType).toBe('HEALTH');

    // Form closes back to idle after a successful save, and the list re-fetches.
    await waitFor(() => expect(screen.queryByText('Log a New Incident')).not.toBeInTheDocument());
  });

  it('shows an error and keeps the form open when creating an incident fails', async () => {
    const fetchMock = vi.fn(async (url, options = {}) => {
      if ((options.method || 'GET') === 'POST') {
        return { ok: false, status: 400, text: async () => JSON.stringify({ error: 'createIncident: description is required' }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ incidents: INCIDENTS }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText(/Learner fell during break/);
    await user.click(screen.getByRole('button', { name: /log incident/i }));
    await user.click(screen.getByRole('button', { name: /save incident/i }));

    expect(await screen.findByText('createIncident: description is required')).toBeInTheDocument();
    expect(screen.getByText('Log a New Incident')).toBeInTheDocument();
  });
});
