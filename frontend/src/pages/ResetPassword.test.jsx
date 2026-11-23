import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, MemoryRouter, useLocation } from 'react-router-dom';
import App from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { getSessionToken, setSessionToken } from '../auth/session';
import api from '../services/api';

vi.mock('../pages/Login', () => ({ default: () => <div>Login page</div> }));
vi.mock('../pages/Register', () => ({ default: () => <div>Register page</div> }));
vi.mock('../pages/VerifyAccount', () => ({ default: () => <div>Verify page</div> }));
vi.mock('../pages/Home', () => ({ default: () => <div>Home page</div> }));
vi.mock('../components/Sidebar', () => ({ default: () => null }));
vi.mock('../components/Header', () => ({ default: () => <div>App header</div> }));

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
      <AuthProvider>
        <App />
        <LocationProbe />
      </AuthProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  adapter.mockReset();
  api.defaults.adapter = adapter;
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('renders reset-password route, reads token from hash, clears URL, and submits to backend reset endpoint', async () => {
  const userId = '507f1f77bcf86cd799439011';
  const resetToken = 'secret-reset-token-value';
  adapter.mockImplementation(async (config) => ({
    config,
    status: 200,
    headers: {},
    data: { status: 'password reset' }
  }));

  renderAt(`/reset-password?id=${userId}#t=${resetToken}`);

  expect(screen.queryByText('Login page')).not.toBeInTheDocument();
  expect(screen.getByText('Reset Your Password')).toBeInTheDocument();

  // Query string and fragment containing the secret token are stripped immediately.
  await waitFor(() => {
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/reset-password$/);
  });
  expect(window.location.search).not.toContain('t=');
  expect(window.location.hash).not.toContain(resetToken);
  expect(screen.getByTestId('location').textContent).not.toContain('t=');
  expect(screen.getByTestId('location').textContent).not.toContain(resetToken);

  fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'NewStrongPass123!' } });
  fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'NewStrongPass123!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reset Password' }));

  await waitFor(() => expect(adapter).toHaveBeenCalledTimes(1));
  const reqConfig = adapter.mock.calls[0][0];
  expect(reqConfig.method).toBe('post');
  expect(reqConfig.url).toBe('/users/reset-password');
  expect(reqConfig.authFlow).toBe(true);
  expect(JSON.parse(reqConfig.data)).toEqual({
    type: 'update',
    id: userId,
    token: resetToken,
    password: 'NewStrongPass123!'
  });

  expect(await screen.findByText(/Your password has been reset/i)).toBeInTheDocument();
});

test('BrowserRouter runs cleanup once, preserves router history state, and still posts id/token', async () => {
  const userId = '507f1f77bcf86cd799439011';
  const resetToken = 'browser-router-reset-token';
  const initialHistoryState = { usr: { from: 'email-link' }, key: 'initial-key', idx: 2 };
  window.history.replaceState(initialHistoryState, '', `/reset-password?id=${userId}#t=${resetToken}`);

  const originalReplaceState = window.history.replaceState.bind(window.history);
  const replaceStateSpy = vi.spyOn(window.history, 'replaceState').mockImplementation((state, unused, url) => (
    originalReplaceState(state, unused, url)
  ));

  let urlDuringPost = null;
  let historyStateDuringPost = null;
  adapter.mockImplementation(async (config) => {
    urlDuringPost = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    historyStateDuringPost = window.history.state;
    return {
      config,
      status: 200,
      headers: {},
      data: { status: 'password reset' }
    };
  });

  render(
    <BrowserRouter>
      <AuthProvider>
        <App />
        <LocationProbe />
      </AuthProvider>
    </BrowserRouter>
  );

  await waitFor(() => {
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/reset-password$/);
  });

  // URL must be stripped immediately with a single history replacement that preserves state.
  expect(window.location.pathname).toBe('/reset-password');
  expect(window.location.search).toBe('');
  expect(window.location.hash).toBe('');
  expect(replaceStateSpy).toHaveBeenCalledTimes(1);
  expect(replaceStateSpy.mock.calls[0][0]).not.toBeNull();
  expect(window.history.state).toEqual(expect.objectContaining({
    usr: { from: 'email-link' },
    idx: 2
  }));
  expect(screen.getByTestId('location-state')).toHaveTextContent('{"from":"email-link"}');

  fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'NewStrongPass123!' } });
  fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'NewStrongPass123!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reset Password' }));

  await waitFor(() => expect(adapter).toHaveBeenCalledTimes(1));
  expect(await screen.findByText(/Your password has been reset/i)).toBeInTheDocument();

  expect(urlDuringPost).toBe('/reset-password');
  expect(historyStateDuringPost).toEqual(expect.objectContaining({
    usr: { from: 'email-link' },
    idx: 2
  }));
  expect(window.history.state).toEqual(expect.objectContaining({
    usr: { from: 'email-link' },
    idx: 2
  }));
  expect(screen.getByTestId('location-state')).toHaveTextContent('{"from":"email-link"}');
  expect(replaceStateSpy).toHaveBeenCalledTimes(1);

  const reqConfig = adapter.mock.calls[0][0];
  expect(reqConfig.method).toBe('post');
  expect(reqConfig.url).toBe('/users/reset-password');
  expect(reqConfig.authFlow).toBe(true);
  expect(JSON.parse(reqConfig.data)).toEqual({
    type: 'update',
    id: userId,
    token: resetToken,
    password: 'NewStrongPass123!'
  });
});

test('shows an error message when backend rejects the reset request', async () => {
  adapter.mockImplementation(async (config) => Promise.reject({
    config,
    response: { status: 500, data: { error: 'Password Reset Error' } }
  }));

  renderAt('/reset-password?id=507f1f77bcf86cd799439011#t=expired-token');

  fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'NewStrongPass123!' } });
  fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'NewStrongPass123!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reset Password' }));

  expect(await screen.findByText(/link may be invalid or expired/i)).toBeInTheDocument();
});

test('shows an error and blocks submission when hash token is missing or only in query string', async () => {
  renderAt('/reset-password?id=507f1f77bcf86cd799439011&t=legacy-query-token');

  await waitFor(() => {
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/reset-password$/);
  });
  expect(screen.getByTestId('location').textContent).not.toContain('t=');
  expect(screen.getByText(/Invalid or incomplete password reset link/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reset Password' })).not.toBeInTheDocument();
  expect(adapter).not.toHaveBeenCalled();
});

test('validates matching passwords before calling backend', async () => {
  renderAt('/reset-password?id=507f1f77bcf86cd799439011#t=some-token');

  fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'PasswordOne123!' } });
  fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'PasswordTwo123!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reset Password' }));

  expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
  expect(adapter).not.toHaveBeenCalled();
});

test('keeps other unauthenticated routes falling back to Login', () => {
  renderAt('/devices');
  expect(screen.getByText('Login page')).toBeInTheDocument();
});

test('renders reset-password and clears URL params even when a user is signed in', async () => {
  const signedInJwt = `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({
    _id: '507f1f77bcf86cd799439011',
    account: '507f1f77bcf86cd799439012',
    org: '507f1f77bcf86cd799439013',
    exp: Math.floor(Date.now() / 1000) + 3600
  }))}.signature`;
  setSessionToken(signedInJwt);

  const userId = '507f1f77bcf86cd799439011';
  const resetToken = 'signed-in-secret-reset-token';
  adapter.mockImplementation(async (config) => ({
    config,
    status: 200,
    headers: {},
    data: { status: 'password reset' }
  }));

  renderAt(`/reset-password?id=${userId}#t=${resetToken}`);

  expect(screen.queryByText('App header')).not.toBeInTheDocument();
  expect(screen.queryByText('Home page')).not.toBeInTheDocument();
  expect(screen.getByText('Reset Your Password')).toBeInTheDocument();

  await waitFor(() => {
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/reset-password$/);
  });
  expect(screen.getByTestId('location').textContent).not.toContain('t=');
  expect(screen.getByTestId('location').textContent).not.toContain(resetToken);

  fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'NewStrongPass123!' } });
  fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'NewStrongPass123!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reset Password' }));

  expect(await screen.findByText(/Your password has been reset/i)).toBeInTheDocument();
  expect(getSessionToken()).toBeNull();
});
