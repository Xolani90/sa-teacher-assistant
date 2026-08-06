import { describe, it, expect, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders, screen, userEvent, waitFor } from '../test/test-utils';
import Home from './Home';

/**
 * Home fires two independent requests on mount via Promise.all
 * (GET /api/classes, GET /api/learners). Routing responses by URL
 * substring means tests don't depend on call order.
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

const CLASSES = [
  { id: 'class-1', name: 'Grade 8 Mathematics', grade: 8, subject: 'Mathematics', learnerCount: 34 },
  { id: 'class-2', name: 'Grade 3 Literacy', grade: 3, subject: null, learnerCount: 1 },
  { id: 'class-3', name: 'Unassigned Group', grade: null, subject: null, learnerCount: 0 },
];

const OK_ROUTES = {
  '/api/classes': { body: { classes: CLASSES } },
  '/api/learners': { body: { learners: [{ id: 'l1' }, { id: 'l2' }] } },
};

function renderHome(options) {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/classes" element={<div>Classes list page</div>} />
      <Route path="/classes/:classId" element={<div>Class detail page</div>} />
    </Routes>,
    { route: '/', authenticated: true, teacher: { id: 'teacher-1', name: 'Zanele Mokoena' }, ...options }
  );
}

describe('Home', () => {
  it('shows a loading spinner before the requests resolve', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderHome();
    expect(screen.getByText(/loading your overview/i)).toBeInTheDocument();
  });

  it('greets the teacher by first name', async () => {
    mockFetchRoutes(OK_ROUTES);
    renderHome();
    expect(await screen.findByText(/Zanele\./)).toBeInTheDocument();
  });

  it('falls back to "there" when the teacher has no stored name', async () => {
    mockFetchRoutes(OK_ROUTES);
    renderHome({ teacher: { id: 'teacher-1', name: null } });
    expect(await screen.findByText(/there\./)).toBeInTheDocument();
  });

  it('shows an inline error banner alongside the rest of the page (not a full-page replacement) when the requests fail', async () => {
    mockFetchRoutes({
      '/api/classes': { body: { error: 'Server error' }, ok: false, status: 500 },
      '/api/learners': { body: { learners: [] } },
    });
    renderHome();

    expect(await screen.findByText('Server error')).toBeInTheDocument();
    // The hero command bar still renders even when stats failed to load.
    expect(screen.getByText('Copy message')).toBeInTheDocument();
    expect(screen.getByText('No classes yet')).toBeInTheDocument();
  });

  it('falls back to a generic error message when the failure has no message', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error()));
    vi.stubGlobal('fetch', fetchMock);
    renderHome();
    expect(await screen.findByText('Could not load your dashboard.')).toBeInTheDocument();
  });

  it('renders real classes/learners stat counts once loaded', async () => {
    mockFetchRoutes(OK_ROUTES);
    renderHome();

    expect(await screen.findByText('Classes')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument(); // classes.length
    expect(screen.getByText('Learners')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); // learners.length
  });

  it('shows the "no classes yet" card and hides "View all" when there are no classes', async () => {
    mockFetchRoutes({ '/api/classes': { body: { classes: [] } }, '/api/learners': { body: { learners: [] } } });
    renderHome();

    await screen.findByText('No classes yet');
    expect(screen.getByText('NEW CLASS')).toBeInTheDocument();
    expect(screen.queryByText('View all →')).not.toBeInTheDocument();
  });

  it('shows up to 6 classes with "View all" and a class count subtitle when classes exist', async () => {
    mockFetchRoutes(OK_ROUTES);
    renderHome();

    await screen.findByText('Grade 8 Mathematics');
    expect(screen.getByText('Grade 3 Literacy')).toBeInTheDocument();
    expect(screen.getByText('Unassigned Group')).toBeInTheDocument();
    expect(screen.getByText('3 classes')).toBeInTheDocument();
    expect(screen.getByText('View all →')).toBeInTheDocument();

    // Grade/subject line falls back when both are missing.
    expect(screen.getByText('No grade/subject set')).toBeInTheDocument();
    // learnerCount falls back to 0 and pluralizes correctly.
    expect(screen.getByText('0 learners')).toBeInTheDocument();
    expect(screen.getByText('1 learner')).toBeInTheDocument();
  });

  it('uses singular "class" in the subtitle when there is exactly one class', async () => {
    mockFetchRoutes({
      '/api/classes': { body: { classes: [CLASSES[0]] } },
      '/api/learners': { body: { learners: [] } },
    });
    renderHome();
    expect(await screen.findByText('1 class')).toBeInTheDocument();
  });

  it('navigates to a class detail page when a class preview card is clicked', async () => {
    mockFetchRoutes(OK_ROUTES);
    const user = userEvent.setup();
    renderHome();

    await user.click(await screen.findByText('Grade 8 Mathematics'));
    expect(screen.getByText('Class detail page')).toBeInTheDocument();
  });

  it('navigates to the classes list when "View all" is clicked', async () => {
    mockFetchRoutes(OK_ROUTES);
    const user = userEvent.setup();
    renderHome();

    await user.click(await screen.findByText('View all →'));
    expect(screen.getByText('Classes list page')).toBeInTheDocument();
  });

  it('switches the active command and its displayed template when a command chip is clicked', async () => {
    mockFetchRoutes(OK_ROUTES);
    const user = userEvent.setup();
    renderHome();

    await screen.findByText('Grade 7 algebra worksheet');
    await user.click(screen.getByRole('button', { name: /lesson plan/i }));

    expect(screen.getByText('Lesson plan Grade 9 English poetry')).toBeInTheDocument();
    expect(screen.queryByText('Grade 7 algebra worksheet')).not.toBeInTheDocument();
  });

  it('copies the active command template to the clipboard and shows confirmation', async () => {
    mockFetchRoutes(OK_ROUTES);
    const user = userEvent.setup();
    // userEvent.setup() installs its own navigator.clipboard stub for
    // copy/paste support, so the custom mock must be defined *after* it
    // or userEvent's stub silently wins.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderHome();

    await screen.findByText('Grade 7 algebra worksheet');
    await user.click(screen.getByRole('button', { name: /copy message/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Grade 7 algebra worksheet'));
    expect(await screen.findByText('Copied ✓')).toBeInTheDocument();
  });

  it('fails quietly when the clipboard API is unavailable', async () => {
    mockFetchRoutes(OK_ROUTES);
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    renderHome();

    await screen.findByText('Grade 7 algebra worksheet');
    await user.click(screen.getByRole('button', { name: /copy message/i }));

    // No confirmation, no thrown error surfaced to the page.
    await waitFor(() => {
      expect(screen.queryByText('Copied ✓')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Copy message')).toBeInTheDocument();
  });

  it('renders the AI-powered tools section with real commands and the honest "not yet on dashboard" roadmap items', async () => {
    mockFetchRoutes(OK_ROUTES);
    renderHome();

    await screen.findByText('AI-Powered Teaching Tools');
    expect(screen.getAllByText('Generate on WhatsApp today').length).toBe(4); // one per COMMANDS entry
    expect(screen.getByText('Coverage Reports')).toBeInTheDocument();
    expect(screen.getByText('Intervention Insights')).toBeInTheDocument();
    expect(screen.getAllByText('Coming to the dashboard').length).toBe(2);
  });
});
