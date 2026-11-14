import React, { useEffect, useState } from 'react';
import { Alert, Button, Modal } from 'react-bootstrap';
import api from '../../services/api';
import { useAuth } from '../../auth/AuthContext';
import MfaChallenge from './MfaChallenge';

export default function MfaSettings() {
  const { token } = useAuth();
  const [enabled, setEnabled] = useState(null);
  const [showSetup, setShowSetup] = useState(false);
  const [codes, setCodes] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get('/users/mfa/isEnabled').then(response => setEnabled(response.data.isEnabled))
      .catch(reason => setError(reason.response?.data?.error || 'Unable to load two-factor settings'));
  }, []);
  const generate = async () => {
    if (!window.confirm('Generate new recovery codes? Existing codes will stop working.')) return;
    setBusy(true); setError('');
    try {
      const response = await api.get('/users/mfa/generateRecoveryCodes', { params: { regenerate: true } });
      setCodes(response.data.codes || []);
    } catch (reason) { setError(reason.response?.data?.error || 'Unable to generate recovery codes'); }
    finally { setBusy(false); }
  };
  return <section className="card mt-3"><div className="card-body">
    <h3 className="h5">Two-factor authentication</h3>
    {error && <Alert variant="danger">{error}</Alert>}
    {enabled === null ? <p>Loading...</p> : enabled ? <>
      <p>Authenticator verification is enabled.</p>
      <Button disabled={busy} onClick={generate}>Generate recovery codes</Button>
    </> : <><p>Protect sign-in with an authenticator app.</p><Button onClick={() => setShowSetup(true)}>Set up two-factor authentication</Button></>}
    {codes.length > 0 && <Alert variant="warning" className="mt-3"><strong>Save these codes now. Each code works once.</strong><ul className="user-select-all">{codes.map(code => <li key={code}><code>{code}</code></li>)}</ul><Button variant="outline-secondary" onClick={() => setCodes([])}>I have saved these codes</Button></Alert>}
    <Modal show={showSetup} onHide={() => setShowSetup(false)} centered><Modal.Body>
      {showSetup && <MfaChallenge loginToken={token} onAuthenticated={() => { setEnabled(true); setShowSetup(false); }} onCancel={() => setShowSetup(false)} />}
    </Modal.Body></Modal>
  </div></section>;
}
