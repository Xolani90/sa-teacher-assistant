import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom does not implement matchMedia. ThemeContext calls it at init time
// (getInitialTheme -> window.matchMedia?.('(prefers-color-scheme: dark)')),
// so anything that mounts <ThemeProvider> needs this shimmed or it throws.
//
// Reinstalled unconditionally every test (not "if missing") because
// afterEach's vi.restoreAllMocks() clears the previous mock's
// implementation without deleting window.matchMedia itself — a guard like
// `if (!window.matchMedia)` would see a truthy-but-broken function on the
// second test onward and skip fixing it.
beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated API, some libs still call it
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

// Unmount components after each test (RTL does this automatically in most
// setups, but we call it explicitly since we're not using the auto-cleanup
// import path).
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});
