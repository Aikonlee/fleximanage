import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Form, Modal } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { useAuth } from '../../auth/AuthContext';
import { decodeJwtPayload } from '../../auth/permissions';
import { clearSession, setSessionTokens } from '../../auth/session';
import MfaChallenge from './MfaChallenge';
import TurnstileChallenge from './TurnstileChallenge';

const isReauthRequired = (reason) => (
  reason?.response?.data?.code === 'REAUTH_REQUIRED' ||
  (reason?.response?.status === 403 &&
    /recent reauthentication required/i.test(reason?.response?.data?.error || ''))
);

export default function MfaSettings() {
  const { token, payload } = useAuth();
  const navigate = useNavigate();
  const currentUsername = (payload?.username || '').trim();
  const currentUserId = payload?._id || null;
  const [enabled, setEnabled] = useState(null);
  const [showSetup, setShowSetup] = useState(false);
  const [codes, setCodes] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reauthState, setReauthState] = useState(null);
  const [showReauth, setShowReauth] = useState(false);
  const [reauthPassword, setReauthPassword] = useState('');
  const [reauthError, setReauthError] = useState('');
  const [reauthBusy, setReauthBusy] = useState(false);
  const [reauthLoginToken, setReauthLoginToken] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaPolicy, setCaptchaPolicy] = useState({ ready: false, enforced: true });
  const [captchaReset, setCaptchaReset] = useState(0);

  useEffect(() => {
    api.get('/users/mfa/isEnabled').then(response => setEnabled(response.data.isEnabled))
      .catch(reason => setError(reason.response?.data?.error || 'Unable to load two-factor settings'));
  }, []);

  const requestRecoveryCodes = useCallback(async ({ skipConfirm = false } = {}) => {
    if (!skipConfirm && !window.confirm('Generate new recovery codes? Existing codes will stop working.')) return;
    setBusy(true);
    setError('');
    setReauthState(null);
    try {
      const response = await api.get('/users/mfa/generateRecoveryCodes', { params: { regenerate: true } });
      setCodes(response.data.codes || []);
    } catch (reason) {
      if (isReauthRequired(reason)) {
        setReauthState({
          action: 'recovery',
          message: reason.response?.data?.error || 'Recent reauthentication required for this operation'
        });
      } else {
        setError(reason.response?.data?.error || 'Unable to generate recovery codes');
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const handleSetupReauthRequired = useCallback((message) => {
    setShowSetup(false);
    setError('');
    setReauthState({
      action: 'setup',
      message: message || 'Recent reauthentication required for MFA enrollment'
    });
  }, []);

  const openReauthModal = () => {
    setReauthPassword('');
    setReauthError('');
    setReauthLoginToken('');
    setCaptchaToken('');
    setCaptchaReset(value => value + 1);
    setShowReauth(true);
  };

  const closeReauthModal = () => {
    setShowReauth(false);
    setReauthPassword('');
    setReauthError('');
    setReauthLoginToken('');
  };

  const matchesCurrentIdentity = (candidateToken) => {
    const claims = decodeJwtPayload(candidateToken);
    if (!claims) return false;
    const isLoginChallenge = claims.type === 'login';
    const candidateUserId = isLoginChallenge ? claims.userId : claims._id;
    if (currentUserId) {
      if (!candidateUserId || String(candidateUserId) !== String(currentUserId)) {
        return false;
      }
    }
    if (!isLoginChallenge && currentUsername && claims.username &&
      claims.username.toLowerCase() !== currentUsername.toLowerCase()) {
      return false;
    }
    return Boolean(currentUserId || (!isLoginChallenge && currentUsername && claims.username));
  };

  const handleReauthComplete = () => {
    const pendingAction = reauthState?.action;
    closeReauthModal();
    setReauthState(null);
    setError('');
    if (pendingAction === 'recovery') {
      requestRecoveryCodes({ skipConfirm: true });
    } else if (pendingAction === 'setup') {
      setShowSetup(true);
    }
  };

  const handleReauthSubmit = async (event) => {
    event.preventDefault();
    setReauthError('');
    if (!currentUsername) {
      setReauthError('Unable to determine the current signed-in account.');
      return;
    }
    if (!captchaPolicy.ready || (captchaPolicy.enforced && !captchaToken)) {
      setReauthError('Please complete the CAPTCHA');
      return;
    }
    setReauthBusy(true);
    try {
      const response = await api.post('/users/login', {
        username: currentUsername,
        password: reauthPassword,
        captcha: captchaToken || undefined
      }, { authFlow: true });

      const hasProcessTokenOnly = decodeJwtPayload(response.data?.token)?.type === 'login';
      if (hasProcessTokenOnly) {
        if (!matchesCurrentIdentity(response.data.token)) {
          setReauthError('Re-authentication must match the currently signed-in account.');
          setReauthPassword('');
          return;
        }
        setReauthLoginToken(response.data.token);
        setReauthPassword('');
        return;
      }

      const finalToken = response.data?.token || response.headers['refresh-jwt'] || response.headers['Refresh-JWT'];
      const refreshToken = response.headers['refresh-token'];
      if (finalToken && refreshToken) {
        if (!matchesCurrentIdentity(finalToken)) {
          setReauthError('Re-authentication must match the currently signed-in account.');
          setReauthPassword('');
          return;
        }
        setSessionTokens(finalToken, refreshToken);
        handleReauthComplete();
      } else {
        setReauthError('Re-authentication failed: No session returned');
      }
    } catch (reason) {
      setReauthError(reason.response?.data?.error || 'Re-authentication failed. Please check your credentials and try again.');
      setCaptchaToken('');
      setCaptchaReset(value => value + 1);
    } finally {
      setReauthBusy(false);
    }
  };

  const handleSignInAgain = async () => {
    try {
      await api.get('/users/logout');
    } catch (_) {
      // Best effort: proceed to fresh sign-in even if logout call fails.
    } finally {
      clearSession();
      navigate('/login', { replace: true });
    }
  };

  return <section className="card mt-3"><div className="card-body">
    <h3 className="h5">Two-factor authentication</h3>
    {error && <Alert variant="danger">{error}</Alert>}
    {reauthState && <Alert variant="warning" role="alert">
      <p className="mb-2">{reauthState.message}. Please re-authenticate to continue.</p>
      <div className="d-flex gap-2 flex-wrap">
        <Button size="sm" variant="primary" onClick={openReauthModal}>Re-authenticate</Button>
        <Button size="sm" variant="outline-secondary" onClick={handleSignInAgain}>Sign out and sign in again</Button>
      </div>
    </Alert>}
    {enabled === null ? <p>Loading...</p> : enabled ? <>
      <p>Authenticator verification is enabled.</p>
      <Button disabled={busy} onClick={() => requestRecoveryCodes()}>Generate recovery codes</Button>
    </> : <><p>Protect sign-in with an authenticator app.</p><Button onClick={() => { setError(''); setReauthState(null); setShowSetup(true); }}>Set up two-factor authentication</Button></>}
    {codes.length > 0 && <Alert variant="warning" className="mt-3"><strong>Save these codes now. Each code works once.</strong><ul className="user-select-all">{codes.map(code => <li key={code}><code>{code}</code></li>)}</ul><Button variant="outline-secondary" onClick={() => setCodes([])}>I have saved these codes</Button></Alert>}
    <Modal show={showSetup} onHide={() => setShowSetup(false)} centered><Modal.Body>
      {showSetup && <MfaChallenge
        loginToken={token}
        expectedUserId={currentUserId}
        expectedUsername={currentUsername}
        onAuthenticated={() => { setEnabled(true); setShowSetup(false); }}
        onCancel={() => setShowSetup(false)}
        onReauthRequired={handleSetupReauthRequired}
      />}
    </Modal.Body></Modal>
    <Modal show={showReauth} onHide={closeReauthModal} centered>
      <Modal.Header closeButton>
        <Modal.Title className="h5">Re-authenticate to continue</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {reauthLoginToken ? (
          <MfaChallenge
            loginToken={reauthLoginToken}
            expectedUserId={currentUserId}
            expectedUsername={currentUsername}
            onAuthenticated={handleReauthComplete}
            onCancel={closeReauthModal}
          />
        ) : (
          <Form onSubmit={handleReauthSubmit}>
            {reauthError && <Alert variant="danger">{reauthError}</Alert>}
            <Form.Group className="mb-3" controlId="reauth-username">
              <Form.Label>Username</Form.Label>
              <Form.Control
                type="text"
                value={currentUsername}
                readOnly
                aria-readonly="true"
              />
            </Form.Group>
            <Form.Group className="mb-3" controlId="reauth-password">
              <Form.Label>Password</Form.Label>
              <Form.Control
                type="password"
                value={reauthPassword}
                onChange={(event) => setReauthPassword(event.target.value)}
                autoComplete="current-password"
                autoFocus
                required
              />
            </Form.Group>
            <TurnstileChallenge onToken={setCaptchaToken} onPolicy={setCaptchaPolicy} resetKey={captchaReset} />
            <div className="d-flex justify-content-end gap-2">
              <Button variant="outline-secondary" onClick={closeReauthModal} disabled={reauthBusy}>Cancel</Button>
              <Button
                type="submit"
                variant="primary"
                disabled={reauthBusy || !captchaPolicy.ready || (captchaPolicy.enforced && !captchaToken)}
              >
                {reauthBusy ? 'Verifying...' : 'Confirm sign-in'}
              </Button>
            </div>
          </Form>
        )}
      </Modal.Body>
    </Modal>
  </div></section>;
}
