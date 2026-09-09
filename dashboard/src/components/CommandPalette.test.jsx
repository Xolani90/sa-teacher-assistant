import { describe, it, expect, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders, screen, userEvent, waitFor } from '../test/test-utils';
import CommandPalette from './CommandPalette';

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

const OK_ROUTES = {
  '/api/classes': { body: { classes: [{ id: 'class-1', name: 'Grade 8 Mathematics', grade: 8 }] } },
  '/api/learners': { body: { learners: [{ id: 'learner-1', canonicalName: 'Thabo Mokoena' }] } },
};

function renderPalette() {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<CommandPalette />} />
      <Route path="/classes" element={<div>Classes list page</div>} />
      <Route path="/classes/:classId" element={<div>Class detail page</div>} />
      <Route path="/learners/:learnerId" element={<div>Learner detail page</div>} />
      <Route path="/assessments" element={<div>Assessments page</div>} />
    </Routes>,
    { route: '/', authenticated: true }
  );
}

describe('CommandPalette', () => {
  it('renders nothing until opened', () => {
    mockFetchRoutes(OK_ROUTES);
    renderPalette();
    expect(screen.queryByLabelText('Quick jump search')).not.toBeInTheDocument();
  });

  it('opens on Ctrl+K and shows "Go to" nav destinations', async () => {
    mockFetchRoutes(OK_ROUTES);
    renderPalette();

    await userEvent.keyboard('{Control>}k{/Control}');

    expect(await screen.findByLabelText('Quick jump search')).toBeInTheDocument();
    expect(screen.getByText('Go to')).toBeInTheDocument();
    expect(screen.getByText('Assessments')).toBeInTheDocument();
    expect(screen.getByText('Overview')).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    mockFetchRoutes(OK_ROUTES);
    renderPalette();

    await userEvent.keyboard('{Control>}k{/Control}');
    expect(await screen.findByLabelText('Quick jump search')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByLabelText('Quick jump search')).not.toBeInTheDocument();
    });
  });

  it('opens in response to the open-command-palette custom event (the header Search button)', async () => {
    mockFetchRoutes(OK_ROUTES);
    renderPalette();

    window.dispatchEvent(new CustomEvent('open-command-palette'));

    expect(await screen.findByLabelText('Quick jump search')).toBeInTheDocument();
  });

  it('filters nav destinations as the query is typed', async () => {
    mockFetchRoutes(OK_ROUTES);
    renderPalette();

    await userEvent.keyboard('{Control>}k{/Control}');
    const input = await screen.findByLabelText('Quick jump search');
    await userEvent.type(input, 'reflect');

    expect(screen.getByText('Reflections & Goals')).toBeInTheDocument();
    expect(screen.queryByText('Assessments')).not.toBeInTheDocument();
  });

  it('finds and navigates to a matching class', async () => {
    mockFetchRoutes(OK_ROUTES);
    renderPalette();

    await userEvent.keyboard('{Control>}k{/Control}');
    const input = await screen.findByLabelText('Quick jump search');
    await userEvent.type(input, 'grade 8');

    const result = await screen.findByText('Grade 8 Mathematics');
    await userEvent.click(result);

    expect(await screen.findByText('Class detail page')).toBeInTheDocument();
  });

  it('finds and navigates to a matching learner', async () => {
    mockFetchRoutes(OK_ROUTES);
    renderPalette();

    await userEvent.keyboard('{Control>}k{/Control}');
    const input = await screen.findByLabelText('Quick jump search');
    await userEvent.type(input, 'thabo');

    const result = await screen.findByText('Thabo Mokoena');
    await userEvent.click(result);

    expect(await screen.findByText('Learner detail page')).toBeInTheDocument();
  });

  it('selects the active result with Enter, keyboard-only', async () => {
    mockFetchRoutes(OK_ROUTES);
    renderPalette();

    await userEvent.keyboard('{Control>}k{/Control}');
    const input = await screen.findByLabelText('Quick jump search');
    await userEvent.type(input, 'assessments');
    await userEvent.keyboard('{Enter}');

    expect(await screen.findByText('Assessments page')).toBeInTheDocument();
  });

  it('closes when the backdrop is clicked, without navigating', async () => {
    mockFetchRoutes(OK_ROUTES);
    renderPalette();

    await userEvent.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Quick jump' });
    // Click the backdrop (the dialog's parent), not the dialog itself.
    await userEvent.click(dialog.parentElement);

    await waitFor(() => {
      expect(screen.queryByLabelText('Quick jump search')).not.toBeInTheDocument();
    });
  });

  it('degrades to nav-only search if the classes/learners fetch fails', async () => {
    mockFetchRoutes({
      '/api/classes': { body: { error: 'boom' }, ok: false, status: 500 },
      '/api/learners': { body: { error: 'boom' }, ok: false, status: 500 },
    });
    renderPalette();

    await userEvent.keyboard('{Control>}k{/Control}');
    const input = await screen.findByLabelText('Quick jump search');
    await userEvent.type(input, 'grade 8');

    await waitFor(() => {
      expect(screen.getByText(/classes\/learners search unavailable/)).toBeInTheDocument();
    });
  });
});
