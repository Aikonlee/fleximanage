import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MfaChallenge from './MfaChallenge';
import api from '../../services/api';
import { clearSession, getRefreshToken } from '../../auth/session';

vi.mock('../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const token = claims => `header.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 180, ...claims }))}.signature`;
beforeEach(() => { localStorage.clear(); clearSession(); vi.clearAllMocks(); });
function methods({ enabled = true, recovery = 1 } = {}) {
  api.get.mockImplementation(async url => ({ data: url.endsWith('/methods')
    ? { methods: { authenticatorApp: enabled ? 1 : 0, recoveryCodes: recovery } }
    : url.endsWith('/isEnabled') ? { isEnabled: enabled }
      : { configUri: 'otpauth://totp/Test?secret=SETUPKEY&issuer=Test' } }));
}
test('interim login token never becomes a session; valid authenticator response completes login', async () => {
  methods(); const authenticated = vi.fn(); const session = token({ _id: 'user', account: 'account', mfaVerified: true });
  api.post.mockResolvedValue({ headers: { 'refresh-jwt': session, 'refresh-token': 'mfa-refresh' } });
  render(<MfaChallenge loginToken={token({ type: 'login' })} onAuthenticated={authenticated} onCancel={() => {}} />);
  fireEvent.change(await screen.findByLabelText('Authenticator code'), { target: { value: '123456' } });
  expect(localStorage.getItem('token')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Verify', exact: true }));
  await waitFor(() => expect(authenticated).toHaveBeenCalledTimes(1));
  expect(localStorage.getItem('token')).toBe(session);
  expect(getRefreshToken()).toBe('mfa-refresh');
});
test('invalid OTP remains on verification screen and recovery uses its own endpoint', async () => {
  methods(); api.post.mockRejectedValueOnce({ response: { data: { error: 'Invalid Code' } } });
  render(<MfaChallenge loginToken={token({ type: 'login' })} onAuthenticated={() => {}} onCancel={() => {}} />);
  fireEvent.change(await screen.findByLabelText('Authenticator code'), { target: { value: '000000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify', exact: true }));
  expect(await screen.findByText('Invalid Code')).toBeTruthy();
  expect(localStorage.getItem('token')).toBeNull();
  fireEvent.change(screen.getByLabelText('Verification method'), { target: { value: 'recovery' } });
  fireEvent.change(screen.getByLabelText('Recovery code'), { target: { value: 'recovery-one' } });
  api.post.mockResolvedValue({ headers: { 'refresh-jwt': token({ _id: 'user', mfaVerified: true }) } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify', exact: true }));
  await waitFor(() => expect(api.post).toHaveBeenLastCalledWith('/users/mfa/verifyRecoveryCode', { recoveryCode: 'recovery-one' }, expect.objectContaining({ authFlow: true })));
});
test('account-forced first setup presents a manual authenticator setup key', async () => {
  methods({ enabled: false, recovery: 0 });
  render(<MfaChallenge loginToken={token({ type: 'login' })} onAuthenticated={() => {}} onCancel={() => {}} />);
  expect(await screen.findByText('SETUPKEY')).toBeTruthy();
  expect(screen.queryByLabelText('Verification method')).toBeNull();
});
test('expired login attempts cannot submit codes', async () => {
  methods();
  render(<MfaChallenge loginToken={token({ type: 'login', exp: 1 })} onAuthenticated={() => {}} onCancel={() => {}} />);
  expect(await screen.findByText(/sign-in attempt expired/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Verify', exact: true })).toBeNull();
});
