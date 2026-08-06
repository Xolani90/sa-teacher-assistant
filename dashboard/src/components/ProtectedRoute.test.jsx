import { describe, it, expect } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test/test-utils';
import ProtectedRoute from './ProtectedRoute';

// Deliberately the first "real" test in the suite (beyond the pure
// ClassSnapshotSection component): it exercises the whole provider stack
// -- ThemeProvider (window.matchMedia shim), TeacherProvider (reads auth
// state from localStorage on mount), and MemoryRouter -- the way every
// page test built on renderWithProviders will.

function renderProtected(options) {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<div>Login screen</div>} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <div>Secret dashboard content</div>
          </ProtectedRoute>
        }
      />
    </Routes>,
    options
  );
}

describe('ProtectedRoute (via renderWithProviders)', () => {
  it('redirects to /login when there is no stored session', () => {
    renderProtected({ route: '/', authenticated: false });
    expect(screen.getByText('Login screen')).toBeInTheDocument();
    expect(screen.queryByText('Secret dashboard content')).not.toBeInTheDocument();
  });

  it('renders the protected children when a session was seeded before mount', () => {
    renderProtected({ route: '/', authenticated: true, teacher: { id: 't1', name: 'Ms. Dlamini' } });
    expect(screen.getByText('Secret dashboard content')).toBeInTheDocument();
    expect(screen.queryByText('Login screen')).not.toBeInTheDocument();
  });
});
