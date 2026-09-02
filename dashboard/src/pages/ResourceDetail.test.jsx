import { describe, it, expect, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders, screen, userEvent } from '../test/test-utils';
import ResourceDetail from './ResourceDetail';

/**
 * ResourceDetail deletion (Phase 6 continuation) — a thin wrapper around
 * DELETE /api/resources/:id, mirroring ClassDetail.test.jsx's
 * confirm-then-delete coverage exactly. saved_resources rows are leaves
 * (no dependent-record guard), so there's no 409 case to cover here —
 * just the happy path and a generic-failure path.
 */
function mockFetchRoutes(routes) {
  const fetchMock = vi.fn(async (url, options = {}) => {
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`Unmocked fetch in test: ${url}`);
    const { body, ok = true, status = ok ? 200 : 400 } = routes[key];
    return { ok, status, text: async () => JSON.stringify(body) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const RESOURCE = {
  resourceType: 'lessonPlan',
  grade: 7,
  subject: 'Mathematics',
  term: 1,
  title: 'Common Fractions Intro',
  topic: 'Common fractions',
  createdAt: '2026-08-01 09:00:00',
  content: 'Full lesson plan content goes here.',
  homework: 'Complete worksheet 3, questions 1-10.',
};

function renderResourceDetail(options) {
  return renderWithProviders(
    <Routes>
      <Route path="/resources/:resourceId" element={<ResourceDetail />} />
      <Route path="/resources" element={<div>Resources list page</div>} />
    </Routes>,
    { route: '/resources/resource-1', authenticated: true, ...options }
  );
}

describe('ResourceDetail', () => {
  it('renders resource content on success', async () => {
    mockFetchRoutes({ '/resources/resource-1': { body: RESOURCE } });
    renderResourceDetail();

    expect(await screen.findByText('Common Fractions Intro')).toBeInTheDocument();
    expect(screen.getByText('Full lesson plan content goes here.')).toBeInTheDocument();
    expect(screen.getByText('Complete worksheet 3, questions 1-10.')).toBeInTheDocument();
  });

  it('deletes the resource after confirmation and navigates back to the resources list', async () => {
    // GET (on load) and DELETE (on confirm) hit the same URL, so one route
    // entry serves both, exactly as '/classes/class-1' does in
    // ClassDetail.test.jsx's equivalent case.
    const fetchMock = vi.fn(async (url, options = {}) => {
      if (!url.includes('/resources/resource-1')) throw new Error(`Unmocked fetch in test: ${url}`);
      if (options.method === 'DELETE') {
        return { ok: true, status: 200, text: async () => JSON.stringify(null) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(RESOURCE) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderResourceDetail();

    await screen.findByText('Common Fractions Intro');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Delete this resource?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Resources list page')).toBeInTheDocument();
  });

  it('cancelling the delete confirmation leaves the resource in place', async () => {
    mockFetchRoutes({ '/resources/resource-1': { body: RESOURCE } });
    const user = userEvent.setup();
    renderResourceDetail();

    await screen.findByText('Common Fractions Intro');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Delete this resource?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Delete this resource?')).not.toBeInTheDocument();
    expect(screen.getByText('Common Fractions Intro')).toBeInTheDocument();
    expect(screen.queryByText('Resources list page')).not.toBeInTheDocument();
  });

  it('surfaces a delete failure instead of navigating away', async () => {
    const fetchMock = vi.fn(async (url, options = {}) => {
      if (!url.includes('/resources/resource-1')) throw new Error(`Unmocked fetch in test: ${url}`);
      if (options.method === 'DELETE') {
        return {
          ok: false,
          status: 404,
          text: async () => JSON.stringify({ error: 'deleteSavedResource: resource not found.' }),
        };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(RESOURCE) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderResourceDetail();

    await screen.findByText('Common Fractions Intro');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText(/resource not found/)).toBeInTheDocument();
    expect(screen.queryByText('Resources list page')).not.toBeInTheDocument();
    // Failure resets confirmation back to the plain Delete button.
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });
});
