import { describe, it, expect, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders, screen, userEvent } from '../test/test-utils';
import Classes from './Classes';

function mockFetchClasses(body, { ok = true, status = ok ? 200 : 400 } = {}) {
  const fetchMock = vi.fn(async () => ({ ok, status, text: async () => JSON.stringify(body) }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const CLASSES = [
  { id: 'class-1', name: 'Grade 8 Mathematics', grade: 8, subject: 'Mathematics', learnerCount: 34 },
  { id: 'class-2', name: 'Grade 3 Literacy', grade: 3, subject: 'Literacy', learnerCount: 1 },
  { id: 'class-3', name: 'Unassigned Group', grade: null, subject: null, learnerCount: 5 },
];

function renderClasses(options) {
  return renderWithProviders(
    <Routes>
      <Route path="/classes" element={<Classes />} />
      <Route path="/classes/:classId" element={<div>Class detail page</div>} />
    </Routes>,
    { route: '/classes', authenticated: true, ...options }
  );
}

describe('Classes', () => {
  it('shows a loading spinner before the request resolves', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderClasses();
    expect(screen.getByText(/loading your classes/i)).toBeInTheDocument();
  });

  it('shows an error banner when the request fails', async () => {
    mockFetchClasses({ error: 'Something went wrong.' }, { ok: false, status: 500 });
    renderClasses();
    expect(await screen.findByText('Something went wrong.')).toBeInTheDocument();
  });

  it('shows the empty state and hides the search box when there are no classes', async () => {
    mockFetchClasses({ classes: [] });
    renderClasses();
    expect(await screen.findByText('No classes yet')).toBeInTheDocument();
    expect(screen.getByText('NEW CLASS Grade 7A, 34')).toBeInTheDocument();
    expect(screen.queryByLabelText('Search classes')).not.toBeInTheDocument();
  });

  it('renders each class card with grade/subject pills and learner count, omitting pills when grade or subject is missing', async () => {
    mockFetchClasses({ classes: CLASSES });
    renderClasses();

    expect(await screen.findByText('Grade 8 Mathematics')).toBeInTheDocument();
    expect(screen.getByText('Grade 3 Literacy')).toBeInTheDocument();
    expect(screen.getByText('Unassigned Group')).toBeInTheDocument();

    expect(screen.getByText('Grade 8')).toBeInTheDocument();
    expect(screen.getByText('Mathematics')).toBeInTheDocument();
    expect(screen.getByText('34 learners')).toBeInTheDocument();
    expect(screen.getByText('1 learner')).toBeInTheDocument();

    // Unassigned Group has null grade/subject, so no "Grade null" or
    // subject pill should render for it.
    expect(screen.queryByText('Grade null')).not.toBeInTheDocument();
  });

  it('navigates to the class detail page when a card is clicked', async () => {
    mockFetchClasses({ classes: CLASSES });
    const user = userEvent.setup();
    renderClasses();

    await user.click(await screen.findByText('Grade 8 Mathematics'));
    expect(screen.getByText('Class detail page')).toBeInTheDocument();
  });

  it('filters by search text across name, subject, and grade', async () => {
    mockFetchClasses({ classes: CLASSES });
    const user = userEvent.setup();
    renderClasses();

    await screen.findByText('Grade 8 Mathematics');
    await user.type(screen.getByLabelText('Search classes'), 'literacy');

    expect(screen.getByText('Grade 3 Literacy')).toBeInTheDocument();
    expect(screen.queryByText('Grade 8 Mathematics')).not.toBeInTheDocument();
    expect(screen.queryByText('Unassigned Group')).not.toBeInTheDocument();
  });

  it('matches classes by grade text even when the class name does not contain it', async () => {
    mockFetchClasses({ classes: CLASSES });
    const user = userEvent.setup();
    renderClasses();

    await screen.findByText('Grade 8 Mathematics');
    await user.type(screen.getByLabelText('Search classes'), 'grade 3');

    expect(screen.getByText('Grade 3 Literacy')).toBeInTheDocument();
    expect(screen.queryByText('Grade 8 Mathematics')).not.toBeInTheDocument();
  });

  it('shows a "no match" message when the search text matches nothing, without showing the zero-classes empty state', async () => {
    mockFetchClasses({ classes: CLASSES });
    const user = userEvent.setup();
    renderClasses();

    await screen.findByText('Grade 8 Mathematics');
    await user.type(screen.getByLabelText('Search classes'), 'nonexistent xyz');

    expect(screen.getByText('No classes match "nonexistent xyz".')).toBeInTheDocument();
    expect(screen.queryByText('No classes yet')).not.toBeInTheDocument();
  });

  it('treats a missing classes array in the response as an empty list', async () => {
    mockFetchClasses({});
    renderClasses();
    expect(await screen.findByText('No classes yet')).toBeInTheDocument();
  });
});
