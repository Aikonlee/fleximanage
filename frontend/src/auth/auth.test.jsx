import React from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
import { setSessionToken, clearSession, validPayload } from './session';
import { hasPermission } from './permissions';
import PermissionButton from '../components/common/PermissionButton';
import api from '../services/api';

const token = (claims = {}) => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, ...claims }))}.signature`;
function SessionProbe() {
  const { orgName, isAdmin, isAuthenticated } = useAuth();
  return <><span data-testid="session">{`${isAuthenticated}:${orgName}:${isAdmin}`}</span>
    <PermissionButton permKey="devices" method="delete" onClick={() => {}}>Delete device</PermissionButton></>;
}
beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); });
test('organization refresh updates headers and operation permissions without reload', () => {
  setSessionToken(token({ org: 'A', orgName: 'Alpha', admin: true, perms: { devices: 15 } }));
  render(<AuthProvider><SessionProbe /></AuthProvider>);
  expect(screen.getByTestId('session').textContent).toBe('true:Alpha:true');
  expect(screen.getByText('Delete device').disabled).toBe(false);
  act(() => setSessionToken(token({ org: 'B', orgName: 'Beta', perms: { devices: 1 } })));
  expect(screen.getByTestId('session').textContent).toBe('true:Beta:false');
  expect(screen.getByText('Delete device').disabled).toBe(true);
});
test('logout clears all authentication materials and other tabs synchronize', () => {
  setSessionToken(token({ orgName: 'Alpha' }));
  localStorage.setItem('refreshToken', 'refresh');
  localStorage.setItem('loginToken', 'process');
  render(<AuthProvider><SessionProbe /></AuthProvider>);
  act(() => { localStorage.removeItem('token'); fireEvent(window, new StorageEvent('storage', { key: 'token' })); });
  expect(screen.getByTestId('session').textContent).toBe('false::false');
  act(clearSession);
  expect(localStorage.getItem('refreshToken')).toBeNull();
  expect(localStorage.getItem('loginToken')).toBeNull();
});
test('expired/malformed tokens never authenticate and active sessions expire automatically', () => {
  expect(validPayload('broken')).toBeNull();
  expect(validPayload(token({ type: 'login' }))).toBeNull();
  expect(validPayload(token({ exp: 1 }))).toBeNull();
  vi.useFakeTimers();
  setSessionToken(token({ exp: Math.floor(Date.now() / 1000) + 2 }));
  render(<AuthProvider><SessionProbe /></AuthProvider>);
  act(() => vi.advanceTimersByTime(2100));
  expect(screen.getByTestId('session').textContent).toBe('false::false');
});
test('access expiry proactively rotates a refreshable session without logging out', async () => {
  const soon = token({ _id: 'user', account: 'account', org: 'A', exp: Math.floor(Date.now() / 1000) + 2 });
  const renewed = token({ _id: 'user', account: 'account', org: 'A', exp: Math.floor(Date.now() / 1000) + 3600 });
  setSessionToken(soon); localStorage.setItem('refreshToken', 'initial-refresh');
  const adapter = vi.fn(async config => ({ config, status: 200, headers: { 'refresh-jwt': renewed, 'refresh-token': 'next-refresh' }, data: {} }));
  api.defaults.adapter = adapter;
  vi.useFakeTimers();
  render(<AuthProvider><SessionProbe /></AuthProvider>);
  await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
  expect(adapter).toHaveBeenCalledTimes(1);
  expect(adapter.mock.calls[0][0].url).toBe('/users/me');
  expect(localStorage.getItem('token')).toBe(renewed);
  expect(localStorage.getItem('refreshToken')).toBe('next-refresh');
  expect(screen.getByTestId('session').textContent).toMatch(/^true:/);
});
test('permission bits match backend including PATCH, deny unknown or missing domains', () => {
  expect(hasPermission({ devices: 1 }, 'devices', 'post')).toBe(false);
  expect(hasPermission({ devices: 2 }, 'devices', 'patch')).toBe(true);
  expect(hasPermission({ devices: 4 }, 'devices', 'put')).toBe(true);
  expect(hasPermission({ devices: 8 }, 'devices', 'delete')).toBe(true);
  expect(hasPermission({}, 'devices')).toBe(false);
  expect(hasPermission({ devices: 15 }, 'devices', 'invalid')).toBe(false);
});
