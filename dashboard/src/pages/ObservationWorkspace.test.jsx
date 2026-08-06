import { describe, it, expect, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders, screen, userEvent } from '../test/test-utils';
import ObservationWorkspace from './ObservationWorkspace';

const ALL_OBSERVATIONS = [
  { id: 'obs1', assessmentName: 'Reading Circle', subject: 'Literacy', grade: 3, createdAt: '2026-05-10', learnerCount: 1 },
  { id: 'obs2', assessmentName: 'Fractions Check-in', subject: 'Mathematics', grade: 8, createdAt: '2026-05-12', learnerCount: 4 },
  { id: 'obs3', assessmentName: null, subject: 'Mathematics', grade: 8, createdAt: '2026-05-14', learnerCount: 2 },
];

/**
 * Mimics the real server contract: honors ?grade= and ?subject= query
 * params against the full fixture set, same as
 * observationRepository.getObservationHistory would. This lets tests
 * assert on the request itself (was the right query string sent) as
 * well as on what got rendered from the (correctly pre-filtered)
 * response — the page's own client-side text search is layered on top
 * of whatever the server already filtered.
 */
function mockFetchObservations(fixture = ALL_OBSERVATIONS, { ok = true, status = ok ? 200 : 400 } = {}) {
  const fetchMock = vi.fn(async (url) => {
    if (!ok) return { ok, status, text: async () => JSON.stringify({ error: 'Something went wrong.' }) };
    const params = new URL(url, 'http://localhost').searchParams;
    const grade = params.get('grade');
    const subject = params.get('subject');
    const observations = fixture.filter(
      (o) => (!grade || String(o.grade) === grade) && (!subject || o.subject === subject)
    );
    return { ok: true, status: 200, text: async () => JSON.stringify({ observations }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderWorkspace(options) {
  return renderWithProviders(
    <Routes>
      <Route path="/observations" element={<ObservationWorkspace />} />
      <Route path="/observations/:assessmentId" element={<div>Observation detail page</div>} />
    </Routes>,
    { route: '/observations', authenticated: true, ...options }
  );
}

describe('ObservationWorkspace', () => {
  it('shows a loading spinner before the request resolves', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderWorkspace();
    expect(screen.getByText(/loading observations/i)).toBeInTheDocument();
  });

  it('shows an error banner when the request fails', async () => {
    mockFetchObservations(undefined, { ok: false, status: 500 });
    renderWorkspace();
    expect(await screen.findByText('Something went wrong.')).toBeInTheDocument();
  });

  it('shows the empty state when there are no observations at all', async () => {
    mockFetchObservations([]);
    renderWorkspace();
    expect(await screen.findByText('No observations yet')).toBeInTheDocument();
    expect(screen.getByText('MY OBSERVATIONS')).toBeInTheDocument();
  });

  it('renders each observation row, falling back to "Observation session" when the name is missing', async () => {
    mockFetchObservations();
    renderWorkspace();

    expect(await screen.findByText('Reading Circle')).toBeInTheDocument();
    expect(screen.getByText('Fractions Check-in')).toBeInTheDocument();
    expect(screen.getByText('Observation session')).toBeInTheDocument(); // obs3, null name

    expect(screen.getByText('1 learner')).toBeInTheDocument();
    expect(screen.getByText('4 learners')).toBeInTheDocument();
  });

  it('navigates to the observation detail page when a row is clicked', async () => {
    mockFetchObservations();
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(await screen.findByText('Reading Circle'));
    expect(screen.getByText('Observation detail page')).toBeInTheDocument();
  });

  it('filters client-side by search text across name, subject, and grade', async () => {
    mockFetchObservations();
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText('Reading Circle');
    await user.type(screen.getByLabelText('Search observations'), 'literacy');

    expect(screen.getByText('Reading Circle')).toBeInTheDocument();
    expect(screen.queryByText('Fractions Check-in')).not.toBeInTheDocument();
  });

  it('shows a "no match" message when the search text matches nothing, without showing the zero-observations empty state', async () => {
    mockFetchObservations();
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText('Reading Circle');
    await user.type(screen.getByLabelText('Search observations'), 'nonexistent subject xyz');

    expect(screen.getByText('No observations match "nonexistent subject xyz".')).toBeInTheDocument();
    expect(screen.queryByText('No observations yet')).not.toBeInTheDocument();
  });

  it('re-fetches with the grade query param when the grade filter changes, and populates its own options from the loaded data', async () => {
    const fetchMock = mockFetchObservations();
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText('Reading Circle');
    // Options are derived from the currently loaded set, deduped and sorted.
    expect(screen.getByRole('option', { name: 'Grade 3' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Grade 8' })).toBeInTheDocument();

    fetchMock.mockClear();
    await user.selectOptions(screen.getByLabelText('Filter by grade'), '8');

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('grade=8'), expect.anything());
    await screen.findByText('Fractions Check-in');
    expect(screen.queryByText('Reading Circle')).not.toBeInTheDocument();
  });

  it('re-fetches with the subject query param when the subject filter changes', async () => {
    const fetchMock = mockFetchObservations();
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText('Reading Circle');
    fetchMock.mockClear();
    await user.selectOptions(screen.getByLabelText('Filter by subject'), 'Literacy');

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('subject=Literacy'), expect.anything());
    await screen.findByText('Reading Circle');
    expect(screen.queryByText('Fractions Check-in')).not.toBeInTheDocument();
  });
});
