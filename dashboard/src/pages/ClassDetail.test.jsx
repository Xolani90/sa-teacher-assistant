import { describe, it, expect, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders, screen, userEvent } from '../test/test-utils';
import ClassDetail from './ClassDetail';

/**
 * ClassDetail fires two independent requests on mount (GET .../detail and
 * GET .../snapshot, see the component's comment on why they're not
 * Promise.all'd). Routing responses by URL substring instead of call
 * order means these tests don't depend on which effect happens to run
 * first -- only on what each endpoint returns.
 */
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

const DETAIL = {
  class: { name: 'Grade 8 Mathematics', grade: 8, subject: 'Mathematics' },
  classHealth: { average: 74, passRate: 82, atRisk: 3, activeInterventions: 2 },
  curriculumCoverage: { dataAvailable: true, percentage: 63, remainingTopics: ['Trigonometry', 'Statistics'] },
  recentAssessments: [
    { assessmentId: 'a1', title: 'Term 2 Test', subject: 'Mathematics', term: 2, learnerCount: 28, classAverage: 71 },
  ],
  interventions: {
    summary: { evaluatedLearners: 28, insufficientData: 2 },
    priorityLearners: {
      high: [{ learnerId: 'L1', learnerName: 'Thabo Nkosi' }],
      medium: [{ learnerId: 'L2', learnerName: 'Naledi Dube' }],
      low: [],
    },
  },
  learners: [
    { learnerId: 'L1', learnerName: 'Thabo Nkosi', average: 45, assessmentCount: 3, passing: false },
    { learnerId: 'L2', learnerName: 'Naledi Dube', average: 68, assessmentCount: 4, passing: true },
  ],
};

const SNAPSHOT_OK = {
  metadata: { partial: false },
  snapshot: {
    analytics: { status: 'ok', data: { classSummary: { averageMastery: 70, averageCoverage: 63, averageProgress: 58 } } },
    intervention: { status: 'ok', data: { priorityCounts: { high: 1, medium: 1, low: 0 } } },
    qms: { status: 'unavailable' },
  },
};

function renderClassDetail(options) {
  return renderWithProviders(
    <Routes>
      <Route path="/classes/:classId" element={<ClassDetail />} />
      <Route path="/classes" element={<div>Classes list page</div>} />
    </Routes>,
    { route: '/classes/class-1', authenticated: true, ...options }
  );
}

describe('ClassDetail', () => {
  it('shows a loading spinner before the detail request resolves', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))); // never resolves
    renderClassDetail();
    expect(screen.getByText(/loading class/i)).toBeInTheDocument();
  });

  it('renders class header, health stats, coverage, assessments, and roster on success', async () => {
    mockFetchRoutes({
      '/detail': { body: DETAIL },
      '/snapshot': { body: SNAPSHOT_OK },
    });
    renderClassDetail();

    expect(await screen.findByText('Grade 8 Mathematics')).toBeInTheDocument();
    expect(screen.getByText(/Grade 8 · Mathematics · 2 learners/)).toBeInTheDocument();

    // Class health tiles.
    expect(screen.getByText('74%')).toBeInTheDocument(); // class average
    expect(screen.getByText('82%')).toBeInTheDocument(); // pass rate
    expect(screen.getByText('3')).toBeInTheDocument(); // at risk
    expect(screen.getByText('2')).toBeInTheDocument(); // active interventions

    // Curriculum coverage.
    expect(screen.getByText('63% of the ATP covered so far')).toBeInTheDocument();
    expect(screen.getByText(/Trigonometry, Statistics/)).toBeInTheDocument();

    // Recent assessments.
    expect(screen.getByText('Term 2 Test')).toBeInTheDocument();
    expect(screen.getByText('71% avg')).toBeInTheDocument();

    // Intervention priorities.
    expect(screen.getByText('High priority')).toBeInTheDocument();
    expect(screen.getByText('Medium priority')).toBeInTheDocument();

    // Roster (matched via the pill text, since "Thabo Nkosi" itself also
    // appears in the intervention-priorities list above).
    expect(screen.getByText('45% · 3 marks')).toBeInTheDocument();
    expect(screen.getByText('68% · 4 marks')).toBeInTheDocument();

    // Snapshot section loaded successfully alongside everything else.
    expect(screen.getByText('58%')).toBeInTheDocument(); // avg. progress from snapshot
  });

  it('shows an error banner when the detail request fails, without crashing the page', async () => {
    mockFetchRoutes({
      '/detail': { body: { error: 'Class not found' }, ok: false, status: 404 },
      '/snapshot': { body: SNAPSHOT_OK },
    });
    renderClassDetail();

    expect(await screen.findByText('Class not found')).toBeInTheDocument();
    expect(screen.queryByText('Grade 8 Mathematics')).not.toBeInTheDocument();
  });

  it('filters the roster as the teacher types in the search box', async () => {
    mockFetchRoutes({
      '/detail': { body: DETAIL },
      '/snapshot': { body: SNAPSHOT_OK },
    });
    const user = userEvent.setup();
    renderClassDetail();

    await screen.findByText('Grade 8 Mathematics');
    expect(screen.getByText('45% · 3 marks')).toBeInTheDocument();
    expect(screen.getByText('68% · 4 marks')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Search learners'), 'Naledi');

    expect(screen.queryByText('45% · 3 marks')).not.toBeInTheDocument();
    expect(screen.getByText('68% · 4 marks')).toBeInTheDocument();
  });

  it('keeps the rest of the page working when only the snapshot request fails', async () => {
    // Fault isolation per the component's own comment: the /detail and
    // /snapshot requests are deliberately not Promise.all'd so one
    // failing never blocks the other from rendering.
    mockFetchRoutes({
      '/detail': { body: DETAIL },
      '/snapshot': { body: { error: 'Snapshot service unavailable' }, ok: false, status: 503 },
    });
    renderClassDetail();

    expect(await screen.findByText('Grade 8 Mathematics')).toBeInTheDocument();
    // Roster still rendered fine.
    expect(screen.getByText('45% · 3 marks')).toBeInTheDocument();
    // Snapshot section shows its own error state instead of taking the
    // whole page down.
    expect(screen.getByText(/couldn't load the class snapshot/i)).toBeInTheDocument();
    expect(screen.getByText('Snapshot service unavailable')).toBeInTheDocument();
  });

  it('lets a teacher edit the class name/grade/subject via PATCH, then reloads', async () => {
    const fetchMock = mockFetchRoutes({
      '/detail': { body: DETAIL },
      '/snapshot': { body: SNAPSHOT_OK },
      '/classes/class-1': { body: { class: { ...DETAIL.class, name: 'Grade 8 Maths (renamed)' } } },
    });
    const user = userEvent.setup();
    renderClassDetail();

    await screen.findByText('Grade 8 Mathematics');
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    const nameInput = screen.getByLabelText('Class name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Grade 8 Maths (renamed)');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    // Edit form closes and detail is re-fetched (reloadDetail) after a
    // successful save — the mock's /detail route is static, so the
    // reload's actual server-echoed name is verified by the e2e test in
    // routes/api.js's test suite, not asserted again here.
    await screen.findByText('Grade 8 Mathematics');
    expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument();

    const detailCalls = fetchMock.mock.calls.filter(([url]) => url.includes('/detail'));
    expect(detailCalls.length).toBeGreaterThanOrEqual(2);

    const patchCall = fetchMock.mock.calls.find(([url, opts]) => opts?.method === 'PATCH');
    expect(patchCall).toBeTruthy();
    expect(patchCall[0]).toContain('/api/classes/class-1');
    expect(JSON.parse(patchCall[1].body)).toEqual({ name: 'Grade 8 Maths (renamed)', grade: 8, subject: 'Mathematics' });
  });

  it('rejects an empty name client-side without calling the API', async () => {
    mockFetchRoutes({
      '/detail': { body: DETAIL },
      '/snapshot': { body: SNAPSHOT_OK },
    });
    const user = userEvent.setup();
    renderClassDetail();

    await screen.findByText('Grade 8 Mathematics');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByLabelText('Class name'));
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(screen.getByText('Name cannot be empty.')).toBeInTheDocument();
  });

  it('deletes the class after confirmation and navigates back to the class list', async () => {
    mockFetchRoutes({
      '/detail': { body: DETAIL },
      '/snapshot': { body: SNAPSHOT_OK },
      '/classes/class-1': { body: null },
    });
    const user = userEvent.setup();
    renderClassDetail();

    await screen.findByText('Grade 8 Mathematics');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Delete this class?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Classes list page')).toBeInTheDocument();
  });

  it('surfaces the 409 dependent-record guard message instead of navigating away', async () => {
    mockFetchRoutes({
      '/detail': { body: DETAIL },
      '/snapshot': { body: SNAPSHOT_OK },
      '/classes/class-1': {
        body: { error: 'deleteClass: cannot delete class 1 — it still has 2 learner(s) linked to it.' },
        ok: false,
        status: 409,
      },
    });
    const user = userEvent.setup();
    renderClassDetail();

    await screen.findByText('Grade 8 Mathematics');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText(/it still has 2 learner\(s\) linked to it/)).toBeInTheDocument();
    expect(screen.queryByText('Classes list page')).not.toBeInTheDocument();
  });
});
