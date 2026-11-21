import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { setSessionToken, getSessionToken } from './auth/session';
import api from './services/api';

vi.mock('./components/Sidebar', () => ({ default: () => null }));
vi.mock('./pages/Home', () => ({ default: () => <div>Home page</div> }));
vi.mock('./pages/Login', () => ({ default: () => <div>Login page</div> }));

const token = () => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ _id: 'user', account: 'account', org: 'org', exp: Math.floor(Date.now() / 1000) + 3600 }))}.signature`;
const adapter = vi.fn();
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}
function renderApp() {
  render(<MemoryRouter initialEntries={['/home']}><AuthProvider><App /><LocationProbe /></AuthProvider></MemoryRouter>);
}
beforeEach(() => {
  localStorage.clear();
  adapter.mockReset();
  api.defaults.adapter = adapter;
});

test('logout revokes the authenticated server session before clearing local state', async () => {
  const currentToken = token();
  setSessionToken(currentToken);
  let finish;
  adapter.mockImplementation(config => new Promise(resolve => {
    finish = () => resolve({ config, status: 200, headers: {}, data: {} });
  }));
  renderApp();
  fireEvent.click(screen.getByTitle('Logout'));
  await waitFor(() => expect(adapter).toHaveBeenCalledTimes(1));
  expect(adapter.mock.calls[0][0]).toMatchObject({ method: 'get', url: '/users/logout', headers: { Authorization: `Bearer ${currentToken}` } });
  expect(getSessionToken()).toBe(currentToken);
  expect(screen.getByTestId('location')).toHaveTextContent('/home');
  finish();
  await waitFor(() => expect(getSessionToken()).toBeNull());
  expect(screen.getByTestId('location')).toHaveTextContent('/login');
  expect(screen.getByText('Login page')).toBeInTheDocument();
});

test('logout still clears the session and returns to login when revocation fails', async () => {
  setSessionToken(token());
  localStorage.setItem('refreshToken', 'refresh');
  localStorage.setItem('loginToken', 'process');
  adapter.mockImplementation(config => Promise.reject({ config, response: { status: 503 } }));
  renderApp();
  fireEvent.click(screen.getByTitle('Logout'));
  await waitFor(() => expect(adapter).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(getSessionToken()).toBeNull());
  expect(localStorage.getItem('refreshToken')).toBeNull();
  expect(localStorage.getItem('loginToken')).toBeNull();
  expect(screen.getByTestId('location')).toHaveTextContent('/login');
  expect(screen.getByText('Login page')).toBeInTheDocument();
});
