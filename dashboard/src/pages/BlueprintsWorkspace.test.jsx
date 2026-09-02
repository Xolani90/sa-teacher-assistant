import { describe, it, expect, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders, screen, userEvent, waitFor } from '../test/test-utils';
import BlueprintsWorkspace from './BlueprintsWorkspace';

/**
 * Mimics the real server contract for GET /api/blueprints — a plain
 * fetch-on-mount with no server-side query params for this page (search
 * is client-side, same convention as ResourcesWorkspace.jsx), same
 * mocking convention as IncidentsWorkspace.test.jsx's mockFetchIncidents.
 */
function mockFetchBlueprints(fixture = BLUEPRINTS, { ok = true, status = ok ? 200 : 400 } = {}) {
  const fetchMock = vi.fn(async (url) => {
    if (!ok) return { ok, status, text: async () => JSON.stringify({ error: 'Something went wrong.' }) };
    return { ok: true, status: 200, text: async () => JSON.stringify({ blueprints: fixture }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const BLUEPRINTS = [
  {
    id: 1,
    title: 'Term 2 Fractions Test',
    subject: 'Mathematics',
    grade: 7,
    term: 2,
    totalMarks: 50,
    version: 1,
    status: 'draft',
    questionCount: 4,
    updatedAt: '2026-08-01 08:00:00',
  },
  {
    id: 2,
    title: 'Term 1 Reading Comprehension',
    subject: 'English',
    grade: 5,
    term: 1,
    totalMarks: 30,
    version: 1,
    status: 'published',
    questionCount: 3,
    updatedAt: '2026-06-15 09:00:00',
  },
];

function renderWorkspace(options) {
  return renderWithProviders(
    <Routes>
      <Route path="/blueprints" element={<BlueprintsWorkspace />} />
      <Route path="/blueprints/:blueprintId" element={<div>Blueprint detail page</div>} />
    </Routes>,
    { route: '/blueprints', authenticated: true, ...options }
  );
}

describe('BlueprintsWorkspace', () => {
  it('renders the page heading', async () => {
    mockFetchBlueprints();
    renderWorkspace();
    expect(await screen.findByRole('heading', { name: 'Assessment Blueprints' })).toBeInTheDocument();
  });

  it('shows a loading spinner before the request resolves', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderWorkspace();
    expect(screen.getByText(/loading your assessment blueprints/i)).toBeInTheDocument();
  });

  it('loads blueprints from GET /api/blueprints on mount', async () => {
    const fetchMock = mockFetchBlueprints();
    renderWorkspace();
    await screen.findByText('Term 2 Fractions Test');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/blueprints'), expect.anything());
  });

  it('shows an error banner when the request fails', async () => {
    mockFetchBlueprints(undefined, { ok: false, status: 500 });
    renderWorkspace();
    expect(await screen.findByText('Something went wrong.')).toBeInTheDocument();
  });

  it('shows the empty state when there are no blueprints at all', async () => {
    mockFetchBlueprints([]);
    renderWorkspace();
    expect(await screen.findByText('No assessment blueprints yet')).toBeInTheDocument();
  });

  it('renders each blueprint row with subject, grade, marks, question count, and status', async () => {
    mockFetchBlueprints();
    renderWorkspace();

    expect(await screen.findByText('Term 2 Fractions Test')).toBeInTheDocument();
    expect(screen.getByText('Term 1 Reading Comprehension')).toBeInTheDocument();

    expect(screen.getByText(/Mathematics/)).toBeInTheDocument();
    expect(screen.getByText(/Grade 7/)).toBeInTheDocument();
    expect(screen.getByText(/50 marks/)).toBeInTheDocument();
    expect(screen.getByText('4 questions')).toBeInTheDocument();
    expect(screen.getByText('draft')).toBeInTheDocument();
    expect(screen.getByText('published')).toBeInTheDocument();
  });

  it('navigates to the blueprint detail page when a row is clicked', async () => {
    mockFetchBlueprints();
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(await screen.findByText('Term 2 Fractions Test'));
    expect(screen.getByText('Blueprint detail page')).toBeInTheDocument();
  });

  it('filters client-side by search text across title/subject/grade', async () => {
    mockFetchBlueprints();
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText('Term 2 Fractions Test');
    await user.type(screen.getByLabelText('Search assessment blueprints'), 'fractions');

    expect(screen.getByText('Term 2 Fractions Test')).toBeInTheDocument();
    expect(screen.queryByText('Term 1 Reading Comprehension')).not.toBeInTheDocument();
  });

  it('shows a "no match" message when the search text matches nothing, without showing the zero-blueprints empty state', async () => {
    mockFetchBlueprints();
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText('Term 2 Fractions Test');
    await user.type(screen.getByLabelText('Search assessment blueprints'), 'nonexistent xyz');

    await waitFor(() => {
      expect(screen.getByText('No blueprints match "nonexistent xyz".')).toBeInTheDocument();
    });
    expect(screen.queryByText('No assessment blueprints yet')).not.toBeInTheDocument();
  });
});
