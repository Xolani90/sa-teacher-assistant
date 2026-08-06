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
});
