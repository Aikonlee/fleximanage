import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Login from './Login';
import api from '../services/api';
import { clearSession, getRefreshToken } from '../auth/session';

vi.mock('../components/auth/TurnstileChallenge', () => ({ default: ({ onPolicy }) => <button onClick={() => onPolicy({ ready: true, enforced: false })}>Ready</button> }));
const token = `header.${btoa(JSON.stringify({ _id: 'user', account: 'account', org: 'A', exp: Math.floor(Date.now() / 1000) + 3600 }))}.signature`;
beforeEach(() => { localStorage.clear(); clearSession(); });
test('password login saves the refresh token from the response header', async () => {
  api.defaults.adapter = vi.fn(async config => ({ config, status: 200, headers: { 'refresh-jwt': token, 'refresh-token': 'refresh-secret' }, data: { token } }));
  const onLogin = vi.fn();
  render(<MemoryRouter><Login onLogin={onLogin} /></MemoryRouter>);
  fireEvent.click(screen.getByText('Ready'));
  fireEvent.change(screen.getByPlaceholderText('Enter username'), { target: { value: 'test' } });
  fireEvent.change(screen.getByPlaceholderText('Enter password'), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
  await waitFor(() => expect(onLogin).toHaveBeenCalledTimes(1));
  expect(localStorage.getItem('token')).toBe(token);
  expect(api.defaults.adapter.mock.calls[0][0].authFlow).toBe(true);
  expect(getRefreshToken()).toBe('refresh-secret');
});

test('password login rejects an incomplete token pair', async () => {
  api.defaults.adapter = vi.fn(async config => ({ config, status: 200, headers: { 'refresh-jwt': token }, data: { token } }));
  const onLogin = vi.fn();
  render(<MemoryRouter><Login onLogin={onLogin} /></MemoryRouter>);
  fireEvent.click(screen.getByText('Ready'));
  fireEvent.change(screen.getByPlaceholderText('Enter username'), { target: { value: 'test' } });
  fireEvent.change(screen.getByPlaceholderText('Enter password'), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
  expect(await screen.findByText('Login failed: No token received')).toBeInTheDocument();
  expect(onLogin).not.toHaveBeenCalled();
  expect(localStorage.getItem('token')).toBeNull();
});
