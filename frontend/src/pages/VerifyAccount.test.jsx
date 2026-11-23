import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import VerifyAccount from './VerifyAccount';
import api from '../services/api';

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
