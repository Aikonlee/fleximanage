import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import VerifyAccount from './VerifyAccount';
import api from '../services/api';

vi.mock('../components/auth/TurnstileChallenge', () => ({
  default: ({ onPolicy, onToken }) => (
    <div data-testid="turnstile-challenge">
      <button type="button" onClick={() => onPolicy({ ready: true, enforced: false })}>CaptchaReadyOff</button>
      <button type="button" onClick={() => onPolicy({ ready: true, enforced: true })}>CaptchaEnforced</button>
      <button type="button" onClick={() => onToken('verify-captcha-token')}>CaptchaSolve</button>
    </div>
  )
}));

const adapter = vi.fn();

function LocationProbe() {
  const location = useLocation();
  return (
    <>
      <span data-testid="location">
        {location.pathname}
        {location.search}
        {location.hash}
      </span>
      <span data-testid="location-state">{JSON.stringify(location.state)}</span>
    </>
  );
}

function renderAt(entry) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <VerifyAccount />
      <LocationProbe />
    </MemoryRouter>
  );
}

beforeEach(() => {
  adapter.mockReset();
  api.defaults.adapter = adapter;
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('reads id from search and token from hash, clears location before API call, and verifies', async () => {
  const userId = '507f1f77bcf86cd799439011';
  const verifyToken = 'opaque-verify-token-123';

  adapter.mockImplementation(async (config) => ({
    config,
    status: 200,
    headers: {},
    data: { status: 'account verified' }
  }));

  renderAt(`/verify-account?id=${userId}#t=${verifyToken}`);

  await waitFor(() => expect(adapter).toHaveBeenCalledTimes(1));
  await waitFor(() => {
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/verify-account$/);
  });
  expect(screen.getByTestId('location').textContent).not.toContain('t=');
  expect(screen.getByTestId('location').textContent).not.toContain(verifyToken);
  expect(window.location.search).not.toContain('t=');

  const reqConfig = adapter.mock.calls[0][0];
  expect(reqConfig.method).toBe('post');
  expect(reqConfig.url).toBe('/users/verify-account');
  expect(JSON.parse(reqConfig.data)).toEqual({
    id: userId,
    token: verifyToken
  });

  expect(await screen.findByText(/Your account has been verified/i)).toBeInTheDocument();
});

test('BrowserRouter clears URL params/hash before API call while preserving router history state', async () => {
  const userId = '507f1f77bcf86cd799439011';
  const verifyToken = 'browser-router-secret-token';
  const initialHistoryState = { usr: { from: 'email-link' }, key: 'initial-key', idx: 2 };
  window.history.replaceState(initialHistoryState, '', `/verify-account?id=${userId}#t=${verifyToken}`);

  const events = [];
  const originalReplaceState = window.history.replaceState.bind(window.history);
  const replaceStateSpy = vi.spyOn(window.history, 'replaceState').mockImplementation((state, unused, url) => {
    events.push({ type: 'replaceState', state, url });
    return originalReplaceState(state, unused, url);
  });

  let urlDuringPost = null;
  let historyStateDuringPost = null;
  adapter.mockImplementation(async (config) => {
    events.push({ type: 'api.post' });
    urlDuringPost = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    historyStateDuringPost = window.history.state;
    return {
      config,
      status: 200,
      headers: {},
      data: { status: 'account verified' }
    };
  });

  render(
    <BrowserRouter>
      <Routes>
        <Route path="/verify-account" element={<><VerifyAccount /><LocationProbe /></>} />
        <Route path="/login" element={<span data-testid="login-page">Login</span>} />
      </Routes>
    </BrowserRouter>
  );

  await waitFor(() => expect(adapter).toHaveBeenCalledTimes(1));
  expect(await screen.findByText(/Your account has been verified/i)).toBeInTheDocument();

  // URL must already be stripped before the verification POST is sent.
  expect(urlDuringPost).toBe('/verify-account');
  expect(window.location.pathname).toBe('/verify-account');
  expect(window.location.search).toBe('');
  expect(window.location.hash).toBe('');

  // React Router history state and location.state must be preserved (never clobbered to null).
  expect(historyStateDuringPost).toEqual(expect.objectContaining({
    usr: { from: 'email-link' },
    idx: 2
  }));
  expect(window.history.state).toEqual(expect.objectContaining({
    usr: { from: 'email-link' },
    idx: 2
  }));
  expect(screen.getByTestId('location')).toHaveTextContent(/^\/verify-account$/);
  expect(screen.getByTestId('location-state')).toHaveTextContent('{"from":"email-link"}');

  // Cleanup runs exactly once before the API call, never overwriting state with null afterwards.
  expect(replaceStateSpy).toHaveBeenCalledTimes(1);
  expect(replaceStateSpy.mock.calls[0][0]).not.toBeNull();
  expect(events.map(e => e.type)).toEqual(['replaceState', 'api.post']);

  const reqConfig = adapter.mock.calls[0][0];
  expect(reqConfig.url).toBe('/users/verify-account');
  expect(JSON.parse(reqConfig.data)).toEqual({
    id: userId,
    token: verifyToken
  });
});

test('rejects legacy query-string tokens and leaves no t= in location.search', async () => {
  renderAt('/verify-account?id=507f1f77bcf86cd799439011&t=legacy-query-token');

  await waitFor(() => {
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/verify-account$/);
  });
  expect(screen.getByTestId('location').textContent).not.toContain('t=');
  expect(window.location.search).not.toContain('t=');
  expect(await screen.findByText(/Missing verification parameters/i)).toBeInTheDocument();
  expect(adapter).not.toHaveBeenCalled();
});

test('VerifyAccount resend gates on captcha policy/token and sends captcha in POST body', async () => {
  adapter.mockImplementation(async (config) => ({
    config,
    status: 200,
    headers: {},
    data: { status: 'account reverified' }
  }));

  renderAt('/verify-account');
  expect(await screen.findByText(/Missing verification parameters/i)).toBeInTheDocument();

  const emailInput = screen.getByPlaceholderText('Your email');
  const resendBtn = screen.getByRole('button', { name: 'Resend verification email' });

  // Disabled until policy is ready and enforced captcha token is solved
  expect(resendBtn).toBeDisabled();
  fireEvent.click(screen.getByText('CaptchaEnforced'));
  expect(resendBtn).toBeDisabled();

  // Submitting form programmatically without token is rejected client-side without calling API
  fireEvent.change(emailInput, { target: { value: 'alice@example.com' } });
  fireEvent.submit(emailInput.closest('form'));
  expect(await screen.findByText('Please complete the CAPTCHA')).toBeInTheDocument();
  expect(adapter).not.toHaveBeenCalled();

  // Solving captcha enables button and submits token
  fireEvent.click(screen.getByText('CaptchaSolve'));
  expect(resendBtn).toBeEnabled();
  fireEvent.click(resendBtn);

  expect(await screen.findByText(/Verification email sent/i)).toBeInTheDocument();
  expect(adapter).toHaveBeenCalledTimes(1);
  const reqConfig = adapter.mock.calls[0][0];
  expect(reqConfig.method).toBe('post');
  expect(reqConfig.url).toBe('/users/reverify-account');
  expect(JSON.parse(reqConfig.data)).toEqual({
    email: 'alice@example.com',
    captcha: 'verify-captcha-token'
  });
});

test('VerifyAccount resend surfaces backend 401 Wrong Captcha without marking sent', async () => {
  adapter.mockImplementation(async () => {
    const err = new Error('Unauthorized');
    err.response = { status: 401, data: { error: 'Wrong Captcha' } };
    throw err;
  });

  renderAt('/verify-account');
  expect(await screen.findByText(/Missing verification parameters/i)).toBeInTheDocument();

  fireEvent.click(screen.getByText('CaptchaReadyOff'));
  fireEvent.change(screen.getByPlaceholderText('Your email'), { target: { value: 'alice@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Resend verification email' }));

  expect(await screen.findByText('Wrong Captcha')).toBeInTheDocument();
  expect(screen.queryByText(/Verification email sent/i)).not.toBeInTheDocument();
});
