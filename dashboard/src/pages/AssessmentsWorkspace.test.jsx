import { describe, it, expect, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders, screen, userEvent } from '../test/test-utils';
import AssessmentsWorkspace from './AssessmentsWorkspace';

const ALL_ASSESSMENTS = [
  {
    id: 1,
    title: 'Fractions Test',
    subject: 'Mathematics',
    grade: 7,
    createdAt: '2026-05-10',
    class: { id: 10, name: '7A' },
    learnerCount: 20,
    classAverage: 64.5,
    passRate: 75,
  },
  {
    id: 2,
    title: 'Reading Comprehension',
    subject: 'Literacy',
    grade: 3,
    createdAt: '2026-05-12',
    class: { id: 11, name: '3B' },
    learnerCount: 18,
    classAverage: 70,
    passRate: 88,
  },
  {
    id: 3,
    title: null,
    subject: 'Mathematics',
    grade: 7,
    createdAt: '2026-05-14',
    class: null,
    learnerCount: 0,
    classAverage: null,
    passRate: null,
  },
];

function mockFetchAssessments(fixture = ALL_ASSESSMENTS, { ok = true, status = ok ? 200 : 400 } = {}) {
  const fetchMock = vi.fn(async (url) => {
    if (!ok) return { ok, status, text: async () => JSON.stringify({ error: 'Something went wrong.' }) };
    const params = new URL(url, 'http://localhost').searchParams;
    const grade = params.get('grade');
    const subject = params.get('subject');
    const assessments = fixture.filter(
      (a) => (!grade || String(a.grade) === grade) && (!subject || a.subject === subject)
    );
    return { ok: true, status: 200, text: async () => JSON.stringify({ assessments }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderWorkspace(options) {
  return renderWithProviders(
    <Routes>
      <Route path="/assessments" element={<AssessmentsWorkspace />} />
      <Route path="/assessments/:assessmentId" element={<div>Assessment detail page</div>} />
    </Routes>,
    { route: '/assessments', authenticated: true, ...options }
  );
}

describe('AssessmentsWorkspace', () => {
  it('shows a loading spinner before the request resolves', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderWorkspace();
    expect(screen.getByText(/loading your assessments/i)).toBeInTheDocument();
  });

  it('shows an error banner when the request fails', async () => {
    mockFetchAssessments(undefined, { ok: false, status: 500 });
    renderWorkspace();
    expect(await screen.findByText('Something went wrong.')).toBeInTheDocument();
  });

  it('shows the empty state when there are no assessments at all', async () => {
    mockFetchAssessments([]);
    renderWorkspace();
    expect(await screen.findByText('No assessments saved yet')).toBeInTheDocument();
  });

  it('renders each assessment row, falling back to "Untitled assessment" when the title is missing', async () => {
    mockFetchAssessments();
    renderWorkspace();

    expect(await screen.findByText('Fractions Test')).toBeInTheDocument();
    expect(screen.getByText('Reading Comprehension')).toBeInTheDocument();
    expect(screen.getByText('Untitled assessment')).toBeInTheDocument();

    expect(screen.getByText('Avg 64.5%')).toBeInTheDocument();
    expect(screen.getByText('Pass 75%')).toBeInTheDocument();
  });

  it('does not render class average/pass rate pills when they are unavailable, using an honest empty state instead of invented data', async () => {
    mockFetchAssessments();
    renderWorkspace();

    await screen.findByText('Fractions Test');
    // Row 3 has classAverage/passRate null — its card should render
    // without any Avg/Pass pill at all.
    expect(screen.queryByText('Avg null%')).not.toBeInTheDocument();
    expect(screen.queryByText('Pass null%')).not.toBeInTheDocument();
  });

  it('navigates to the existing assessment detail page when a row is clicked', async () => {
    mockFetchAssessments();
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(await screen.findByText('Fractions Test'));
    expect(screen.getByText('Assessment detail page')).toBeInTheDocument();
  });

  it('filters client-side by search text across title, class, and subject', async () => {
    mockFetchAssessments();
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText('Fractions Test');
    await user.type(screen.getByLabelText('Search assessments'), 'literacy');

    expect(screen.getByText('Reading Comprehension')).toBeInTheDocument();
    expect(screen.queryByText('Fractions Test')).not.toBeInTheDocument();
  });

  it('shows a "no match" message when the search text matches nothing, without showing the zero-assessments empty state', async () => {
    mockFetchAssessments();
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText('Fractions Test');
    await user.type(screen.getByLabelText('Search assessments'), 'nonexistent subject xyz');

    expect(screen.getByText('No assessments match "nonexistent subject xyz".')).toBeInTheDocument();
    expect(screen.queryByText('No assessments saved yet')).not.toBeInTheDocument();
  });

  it('re-fetches with the grade query param when the grade filter changes', async () => {
    const fetchMock = mockFetchAssessments();
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText('Fractions Test');
    fetchMock.mockClear();
    await user.selectOptions(screen.getByLabelText('Filter by grade'), '3');

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('grade=3'), expect.anything());
    await screen.findByText('Reading Comprehension');
    expect(screen.queryByText('Fractions Test')).not.toBeInTheDocument();
  });

  it('re-fetches with the subject query param when the subject filter changes', async () => {
    const fetchMock = mockFetchAssessments();
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText('Fractions Test');
    fetchMock.mockClear();
    await user.selectOptions(screen.getByLabelText('Filter by subject'), 'Literacy');

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('subject=Literacy'), expect.anything());
    await screen.findByText('Reading Comprehension');
    expect(screen.queryByText('Fractions Test')).not.toBeInTheDocument();
  });
});
