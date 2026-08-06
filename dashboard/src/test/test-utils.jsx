import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { ThemeProvider } from '../theme/ThemeContext';
import { TeacherProvider } from '../auth/TeacherContext';
import { setStoredToken, setStoredTeacher } from '../api/client';

/**
 * Renders `ui` inside the same provider stack App.jsx uses
 * (ThemeProvider > TeacherProvider > Router), so components that call
 * useTheme()/useTeacher() or sit behind <ProtectedRoute> work in tests
 * without each test having to reassemble the tree by hand.
 *
 * authenticated: true seeds localStorage *before* TeacherProvider mounts,
 * since TeacherProvider reads getStoredToken()/getStoredTeacher() only in
 * its useState initializer — setting it after render won't take effect.
 */
export function renderWithProviders(
  ui,
  {
    route = '/',
    initialEntries = [route],
    authenticated = false,
    teacher = { id: 'teacher-1', name: 'Test Teacher' },
    token = 'test-token',
    ...renderOptions
  } = {}
) {
  if (authenticated) {
    setStoredToken(token);
    setStoredTeacher(teacher);
  }

  function Wrapper({ children }) {
    return (
      <ThemeProvider>
        <TeacherProvider>
          <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
        </TeacherProvider>
      </ThemeProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...renderOptions });
}

/**
 * Stubs global.fetch with a single JSON response. authenticatedFetch (and
 * the plain requestCode/verifyCode calls) all go through global fetch()
 * directly (see api/client.js), so this is the one mock point that covers
 * every layer above it — no need to mock authedFetch or individual API
 * functions.
 */
export function mockFetchJsonOnce(body, { ok = true, status = ok ? 200 : 400 } = {}) {
  const fetchMock = vi.fn().mockResolvedValueOnce({
    ok,
    status,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Queue multiple sequential fetch responses for tests that make >1 call. */
export function mockFetchSequence(responses) {
  const fetchMock = vi.fn();
  responses.forEach(({ body, ok = true, status = ok ? 200 : 400 }) => {
    fetchMock.mockResolvedValueOnce({
      ok,
      status,
      text: async () => JSON.stringify(body),
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export * from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
