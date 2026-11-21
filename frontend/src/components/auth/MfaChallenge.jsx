import React, { useEffect, useState } from 'react';
import { Alert, Button, Form } from 'react-bootstrap';
import api from '../../services/api';
import { decodeJwtPayload } from '../../auth/permissions';
import { setSessionTokens } from '../../auth/session';

export default function MfaChallenge({ loginToken, onAuthenticated, onCancel }) {
  const [methods, setMethods] = useState(null);
  const [setupUri, setSetupUri] = useState('');
  const [method, setMethod] = useState('authenticator');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  const headers = { Authorization: `Bearer ${loginToken}` };
  useEffect(() => {
    let active = true;
    const options = { headers: { Authorization: `Bearer ${loginToken}` }, authFlow: true };
    Promise.all([api.get('/users/login/methods', options), api.get('/users/mfa/isEnabled', options)]).then(async ([available, enabled]) => {
      if (!active) return;
      setMethods(available.data.methods);
      if (!enabled.data.isEnabled) {
        const result = await api.get('/users/mfa/getMfaConfigUri', options);
        if (active) setSetupUri(result.data.configUri);
      }
    }).catch(reason => { if (active) setError(reason.response?.data?.error || 'Unable to load two-factor authentication.'); });
    const expires = decodeJwtPayload(loginToken)?.exp;
    const timer = expires ? setTimeout(() => { if (active) setExpired(true); }, Math.max(0, expires * 1000 - Date.now())) : null;
    return () => { active = false; clearTimeout(timer); };
  }, [loginToken]);
  const verify = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const recovery = method === 'recovery';
      const response = await api.post(`/users/mfa/${recovery ? 'verifyRecoveryCode' : 'verify'}`,
        recovery ? { recoveryCode: code.trim() } : { token: code.trim() }, { headers, authFlow: true });
      const token = response.headers['refresh-jwt'];
      const refreshToken = response.headers['refresh-token'];
      if (!token || !refreshToken || decodeJwtPayload(token)?.type === 'login' || decodeJwtPayload(token)?.mfaVerified !== true) throw new Error('No authenticated session returned');
      setSessionTokens(token, refreshToken); onAuthenticated();
    } catch (reason) {
      setError(reason.response?.data?.error || reason.message || 'Verification failed');
    } finally { setBusy(false); }
  };
  let secret = '';
  try { secret = setupUri ? new URL(setupUri).searchParams.get('secret') : ''; } catch (_) { /* malformed URI shown as setup error below */ }
  return <section aria-label="Two-factor authentication">
    <h3 className="h5">Two-factor authentication</h3>
    {error && <Alert variant="danger">{error}</Alert>}
    {expired ? <Alert variant="warning">This sign-in attempt expired. Start again.</Alert> : <>
      {!methods && !error && <p>Loading verification methods...</p>}
      {setupUri && <Alert variant="info">Add this account to your authenticator app using this setup key:<br /><code className="user-select-all">{secret}</code><br /><a href={setupUri}>Open authenticator app</a><p className="mb-0 mt-2">Enter its six-digit code to finish setup.</p></Alert>}
      {!!methods?.recoveryCodes && <Form.Group className="mb-3"><Form.Label>Verification method</Form.Label><Form.Select aria-label="Verification method" value={method} onChange={event => { setMethod(event.target.value); setCode(''); }}><option value="authenticator">Authenticator app</option><option value="recovery">Recovery code</option></Form.Select></Form.Group>}
      {methods && <Form onSubmit={verify}>
        <Form.Group className="mb-3"><Form.Label htmlFor="mfa-code">{method === 'recovery' ? 'Recovery code' : 'Authenticator code'}</Form.Label><Form.Control id="mfa-code" autoComplete="one-time-code" inputMode={method === 'recovery' ? 'text' : 'numeric'} value={code} onChange={event => setCode(event.target.value)} required pattern={method === 'recovery' ? undefined : '[0-9]{6}'} autoFocus /></Form.Group>
        <Button type="submit" disabled={busy || !code.trim()}>{busy ? 'Verifying...' : 'Verify'}</Button>
      </Form>}
    </>}
    <Button variant="link" className="mt-2" disabled={busy} onClick={onCancel}>Back</Button>
  </section>;
}
