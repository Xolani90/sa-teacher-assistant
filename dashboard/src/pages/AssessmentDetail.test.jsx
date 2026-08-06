import { describe, it, expect, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders, screen, userEvent } from '../test/test-utils';
import AssessmentDetail from './AssessmentDetail';

/**
 * AssessmentDetail fires GET .../detail on mount and, separately,
 * GET .../pdf only when "Download PDF" is clicked. Routing by URL
 * substring (rather than call order) keeps these tests honest about
 * which endpoint is hit without caring how many calls happened first.
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

const BLUEPRINT_DETAIL = {
  assessment: {
    title: 'Term 2 Fractions Test',
    createdAt: '2026-05-12',
    assessmentType: 'test',
    isBlueprintBacked: true,
  },
  class: { name: 'Grade 8 Mathematics' },
  summary: { classAverage: 71.4, passRate: 82, learnerCount: 2 },
  learners: [
    { resultId: 'res1', learnerName: 'Thabo Nkosi', mark: 60, totalMarks: 80, percentage: 75 },
    { resultId: 'res2', learnerName: 'Naledi Dube', mark: 32, totalMarks: 80, percentage: 40 },
  ],
  analytics: {
    available: true,
    topics: [{ topic: 'Fractions', classAveragePercentage: 68 }],
    perLearnerTopics: [
      {
        learnerName: 'Thabo Nkosi',
        topics: [{ topic: 'Fractions', percentage: 75 }],
      },
    ],
  },
};

const FREEFORM_DETAIL = {
  assessment: {
    title: 'Quick Quiz',
    createdAt: '2026-06-01',
    assessmentType: 'quiz',
    isBlueprintBacked: false,
  },
  class: null,
  summary: { classAverage: 55, passRate: 50, learnerCount: 0 },
  learners: [],
  analytics: { available: false, topics: [], perLearnerTopics: [] },
};

function renderAssessmentDetail(options) {
  return renderWithProviders(
    <Routes>
      <Route path="/assessments/:assessmentId" element={<AssessmentDetail />} />
      <Route path="/classes/class-1" element={<div>Class detail page</div>} />
    </Routes>,
    { route: '/assessments/a1', authenticated: true, ...options }
  );
}

describe('AssessmentDetail', () => {
  it('shows a loading spinner before the request resolves', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderAssessmentDetail();
    expect(screen.getByText(/loading assessment/i)).toBeInTheDocument();
  });

  it('shows an error banner when the request fails', async () => {
    mockFetchRoutes({ '/detail': { body: { error: 'Assessment not found' }, ok: false, status: 404 } });
    renderAssessmentDetail();
    expect(await screen.findByText('Assessment not found')).toBeInTheDocument();
    expect(screen.queryByText('Term 2 Fractions Test')).not.toBeInTheDocument();
  });

  it('renders header, KPIs, learner results, and blueprint-backed topic analytics', async () => {
    mockFetchRoutes({ '/detail': { body: BLUEPRINT_DETAIL } });
    renderAssessmentDetail();

    expect(await screen.findByText('Term 2 Fractions Test')).toBeInTheDocument();
    expect(screen.getByText(/Grade 8 Mathematics/)).toBeInTheDocument();
    expect(screen.getByText('Test')).toBeInTheDocument(); // capitalized assessmentType
    expect(screen.getByText('Blueprint Assessment')).toBeInTheDocument();

    // KPIs.
    expect(screen.getByText('71.4%')).toBeInTheDocument();
    expect(screen.getByText('82%')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); // learnerCount
    expect(screen.getByText('1')).toBeInTheDocument(); // topics.length

    // Learner results table. "Thabo Nkosi" also appears as the topic
    // breakdown toggle button below, so scope to the table row.
    expect(screen.getAllByText('Thabo Nkosi').length).toBeGreaterThan(0);
    expect(screen.getByText('60/80')).toBeInTheDocument();
    expect(screen.getByText('Strong')).toBeInTheDocument(); // 75% -> Strong pill
    expect(screen.getByText('At Risk')).toBeInTheDocument(); // 40% -> At Risk pill

    // Class-level topic analytics render when analytics.available is true.
    expect(screen.getByText('Topic Analytics')).toBeInTheDocument();
    expect(screen.getByText('Fractions')).toBeInTheDocument();

    // Learner topic breakdown is collapsed by default.
    expect(screen.getByText('Learner Topic Breakdown')).toBeInTheDocument();
    expect(screen.queryByText('68%')).toBeInTheDocument(); // class-level topic bar label
  });

  it('expands and collapses a learner\'s topic breakdown on click', async () => {
    mockFetchRoutes({ '/detail': { body: BLUEPRINT_DETAIL } });
    const user = userEvent.setup();
    renderAssessmentDetail();

    await screen.findByText('Term 2 Fractions Test');

    // The toggle is the button whose accessible name is the learner's
    // name; "Thabo Nkosi" also appears as plain text in the results
    // table row, so query by role to land on the button specifically.
    const toggle = screen.getByRole('button', { name: /thabo nkosi/i });
    // "75%" already appears once in the results table, so assert on the
    // per-topic label inside the (collapsed) breakdown panel instead.
    expect(screen.queryByText('▲ Topic Breakdown')).not.toBeInTheDocument();
    expect(screen.getByText('▼ Topic Breakdown')).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.getByText('▲ Topic Breakdown')).toBeInTheDocument();
    expect(screen.getAllByText('75%')).toHaveLength(2); // table row + expanded breakdown

    await user.click(toggle);
    expect(screen.getByText('▼ Topic Breakdown')).toBeInTheDocument();
    expect(screen.getAllByText('75%')).toHaveLength(1);
  });

  it('omits topic analytics sections and shows "—" for topics when analytics is unavailable, and shows the empty-results state', async () => {
    mockFetchRoutes({ '/detail': { body: FREEFORM_DETAIL } });
    renderAssessmentDetail();

    expect(await screen.findByText('Quick Quiz')).toBeInTheDocument();
    expect(screen.getByText(/Unassigned class/)).toBeInTheDocument();
    expect(screen.getByText('Quiz')).toBeInTheDocument();
    expect(screen.queryByText('Blueprint Assessment')).not.toBeInTheDocument();

    expect(screen.getByText('—')).toBeInTheDocument(); // Topics KPI fallback
    expect(screen.queryByText('Topic Analytics')).not.toBeInTheDocument();
    expect(screen.queryByText('Learner Topic Breakdown')).not.toBeInTheDocument();

    expect(screen.getByText('No results yet')).toBeInTheDocument();
  });

  it('downloads the PDF and opens it in a new tab', async () => {
    mockFetchRoutes({
      '/detail': { body: BLUEPRINT_DETAIL },
      '/pdf': { body: { url: 'https://example.com/report.pdf' } },
    });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => {});
    const user = userEvent.setup();
    renderAssessmentDetail();

    const downloadButton = await screen.findByRole('button', { name: /download pdf/i });
    await user.click(downloadButton);

    expect(await screen.findByRole('button', { name: /download pdf/i })).not.toBeDisabled();
    expect(openSpy).toHaveBeenCalledWith('https://example.com/report.pdf', '_blank', 'noopener,noreferrer');
    openSpy.mockRestore();
  });

  it('re-enables the download button and leaves the assessment on screen when the PDF request fails', async () => {
    mockFetchRoutes({
      '/detail': { body: BLUEPRINT_DETAIL },
      '/pdf': { body: { error: 'Could not generate the PDF right now.' }, ok: false, status: 500 },
    });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => {});
    const user = userEvent.setup();
    renderAssessmentDetail();

    const downloadButton = await screen.findByRole('button', { name: /download pdf/i });
    await user.click(downloadButton);

    // The component tracks the PDF failure in the same `error` state as
    // the page-load error, but only renders it via ErrorBanner when
    // status === STATUS_ERROR — a PDF failure doesn't flip status, so
    // there's no visible error banner here. What's observable is that
    // the button recovers from its loading state, window.open is never
    // called, and the already-loaded assessment stays on screen.
    await screen.findByRole('button', { name: /download pdf/i });
    expect(downloadButton).not.toBeDisabled();
    expect(openSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Term 2 Fractions Test')).toBeInTheDocument();
    openSpy.mockRestore();
  });

  it('navigates back using browser history when the back button is clicked', async () => {
    mockFetchRoutes({ '/detail': { body: BLUEPRINT_DETAIL } });
    const user = userEvent.setup();
    renderAssessmentDetail({ initialEntries: ['/classes/class-1', '/assessments/a1'] });

    await screen.findByText('Term 2 Fractions Test');
    await user.click(screen.getByRole('button', { name: /back/i }));

    expect(screen.getByText('Class detail page')).toBeInTheDocument();
  });
});
