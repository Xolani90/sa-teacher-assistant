import { describe, it, expect, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders, screen, userEvent, waitFor } from '../test/test-utils';
import Login from './Login';

/**
 * Same URL-routed fetch mock pattern as ClassDetail.test.jsx: dispatch by
 * substring so tests don't depend on call order or exact query strings.
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

function renderLogin() {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<div>Home screen</div>} />
    </Routes>,
    { route: '/login' }
  );
}

async function fillPhoneAndSubmit(user, phone = '0821234567') {
  await user.type(screen.getByLabelText('WhatsApp number'), phone);
  await user.click(screen.getByRole('button', { name: /send code/i }));
}

describe('Login', () => {
  it('starts on the phone step', () => {
    renderLogin();
    expect(screen.getByLabelText('WhatsApp number')).toBeInTheDocument();
    expect(screen.queryByLabelText('Verification code')).not.toBeInTheDocument();
  });

  it('advances to the code step after requesting a code successfully', async () => {
    mockFetchRoutes({ 'request-code': { body: { success: true } } });
    const user = userEvent.setup();
    renderLogin();

    await fillPhoneAndSubmit(user);

    expect(await screen.findByLabelText('Verification code')).toBeInTheDocument();
    expect(screen.getByText('0821234567')).toBeInTheDocument(); // "sent a code to <phone>"
  });

  it('always advances to the code step even for an unknown number (no enumeration, per ADR-008)', async () => {
    // requestCode's contract is "always resolves {success:true} regardless
    // of whether the phone is known" -- there's no separate "unknown
    // number" branch to test on the frontend, so this just re-confirms
    // the success path doesn't leak a distinguishing state.
    mockFetchRoutes({ 'request-code': { body: { success: true } } });
    const user = userEvent.setup();
    renderLogin();

    await fillPhoneAndSubmit(user, '0000000000');

    expect(await screen.findByLabelText('Verification code')).toBeInTheDocument();
  });

  it('shows an error and stays on the phone step when the request-code call fails', async () => {
    mockFetchRoutes({ 'request-code': { body: { error: 'Too many requests' }, ok: false, status: 429 } });
    const user = userEvent.setup();
    renderLogin();

    await fillPhoneAndSubmit(user);

    expect(await screen.findByText('Too many requests')).toBeInTheDocument();
    expect(screen.getByLabelText('WhatsApp number')).toBeInTheDocument();
    expect(screen.queryByLabelText('Verification code')).not.toBeInTheDocument();
  });

  it('disables the submit button and shows "Sending…" while the request is in flight', async () => {
    let resolveFetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          })
      )
    );
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText('WhatsApp number'), '0821234567');
    await user.click(screen.getByRole('button', { name: /send code/i }));

    const pendingButton = screen.getByRole('button', { name: /sending/i });
    expect(pendingButton).toBeDisabled();

    // Let the in-flight request resolve so the pending timer/effect
    // doesn't leak past the end of the test.
    resolveFetch({ ok: true, status: 200, text: async () => JSON.stringify({ success: true }) });
    await waitFor(() => expect(screen.getByLabelText('Verification code')).toBeInTheDocument());
  });

  it('logs in and navigates to / when the code is verified successfully', async () => {
    mockFetchRoutes({
      'request-code': { body: { success: true } },
      'verify-code': {
        body: { accessToken: 'tok-123', tokenType: 'Bearer', expiresIn: 3600, teacher: { id: 't1', name: 'Ms. Dlamini' } },
      },
    });
    const user = userEvent.setup();
    renderLogin();

    await fillPhoneAndSubmit(user);
    await screen.findByLabelText('Verification code');
    await user.type(screen.getByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: /verify & log in/i }));

    expect(await screen.findByText('Home screen')).toBeInTheDocument();
  });

  it('shows "incorrect or expired code" specifically on a 401, not the generic error', async () => {
    mockFetchRoutes({
      'request-code': { body: { success: true } },
      'verify-code': { body: { error: 'Invalid code' }, ok: false, status: 401 },
    });
    const user = userEvent.setup();
    renderLogin();

    await fillPhoneAndSubmit(user);
    await screen.findByLabelText('Verification code');
    await user.type(screen.getByLabelText('Verification code'), '000000');
    await user.click(screen.getByRole('button', { name: /verify & log in/i }));

    expect(await screen.findByText('Incorrect or expired code. Please try again.')).toBeInTheDocument();
    // Still on the code step -- a failed verify doesn't bounce back to phone entry.
    expect(screen.getByLabelText('Verification code')).toBeInTheDocument();
  });

  it('shows the generic error message on a non-401 verify failure', async () => {
    mockFetchRoutes({
      'request-code': { body: { success: true } },
      'verify-code': { body: { error: 'Server error' }, ok: false, status: 500 },
    });
    const user = userEvent.setup();
    renderLogin();

    await fillPhoneAndSubmit(user);
    await screen.findByLabelText('Verification code');
    await user.type(screen.getByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: /verify & log in/i }));

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
  });

  it('"Use a different number" returns to the phone step and clears the code and error', async () => {
    mockFetchRoutes({
      'request-code': { body: { success: true } },
      'verify-code': { body: { error: 'Invalid code' }, ok: false, status: 401 },
    });
    const user = userEvent.setup();
    renderLogin();

    await fillPhoneAndSubmit(user);
    await screen.findByLabelText('Verification code');
    await user.type(screen.getByLabelText('Verification code'), '000000');
    await user.click(screen.getByRole('button', { name: /verify & log in/i }));
    await screen.findByText('Incorrect or expired code. Please try again.');

    await user.click(screen.getByRole('button', { name: /use a different number/i }));

    expect(screen.getByLabelText('WhatsApp number')).toBeInTheDocument();
    expect(screen.queryByLabelText('Verification code')).not.toBeInTheDocument();
    expect(screen.queryByText('Incorrect or expired code. Please try again.')).not.toBeInTheDocument();
    // The phone number itself is preserved (only step/code/error reset).
    expect(screen.getByLabelText('WhatsApp number')).toHaveValue('0821234567');
  });
});
