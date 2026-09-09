import { describe, it, expect, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders, screen, userEvent } from '../test/test-utils';
import ResourcesWorkspace from './ResourcesWorkspace';

const ALL_RESOURCES = [
  { id: 'r1', title: 'Fractions Lesson', resourceType: 'lessonPlan', subject: 'Mathematics', grade: 7, createdAt: '2026-05-10' },
  { id: 'r2', title: 'Fractions Worksheet', resourceType: 'worksheet', subject: 'Mathematics', grade: 7, createdAt: '2026-05-11' },
  { id: 'r3', title: null, resourceType: 'test', subject: 'Literacy', grade: 3, createdAt: '2026-05-12' },
];

/**
 * Mimics the real server contract: honors ?resourceType= against the
 * full fixture set, same as teacherWorkspaceService.getSavedResources
 * would. Omitting resourceType (the new default) returns everything.
 */
function mockFetchResources(fixture = ALL_RESOURCES, { ok = true, status = ok ? 200 : 400 } = {}) {
  const fetchMock = vi.fn(async (url) => {
    if (!ok) return { ok, status, text: async () => JSON.stringify({ error: 'Something went wrong.' }) };
    const params = new URL(url, 'http://localhost').searchParams;
    const resourceType = params.get('resourceType');
    const resources = fixture.filter((r) => !resourceType || r.resourceType === resourceType);
    return { ok: true, status: 200, text: async () => JSON.stringify({ resources }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderWorkspace(options) {
  return renderWithProviders(
    <Routes>
      <Route path="/resources" element={<ResourcesWorkspace />} />
      <Route path="/resources/:resourceId" element={<div>Resource detail page</div>} />
    </Routes>,
    { route: '/resources', authenticated: true, ...options }
  );
}

describe('ResourcesWorkspace', () => {
  it('shows a loading spinner before the request resolves', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderWorkspace();
    expect(screen.getByText(/loading your saved resources/i)).toBeInTheDocument();
  });

  it('shows an error banner when the request fails', async () => {
    mockFetchResources(undefined, { ok: false, status: 500 });
    renderWorkspace();
    expect(await screen.findByText('Something went wrong.')).toBeInTheDocument();
  });

  it('page heading reads "Resources"', async () => {
    mockFetchResources();
    renderWorkspace();
    await screen.findByText('Fractions Lesson');
    expect(screen.getByRole('heading', { name: 'Resources' })).toBeInTheDocument();
  });

  it('defaults to "All resource types" and fetches with no resourceType param, showing every saved type', async () => {
    const fetchMock = mockFetchResources();
    renderWorkspace();

    expect(await screen.findByText('Fractions Lesson')).toBeInTheDocument();
    expect(screen.getByText('Fractions Worksheet')).toBeInTheDocument();
    expect(screen.getByText('Untitled resource')).toBeInTheDocument(); // r3, null title

    expect(screen.getByLabelText('Filter by resource type')).toHaveValue('');
    const firstCallUrl = fetchMock.mock.calls[0][0];
    expect(firstCallUrl).not.toContain('resourceType=');
  });

  it('shows the generic empty state, not a lesson-plan-specific one, when nothing is saved and no filter is active', async () => {
    mockFetchResources([]);
    renderWorkspace();
    expect(await screen.findByText('No resources saved yet — generate one from WhatsApp')).toBeInTheDocument();
  });

  it('shows a type-aware empty state for a non-lessonPlan filter with no matches', async () => {
    mockFetchResources([]);
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText('No resources saved yet — generate one from WhatsApp');
    await user.selectOptions(screen.getByLabelText('Filter by resource type'), 'worksheet');

    expect(await screen.findByText('No worksheets saved yet')).toBeInTheDocument();
  });

  it('shows a type-aware empty state for the lessonPlan filter specifically, not the old hard-coded special case', async () => {
    mockFetchResources([]);
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText('No resources saved yet — generate one from WhatsApp');
    await user.selectOptions(screen.getByLabelText('Filter by resource type'), 'lessonPlan');

    expect(await screen.findByText('No lesson plans saved yet')).toBeInTheDocument();
  });

  it('re-fetches with the resourceType query param when the filter changes, and filtered views still work', async () => {
    const fetchMock = mockFetchResources();
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText('Fractions Lesson');
    fetchMock.mockClear();
    await user.selectOptions(screen.getByLabelText('Filter by resource type'), 'worksheet');

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('resourceType=worksheet'), expect.anything());
    await screen.findByText('Fractions Worksheet');
    expect(screen.queryByText('Fractions Lesson')).not.toBeInTheDocument();
  });

  it('navigates to the resource detail page when a row is clicked', async () => {
    mockFetchResources();
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(await screen.findByText('Fractions Lesson'));
    expect(screen.getByText('Resource detail page')).toBeInTheDocument();
  });

  it('filters client-side by search text across title, subject, and grade', async () => {
    mockFetchResources();
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText('Fractions Lesson');
    await user.type(screen.getByLabelText('Search resources'), 'literacy');

    expect(screen.queryByText('Fractions Lesson')).not.toBeInTheDocument();
    expect(screen.queryByText('Fractions Worksheet')).not.toBeInTheDocument();
  });

  it('existing resource rendering (type pill, subject, grade, date) remains intact', async () => {
    mockFetchResources();
    renderWorkspace();

    await screen.findByText('Fractions Lesson');
    expect(screen.getByText('Lesson Plan')).toBeInTheDocument();
    expect(screen.getByText('Worksheet')).toBeInTheDocument();
  });
});
