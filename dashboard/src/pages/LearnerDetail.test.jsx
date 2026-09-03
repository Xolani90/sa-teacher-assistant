import { describe, it, expect, vi } from 'vitest';
import { Route, Routes, useNavigate } from 'react-router-dom';
import { renderWithProviders, screen, userEvent } from '../test/test-utils';
import LearnerDetail from './LearnerDetail';

function GoToLearner2Button() {
  const navigate = useNavigate();
  return <button onClick={() => navigate('/learners/learner-2')}>go</button>;
}

function mockFetchDetail(body, { ok = true, status = ok ? 200 : 400 } = {}) {
  const fetchMock = vi.fn(async () => ({ ok, status, text: async () => JSON.stringify(body) }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const BASE_DETAIL = {
  learner: { name: 'Naledi Dube', className: 'Grade 8 Mathematics', grade: 8, classId: 'class-1' },
  performance: { overallAverage: 68, passRate: 75, trend: 'improving' },
  assessmentHistory: [{ resultId: 'res1', title: 'Term 2 Test', subject: 'Mathematics', term: 2, percentage: 71 }],
  curriculumCoverage: {
    dataAvailable: true,
    bySubject: [
      { subject: 'Mathematics', dataAvailable: true, averagePercentage: 63 },
      { subject: 'Science', dataAvailable: false },
    ],
  },
  interventions: {
    plans: [
      { subject: 'Mathematics', priority: 'high' },
      { subject: 'Science', priority: 'low' },
      { subject: 'English', priority: 'medium' },
    ],
  },
  observations: {
    totalSessions: 2,
    recent: [{ assessmentId: 'obs1', title: 'Observation 1', createdAt: '2026-05-01' }],
  },
  recommendedActions: ['Review fractions with Naledi', 'Schedule a follow-up assessment'],
};

function renderLearnerDetail(options) {
  return renderWithProviders(
    <Routes>
      <Route path="/learners/:learnerId" element={<LearnerDetail />} />
      <Route path="/classes" element={<div>Classes list page</div>} />
      <Route path="/classes/:classId" element={<div>Class detail page</div>} />
      <Route path="/observations/:assessmentId" element={<div>Observation detail page</div>} />
    </Routes>,
    { route: '/learners/learner-1', authenticated: true, ...options }
  );
}

describe('LearnerDetail', () => {
  it('shows a loading spinner before the request resolves', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderLearnerDetail();
    expect(screen.getByText(/loading learner/i)).toBeInTheDocument();
  });

  it('shows an error banner when the request fails', async () => {
    mockFetchDetail({ error: 'Learner not found' }, { ok: false, status: 404 });
    renderLearnerDetail();
    expect(await screen.findByText('Learner not found')).toBeInTheDocument();
    expect(screen.queryByText('Naledi Dube')).not.toBeInTheDocument();
  });

  it('renders header, KPIs, assessment history, coverage, interventions, observations, and recommendations', async () => {
    mockFetchDetail(BASE_DETAIL);
    renderLearnerDetail();

    expect(await screen.findByText('Naledi Dube')).toBeInTheDocument();
    expect(screen.getByText('Grade 8 Mathematics · Grade 8')).toBeInTheDocument();

    // KPIs.
    expect(screen.getByText('68%')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('Improving')).toBeInTheDocument();

    // Assessment history.
    expect(screen.getByText('Term 2 Test')).toBeInTheDocument();
    expect(screen.getByText('71%')).toBeInTheDocument();

    // Curriculum coverage: one subject with data, one without.
    expect(screen.getByText('63% covered')).toBeInTheDocument();
    expect(screen.getByText('No data yet')).toBeInTheDocument();

    // Interventions: high and medium show, low is filtered out entirely.
    expect(screen.getByText('High priority')).toBeInTheDocument();
    expect(screen.getByText('Medium priority')).toBeInTheDocument();
    expect(screen.queryByText('Low priority')).not.toBeInTheDocument();
    // "Science" only appears in the coverage row above (as "No data
    // yet"), never as a low-priority intervention card.
    expect(screen.getAllByText('Science')).toHaveLength(1);

    // Observations.
    expect(screen.getByText('Observation 1')).toBeInTheDocument();

    // Recommended actions.
    expect(screen.getByText('Review fractions with Naledi')).toBeInTheDocument();
    expect(screen.getByText('Schedule a follow-up assessment')).toBeInTheDocument();
  });

  it('navigates to the observation detail page when an observation card is clicked', async () => {
    mockFetchDetail(BASE_DETAIL);
    const user = userEvent.setup();
    renderLearnerDetail();

    await user.click(await screen.findByText('Observation 1'));
    expect(screen.getByText('Observation detail page')).toBeInTheDocument();
  });

  it('back button goes to the learner\'s class when classId is present', async () => {
    mockFetchDetail(BASE_DETAIL);
    const user = userEvent.setup();
    renderLearnerDetail();

    const backButton = await screen.findByRole('button', { name: /back to grade 8 mathematics/i });
    await user.click(backButton);
    expect(screen.getByText('Class detail page')).toBeInTheDocument();
  });

  it('back button falls back to the classes list when the learner has no classId', async () => {
    mockFetchDetail({
      ...BASE_DETAIL,
      learner: { name: 'Unassigned Learner', className: null, grade: null, classId: null },
    });
    const user = userEvent.setup();
    renderLearnerDetail();

    const backButton = await screen.findByRole('button', { name: /back to class/i });
    await user.click(backButton);
    expect(screen.getByText('Classes list page')).toBeInTheDocument();
  });

  it('shows a "—" for the trend KPI when the trend value is unrecognized', async () => {
    mockFetchDetail({ ...BASE_DETAIL, performance: { ...BASE_DETAIL.performance, trend: 'made-up-value' } });
    renderLearnerDetail();
    await screen.findByText('Naledi Dube');
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows empty states when history, coverage, interventions, observations, and recommendations are all empty', async () => {
    mockFetchDetail({
      learner: { name: 'New Learner', className: 'Grade 8 Mathematics', grade: 8, classId: 'class-1' },
      performance: { overallAverage: null, passRate: null, trend: 'insufficient-data' },
      assessmentHistory: [],
      curriculumCoverage: { dataAvailable: false, bySubject: [] },
      interventions: { plans: [] },
      observations: { totalSessions: 0, recent: [] },
      recommendedActions: [],
    });
    renderLearnerDetail();

    await screen.findByText('New Learner');
    expect(screen.getByText('No assessments yet')).toBeInTheDocument();
    expect(screen.getByText('Coverage data will appear after your first blueprint assessment.')).toBeInTheDocument();
    expect(screen.getByText('Nothing urgent right now')).toBeInTheDocument();
    expect(screen.getByText('No observations recorded yet')).toBeInTheDocument();
    expect(screen.getByText('No recommendations yet')).toBeInTheDocument();
    expect(screen.getByText('Not enough data yet')).toBeInTheDocument(); // insufficient-data trend label
  });

  it('does not let a slow-resolving request for a previous learner overwrite the current learner after rapid navigation', async () => {
    // Two deferred fetches: learner-1's resolves LAST even though it was
    // requested first, simulating network reordering during rapid
    // back-to-back navigation between two learner detail pages.
    let resolveLearner1;
    const learner1Promise = new Promise((res) => { resolveLearner1 = res; });
    const fetchMock = vi.fn((url) => {
      if (url.includes('learner-1')) {
        return learner1Promise.then(() => ({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ...BASE_DETAIL, learner: { ...BASE_DETAIL.learner, name: 'Naledi Dube' } }),
        }));
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ...BASE_DETAIL, learner: { ...BASE_DETAIL.learner, name: 'Sipho Nkosi', classId: 'class-2' } }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(
      <>
        <GoToLearner2Button />
        <Routes>
          <Route path="/learners/:learnerId" element={<LearnerDetail />} />
          <Route path="/classes" element={<div>Classes list page</div>} />
          <Route path="/classes/:classId" element={<div>Class detail page</div>} />
          <Route path="/observations/:assessmentId" element={<div>Observation detail page</div>} />
        </Routes>
      </>,
      { route: '/learners/learner-1', authenticated: true }
    );

    // Navigate to learner-2 before learner-1's request has resolved.
    const user = userEvent.setup();
    await screen.findByText(/loading learner/i);
    await user.click(screen.getByText('go'));
    await screen.findByText('Sipho Nkosi');

    // Now let the stale learner-1 response resolve.
    resolveLearner1();
    await new Promise((r) => setTimeout(r, 0));

    // The page is still showing /learners/learner-2 — it must keep
    // showing learner-2's data, not be overwritten by the stale
    // learner-1 response that arrived late.
    expect(screen.getByText('Sipho Nkosi')).toBeInTheDocument();
    expect(screen.queryByText('Naledi Dube')).not.toBeInTheDocument();
  });
});
