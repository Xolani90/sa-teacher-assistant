import { describe, it, expect, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders, screen, userEvent } from '../test/test-utils';
import BlueprintDetail from './BlueprintDetail';

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

const BLUEPRINT = {
  id: 1,
  phoneHash: 'hash_owner',
  title: 'Term 2 Fractions Test',
  subject: 'Mathematics',
  grade: 7,
  term: 2,
  totalMarks: 50,
  version: 1,
  previousVersionId: null,
  status: 'draft',
  createdAt: '2026-08-01 08:00:00',
  updatedAt: '2026-08-01 08:00:00',
  questions: [
    { id: 1, questionNumber: 1, topic: 'Fractions', subtopic: null, bloomLevel: 'Application', atpReference: null, expectedMisconception: null, maxMarks: 20 },
    { id: 2, questionNumber: 2, topic: 'Ratio and Proportion', subtopic: null, bloomLevel: 'Knowledge', atpReference: null, expectedMisconception: null, maxMarks: 30 },
  ],
};

function renderDetail(options) {
  return renderWithProviders(
    <Routes>
      <Route path="/blueprints/:blueprintId" element={<BlueprintDetail />} />
      <Route path="/blueprints" element={<div>Blueprints list page</div>} />
    </Routes>,
    { route: '/blueprints/1', authenticated: true, ...options }
  );
}

describe('BlueprintDetail', () => {
  it('shows a loading spinner before the request resolves', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderDetail();
    expect(screen.getByText(/loading blueprint/i)).toBeInTheDocument();
  });

  it('loads and displays the blueprint header: title, subject, grade, term, total marks', async () => {
    mockFetchRoutes({ '/api/blueprints/1': { method: 'GET', body: { blueprint: BLUEPRINT } } });
    renderDetail();

    expect(await screen.findByText('Term 2 Fractions Test')).toBeInTheDocument();
    expect(screen.getByText('Mathematics')).toBeInTheDocument();
    expect(screen.getByText('Grade 7')).toBeInTheDocument();
    expect(screen.getByText('Term 2')).toBeInTheDocument();
    expect(screen.getByText('draft')).toBeInTheDocument();
    expect(screen.getByText(/Total 50 marks/)).toBeInTheDocument();
  });

  it('renders the weighting allocation table from the persisted questions, summing to the persisted total', async () => {
    mockFetchRoutes({ '/api/blueprints/1': { method: 'GET', body: { blueprint: BLUEPRINT } } });
    renderDetail();

    await screen.findByText('Term 2 Fractions Test');

    expect(screen.getByText('Weighting Allocation')).toBeInTheDocument();
    expect(screen.getAllByText('Fractions').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ratio and Proportion').length).toBeGreaterThan(0);
    // 20/50 = 40%, 30/50 = 60%
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('renders the full question list verbatim', async () => {
    mockFetchRoutes({ '/api/blueprints/1': { method: 'GET', body: { blueprint: BLUEPRINT } } });
    renderDetail();

    await screen.findByText('Term 2 Fractions Test');

    expect(screen.getByText('Questions')).toBeInTheDocument();
    expect(screen.getByText('Application')).toBeInTheDocument();
    expect(screen.getByText('Knowledge')).toBeInTheDocument();
  });

  it('shows an error banner when the blueprint is missing (404, no existence oracle)', async () => {
    mockFetchRoutes({ '/api/blueprints/1': { method: 'GET', body: { error: 'Blueprint not found' }, ok: false, status: 404 } });
    renderDetail();

    expect(await screen.findByText('Blueprint not found')).toBeInTheDocument();
    expect(screen.queryByText('Term 2 Fractions Test')).not.toBeInTheDocument();
  });

  it('shows an error banner on a generic server failure', async () => {
    mockFetchRoutes({ '/api/blueprints/1': { method: 'GET', body: { error: 'Internal server error' }, ok: false, status: 500 } });
    renderDetail();

    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
  });

  it('navigates back to the Blueprints list when the back button is clicked', async () => {
    mockFetchRoutes({ '/api/blueprints/1': { method: 'GET', body: { blueprint: BLUEPRINT } } });
    const user = userEvent.setup();
    renderDetail();

    await screen.findByText('Term 2 Fractions Test');
    await user.click(screen.getByRole('button', { name: /back to blueprints/i }));

    expect(screen.getByText('Blueprints list page')).toBeInTheDocument();
  });

  it('shows a message instead of a table when the blueprint has no questions', async () => {
    mockFetchRoutes({
      '/api/blueprints/1': { method: 'GET', body: { blueprint: { ...BLUEPRINT, questions: [], totalMarks: 0 } } },
    });
    renderDetail();

    await screen.findByText('Term 2 Fractions Test');
    expect(screen.getAllByText('No questions recorded on this blueprint.').length).toBeGreaterThan(0);
  });
});
