import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Login from './Login';
import api from '../services/api';
import { clearSession, getRefreshToken } from '../auth/session';

vi.mock('../components/auth/TurnstileChallenge', () => ({
  default: ({ onPolicy, onToken, resetKey }) => (
    <div>
      <span data-testid="captcha-reset">{resetKey}</span>
      <button type="button" onClick={() => onPolicy({ ready: true, enforced: false })}>Ready</button>
      <button type="button" onClick={() => onPolicy({ ready: true, enforced: true })}>Enforce</button>
      <button type="button" onClick={() => onToken('turnstile-token-123')}>Solve</button>
      <button type="button" onClick={() => onToken(`turnstile-token-${resetKey}`)}>SolveNext</button>
    </div>
  )
}));
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

test('resend verification from login gates on captcha and sends token on success', async () => {
  api.defaults.adapter = vi.fn(async config => {
    if (config.url === '/users/login') {
      const err = new Error('Unauthorized');
      err.response = {
        status: 401,
        data: { error: 'Account not verified, check your e-mail and verify' }
      };
      throw err;
    }
    return { config, status: 200, headers: {}, data: { status: 'account reverified' } };
  });

  render(<MemoryRouter><Login onLogin={vi.fn()} /></MemoryRouter>);
  fireEvent.click(screen.getByText('Enforce'));
  fireEvent.click(screen.getByText('Solve'));
  fireEvent.change(screen.getByPlaceholderText('Enter username'), { target: { value: 'unverified@example.com' } });
  fireEvent.change(screen.getByPlaceholderText('Enter password'), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

  const resendBtn = await screen.findByRole('button', { name: 'Resend verification email' });
  // Login failure cleared the single-use captcha token, so resend stays disabled until solved again
  expect(resendBtn).toBeDisabled();

  fireEvent.click(screen.getByText('Solve'));
  expect(resendBtn).toBeEnabled();
  fireEvent.click(resendBtn);

  expect(await screen.findByText(/Verification email sent/i)).toBeInTheDocument();
  const resendCall = api.defaults.adapter.mock.calls.find(([cfg]) => cfg.url === '/users/reverify-account');
  expect(resendCall).toBeTruthy();
  expect(JSON.parse(resendCall[0].data)).toEqual({
    email: 'unverified@example.com',
    captcha: 'turnstile-token-123'
  });
});

test('resend verification from login shows error when backend rejects missing/invalid captcha', async () => {
  api.defaults.adapter = vi.fn(async config => {
    if (config.url === '/users/login') {
      const err = new Error('Unauthorized');
      err.response = {
        status: 401,
        data: { error: 'Account not verified, check your e-mail and verify' }
      };
      throw err;
    }
    const err = new Error('Unauthorized');
    err.response = { status: 401, data: { error: 'Wrong Captcha' } };
    throw err;
  });

  render(<MemoryRouter><Login onLogin={vi.fn()} /></MemoryRouter>);
  fireEvent.click(screen.getByText('Ready'));
  fireEvent.change(screen.getByPlaceholderText('Enter username'), { target: { value: 'unverified@example.com' } });
  fireEvent.change(screen.getByPlaceholderText('Enter password'), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

  const resendBtn = await screen.findByRole('button', { name: 'Resend verification email' });
  fireEvent.click(resendBtn);

  expect(await screen.findByText('Wrong Captcha')).toBeInTheDocument();
  expect(screen.queryByText(/Verification email sent/i)).not.toBeInTheDocument();
});

test('resend then sign-in: mutually exclusive while in flight, clears token and resets challenge at submission', async () => {
  let resolveResend;
  let loginAttempts = 0;
  api.defaults.adapter = vi.fn(config => {
    if (config.url === '/users/login') {
      loginAttempts += 1;
      if (loginAttempts === 1) {
        const err = new Error('Unauthorized');
        err.response = {
          status: 401,
          data: { error: 'Account not verified, check your e-mail and verify' }
        };
        return Promise.reject(err);
      }
      return Promise.resolve({
        config,
        status: 200,
        headers: { 'refresh-jwt': token, 'refresh-token': 'refresh-secret' },
        data: { token }
      });
    }
    return new Promise(resolve => {
      resolveResend = () => resolve({
        config,
        status: 200,
        headers: {},
        data: { status: 'account reverified' }
      });
    });
  });

  const onLogin = vi.fn();
  render(<MemoryRouter><Login onLogin={onLogin} /></MemoryRouter>);
  fireEvent.click(screen.getByText('Enforce'));
  fireEvent.click(screen.getByText('SolveNext'));
  fireEvent.change(screen.getByPlaceholderText('Enter username'), { target: { value: 'unverified@example.com' } });
  fireEvent.change(screen.getByPlaceholderText('Enter password'), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

  const resendBtn = await screen.findByRole('button', { name: 'Resend verification email' });
  expect(screen.getByTestId('captcha-reset')).toHaveTextContent('1');
  expect(resendBtn).toBeDisabled();

  // Solve fresh challenge (resetKey=1 -> turnstile-token-1)
  fireEvent.click(screen.getByText('SolveNext'));
  const signInBtn = screen.getByRole('button', { name: 'Sign In' });
  expect(resendBtn).toBeEnabled();
  expect(signInBtn).toBeEnabled();

  // Click Resend -> immediately clears token, bumps resetKey, and disables both buttons while in flight
  fireEvent.click(resendBtn);
  expect(screen.getByTestId('captcha-reset')).toHaveTextContent('2');
  expect(screen.getByRole('button', { name: 'Sending...' })).toBeDisabled();
  expect(signInBtn).toBeDisabled();

  // Even if the user attempts to submit the form while resend is in flight, login is blocked
  fireEvent.submit(signInBtn.closest('form'));
  expect(api.defaults.adapter.mock.calls.filter(([cfg]) => cfg.url === '/users/login')).toHaveLength(1);

  // Even if non-enforced or a new token is solved while resend is still in flight, Sign In remains disabled
  fireEvent.click(screen.getByText('Ready'));
  expect(signInBtn).toBeDisabled();
  fireEvent.click(screen.getByText('Enforce'));

  // Resolve resend
  await waitFor(() => expect(typeof resolveResend).toBe('function'));
  resolveResend();
  expect(await screen.findByText(/Verification email sent/i)).toBeInTheDocument();

  // Single-use token was cleared at submission, so Sign In remains disabled until Turnstile is solved again
  expect(signInBtn).toBeDisabled();
  fireEvent.click(screen.getByText('SolveNext'));
  expect(signInBtn).toBeEnabled();

  // Now Sign In submits with the fresh token (turnstile-token-2), never reusing turnstile-token-1
  fireEvent.click(signInBtn);
  await waitFor(() => expect(onLogin).toHaveBeenCalledTimes(1));

  const resendCall = api.defaults.adapter.mock.calls.find(([cfg]) => cfg.url === '/users/reverify-account');
  const loginCalls = api.defaults.adapter.mock.calls.filter(([cfg]) => cfg.url === '/users/login');
  expect(JSON.parse(loginCalls[0][0].data).captcha).toBe('turnstile-token-0');
  expect(JSON.parse(resendCall[0].data).captcha).toBe('turnstile-token-1');
  expect(JSON.parse(loginCalls[1][0].data).captcha).toBe('turnstile-token-2');
});

test('sign-in then resend: mutually exclusive while in flight, clears token and resets challenge at submission', async () => {
  const rejectLogins = [];
  api.defaults.adapter = vi.fn(config => {
    if (config.url === '/users/login') {
      return new Promise((_, reject) => {
        rejectLogins.push(() => {
          const err = new Error('Unauthorized');
          err.response = {
            status: 401,
            data: { error: 'Account not verified, check your e-mail and verify' }
          };
          reject(err);
        });
      });
    }
    return Promise.resolve({
      config,
      status: 200,
      headers: {},
      data: { status: 'account reverified' }
    });
  });

  render(<MemoryRouter><Login onLogin={vi.fn()} /></MemoryRouter>);
  fireEvent.click(screen.getByText('Enforce'));
  fireEvent.click(screen.getByText('SolveNext'));
  fireEvent.change(screen.getByPlaceholderText('Enter username'), { target: { value: 'unverified@example.com' } });
  fireEvent.change(screen.getByPlaceholderText('Enter password'), { target: { value: 'secret' } });

  // 1st Sign In: immediately clears token, bumps resetKey, and disables Sign In while in flight
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
  expect(screen.getByTestId('captcha-reset')).toHaveTextContent('1');
  expect(screen.getByRole('button', { name: 'Signing in...' })).toBeDisabled();

  await waitFor(() => expect(rejectLogins).toHaveLength(1));
  rejectLogins[0]();
  const resendBtn = await screen.findByRole('button', { name: 'Resend verification email' });
  expect(resendBtn).toBeDisabled();

  // Solve Turnstile (resetKey=1 -> turnstile-token-1): both buttons become enabled
  fireEvent.click(screen.getByText('SolveNext'));
  expect(resendBtn).toBeEnabled();
  const signInBtn = screen.getByRole('button', { name: 'Sign In' });
  expect(signInBtn).toBeEnabled();

  // 2nd Sign In while Resend was visible: mutually exclusive (Resend unavailable/cannot fire while login is in flight)
  fireEvent.click(signInBtn);
  expect(screen.getByTestId('captcha-reset')).toHaveTextContent('2');
  expect(screen.getByRole('button', { name: 'Signing in...' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Resend verification email' })).not.toBeInTheDocument();
  expect(api.defaults.adapter.mock.calls.filter(([cfg]) => cfg.url === '/users/reverify-account')).toHaveLength(0);

  await waitFor(() => expect(rejectLogins).toHaveLength(2));
  rejectLogins[1]();
  const resendBtnAfterSecondLogin = await screen.findByRole('button', { name: 'Resend verification email' });
  // Token was cleared at submission, so Resend stays disabled until solved again
  expect(resendBtnAfterSecondLogin).toBeDisabled();

  // Solve Turnstile (resetKey=2 -> turnstile-token-2) and click Resend
  fireEvent.click(screen.getByText('SolveNext'));
  expect(resendBtnAfterSecondLogin).toBeEnabled();
  fireEvent.click(resendBtnAfterSecondLogin);
  expect(await screen.findByText(/Verification email sent/i)).toBeInTheDocument();

  const loginCalls = api.defaults.adapter.mock.calls.filter(([cfg]) => cfg.url === '/users/login');
  const resendCalls = api.defaults.adapter.mock.calls.filter(([cfg]) => cfg.url === '/users/reverify-account');
  expect(loginCalls).toHaveLength(2);
  expect(resendCalls).toHaveLength(1);
  expect(JSON.parse(loginCalls[0][0].data).captcha).toBe('turnstile-token-0');
  expect(JSON.parse(loginCalls[1][0].data).captcha).toBe('turnstile-token-1');
  expect(JSON.parse(resendCalls[0][0].data).captcha).toBe('turnstile-token-2');
});
