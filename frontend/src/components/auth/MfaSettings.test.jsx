import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import MfaSettings from './MfaSettings';
import { AuthProvider } from '../../auth/AuthContext';
import { clearSession, getSessionToken, setSessionTokens } from '../../auth/session';
import api from '../../services/api';

vi.mock('./TurnstileChallenge', () => {
  function MockTurnstileChallenge({ onPolicy }) {
    React.useEffect(() => {
      onPolicy({ enforced: false, ready: true });
    }, [onPolicy]);
    return null;
  }
  return { default: MockTurnstileChallenge };
});

const makeJwt = (claims) => (
  `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({
    _id: 'user-1',
    username: 'alice@example.com',
    account: 'acct-1',
    org: 'org-1',
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims
  }))}.signature`
);

// Matches production getLoginProcessToken() shape in backend/tokens.js:
// carries `type: 'login'` and `userId`, with NO `_id` or `username`.
const makeLoginChallengeJwt = (claims = {}) => (
  `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({
    type: 'login',
    userId: 'user-1',
    authVersion: 0,
    mfaEnabled: true,
    exp: Math.floor(Date.now() / 1000) + 180,
    ...claims
  }))}.signature`
);

const adapter = vi.fn();

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

function renderSettings() {
  return render(
    <MemoryRouter initialEntries={['/users/profile']}>
      <AuthProvider>
        <MfaSettings />
        <LocationProbe />
      </AuthProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  clearSession();
  adapter.mockReset();
  api.defaults.adapter = adapter;
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('prompts for reauthentication on 403 REAUTH_REQUIRED and retries recovery code generation', async () => {
  const staleJwt = makeJwt({ authTime: Math.floor(Date.now() / 1000) - 3600, mfaVerified: true });
  const freshJwt = makeJwt({ authTime: Math.floor(Date.now() / 1000), mfaVerified: true });
  const loginChallengeJwt = makeLoginChallengeJwt({ userId: 'user-1', mfaEnabled: true });
  setSessionTokens(staleJwt, 'stale-refresh');

  let recoveryAttempt = 0;
  adapter.mockImplementation(async (config) => {
    if (config.url === '/users/mfa/isEnabled') {
      return { config, status: 200, headers: {}, data: { isEnabled: true } };
    }
    if (config.url === '/users/mfa/generateRecoveryCodes') {
      recoveryAttempt += 1;
      if (recoveryAttempt === 1) {
        return Promise.reject({
          config,
          response: {
            status: 403,
            data: {
              error: 'Recent reauthentication required for this operation',
              code: 'REAUTH_REQUIRED'
            }
          }
        });
      }
      expect(config.headers.Authorization).toBe(`Bearer ${freshJwt}`);
      return { config, status: 200, headers: {}, data: { codes: ['CODE-1111', 'CODE-2222'] } };
    }
    if (config.url === '/users/login') {
      return { config, status: 200, headers: {}, data: { name: 'Alice', token: loginChallengeJwt } };
    }
    if (config.url === '/users/login/methods') {
      return { config, status: 200, headers: {}, data: { methods: { authenticatorApp: 1, recoveryCodes: 1 } } };
    }
    if (config.url === '/users/mfa/verify') {
      return {
        config,
        status: 200,
        headers: { 'refresh-jwt': freshJwt, 'refresh-token': 'fresh-refresh' },
        data: { status: 'logged in' }
      };
    }
    throw new Error(`Unexpected request: ${config.method} ${config.url}`);
  });

  renderSettings();

  fireEvent.click(await screen.findByRole('button', { name: 'Generate recovery codes' }));

  expect(await screen.findByText(/Recent reauthentication required/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Re-authenticate' }));

  fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'SecretPass123!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm sign-in' }));

  // MFA challenge appears inside reauth modal because MFA is enabled.
  fireEvent.change(await screen.findByLabelText('Authenticator code'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify', exact: true }));

  // After re-auth completes, recovery code generation retries automatically and shows the codes.
  expect(await screen.findByText('CODE-1111')).toBeInTheDocument();
  expect(screen.getByText('CODE-2222')).toBeInTheDocument();
  expect(getSessionToken()).toBe(freshJwt);
});

test('prompts for reauthentication when MFA enrollment receives 403 REAUTH_REQUIRED and reopens setup after sign-in', async () => {
  const staleJwt = makeJwt({ authTime: Math.floor(Date.now() / 1000) - 3600, mfaVerified: false });
  const freshJwt = makeJwt({ authTime: Math.floor(Date.now() / 1000), mfaVerified: false });
  setSessionTokens(staleJwt, 'stale-refresh');

  adapter.mockImplementation(async (config) => {
    if (config.url === '/users/mfa/isEnabled') {
      return { config, status: 200, headers: {}, data: { isEnabled: false } };
    }
    if (config.url === '/users/login/methods') {
      return { config, status: 200, headers: {}, data: { methods: { authenticatorApp: 0, recoveryCodes: 0 } } };
    }
    if (config.url === '/users/mfa/getMfaConfigUri') {
      if (config.headers.Authorization === `Bearer ${staleJwt}`) {
        return Promise.reject({
          config,
          response: {
            status: 403,
            data: {
              error: 'Recent reauthentication required for MFA enrollment',
              code: 'REAUTH_REQUIRED'
            }
          }
        });
      }
      return {
        config,
        status: 200,
        headers: {},
        data: { configUri: 'otpauth://totp/Test?secret=FRESHSETUPKEY&issuer=Test' }
      };
    }
    if (config.url === '/users/login') {
      return {
        config,
        status: 200,
        headers: { 'refresh-jwt': freshJwt, 'refresh-token': 'fresh-refresh' },
        data: { name: 'Alice', status: 'logged in' }
      };
    }
    throw new Error(`Unexpected request: ${config.method} ${config.url}`);
  });

  renderSettings();

  fireEvent.click(await screen.findByRole('button', { name: 'Set up two-factor authentication' }));

  expect(await screen.findByText(/Recent reauthentication required for MFA enrollment/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Re-authenticate' }));

  fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'SecretPass123!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm sign-in' }));

  // Setup modal reopens with the fresh session token and renders the authenticator setup key.
  expect(await screen.findByText('FRESHSETUPKEY')).toBeInTheDocument();
  expect(getSessionToken()).toBe(freshJwt);
});

test('allows signing out and navigating to login from the reauthentication prompt', async () => {
  const staleJwt = makeJwt({ authTime: Math.floor(Date.now() / 1000) - 3600, mfaVerified: true });
  setSessionTokens(staleJwt, 'stale-refresh');

  adapter.mockImplementation(async (config) => {
    if (config.url === '/users/mfa/isEnabled') {
      return { config, status: 200, headers: {}, data: { isEnabled: true } };
    }
    if (config.url === '/users/mfa/generateRecoveryCodes') {
      return Promise.reject({
        config,
        response: {
          status: 403,
          data: { error: 'Recent reauthentication required for this operation', code: 'REAUTH_REQUIRED' }
        }
      });
    }
    if (config.url === '/users/logout') {
      return { config, status: 200, headers: {}, data: { status: 'logged out' } };
    }
    throw new Error(`Unexpected request: ${config.method} ${config.url}`);
  });

  renderSettings();

  fireEvent.click(await screen.findByRole('button', { name: 'Generate recovery codes' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Sign out and sign in again' }));

  await waitFor(() => expect(getSessionToken()).toBeNull());
  expect(screen.getByTestId('location')).toHaveTextContent('/login');
});

test('reauthentication locks username as read-only and refuses to replace session with a different identity', async () => {
  const staleJwt = makeJwt({
    _id: 'user-1',
    username: 'alice@example.com',
    authTime: Math.floor(Date.now() / 1000) - 3600,
    mfaVerified: false
  });
  const otherUserJwt = makeJwt({
    _id: 'user-2',
    username: 'bob@example.com',
    authTime: Math.floor(Date.now() / 1000),
    mfaVerified: false
  });
  setSessionTokens(staleJwt, 'stale-refresh');

  let loginBody = null;
  let recoveryAttempts = 0;
  adapter.mockImplementation(async (config) => {
    if (config.url === '/users/mfa/isEnabled') {
      return { config, status: 200, headers: {}, data: { isEnabled: true } };
    }
    if (config.url === '/users/mfa/generateRecoveryCodes') {
      recoveryAttempts += 1;
      return Promise.reject({
        config,
        response: {
          status: 403,
          data: { error: 'Recent reauthentication required for this operation', code: 'REAUTH_REQUIRED' }
        }
      });
    }
    if (config.url === '/users/login') {
      loginBody = JSON.parse(config.data);
      // Simulate server returning a different user's credentials.
      return {
        config,
        status: 200,
        headers: { 'refresh-jwt': otherUserJwt, 'refresh-token': 'bob-refresh' },
        data: { name: 'Bob', status: 'logged in' }
      };
    }
    throw new Error(`Unexpected request: ${config.method} ${config.url}`);
  });

  renderSettings();

  fireEvent.click(await screen.findByRole('button', { name: 'Generate recovery codes' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Re-authenticate' }));

  const usernameInput = await screen.findByLabelText('Username');
  expect(usernameInput).toHaveAttribute('readonly');
  expect(usernameInput).toHaveValue('alice@example.com');

  // Attempting to edit the username must not alter the submitted identity.
  fireEvent.change(usernameInput, { target: { value: 'bob@example.com' } });
  expect(usernameInput).toHaveValue('alice@example.com');

  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'SecretPass123!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm sign-in' }));

  expect(await screen.findByText(/must match the currently signed-in account/i)).toBeInTheDocument();
  expect(loginBody.username).toBe('alice@example.com');
  expect(getSessionToken()).toBe(staleJwt);
  expect(recoveryAttempts).toBe(1);
});

test('reauthentication accepts same-account production login challenge (userId claim) and rejects mismatched userId', async () => {
  const staleJwt = makeJwt({
    _id: 'user-1',
    username: 'alice@example.com',
    authTime: Math.floor(Date.now() / 1000) - 3600,
    mfaVerified: true
  });
  const freshJwt = makeJwt({
    _id: 'user-1',
    username: 'alice@example.com',
    authTime: Math.floor(Date.now() / 1000),
    mfaVerified: true
  });
  const wrongLoginChallengeJwt = makeLoginChallengeJwt({ userId: 'user-2', mfaEnabled: true });
  const sameUserLoginChallengeJwt = makeLoginChallengeJwt({ userId: 'user-1', mfaEnabled: true });

  // Verify the production login challenge fixture carries userId and omits _id and username.
  const decodedSame = JSON.parse(atob(sameUserLoginChallengeJwt.split('.')[1]));
  expect(decodedSame).toMatchObject({ type: 'login', userId: 'user-1', mfaEnabled: true });
  expect(decodedSame._id).toBeUndefined();
  expect(decodedSame.username).toBeUndefined();

  setSessionTokens(staleJwt, 'stale-refresh');

  let loginAttempt = 0;
  let recoveryAttempt = 0;
  adapter.mockImplementation(async (config) => {
    if (config.url === '/users/mfa/isEnabled') {
      return { config, status: 200, headers: {}, data: { isEnabled: true } };
    }
    if (config.url === '/users/mfa/generateRecoveryCodes') {
      recoveryAttempt += 1;
      if (recoveryAttempt === 1) {
        return Promise.reject({
          config,
          response: {
            status: 403,
            data: { error: 'Recent reauthentication required for this operation', code: 'REAUTH_REQUIRED' }
          }
        });
      }
      expect(config.headers.Authorization).toBe(`Bearer ${freshJwt}`);
      return { config, status: 200, headers: {}, data: { codes: ['SAME-ACCT-1'] } };
    }
    if (config.url === '/users/login') {
      loginAttempt += 1;
      return {
        config,
        status: 200,
        headers: {},
        data: {
          name: loginAttempt === 1 ? 'Bob' : 'Alice',
          token: loginAttempt === 1 ? wrongLoginChallengeJwt : sameUserLoginChallengeJwt
        }
      };
    }
    if (config.url === '/users/login/methods') {
      return { config, status: 200, headers: {}, data: { methods: { authenticatorApp: 1, recoveryCodes: 1 } } };
    }
    if (config.url === '/users/mfa/verify') {
      return {
        config,
        status: 200,
        headers: { 'refresh-jwt': freshJwt, 'refresh-token': 'fresh-refresh' },
        data: { status: 'logged in' }
      };
    }
    throw new Error(`Unexpected request: ${config.method} ${config.url}`);
  });

  renderSettings();

  fireEvent.click(await screen.findByRole('button', { name: 'Generate recovery codes' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Re-authenticate' }));

  // First attempt returns a login challenge for a different userId: must be rejected.
  fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'SecretPass123!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm sign-in' }));
  expect(await screen.findByText(/must match the currently signed-in account/i)).toBeInTheDocument();
  expect(screen.queryByLabelText('Authenticator code')).not.toBeInTheDocument();
  expect(getSessionToken()).toBe(staleJwt);

  // Second attempt returns a production login challenge for user-1 (userId only): must proceed and succeed.
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'SecretPass123!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm sign-in' }));
  fireEvent.change(await screen.findByLabelText('Authenticator code'), { target: { value: '654321' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify', exact: true }));

  expect(await screen.findByText('SAME-ACCT-1')).toBeInTheDocument();
  expect(getSessionToken()).toBe(freshJwt);
});
