import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import TurnstileChallenge from '../components/auth/TurnstileChallenge';
import api from '../services/api';

// Simple account verification page. Extracts id from query string and token (t)
// from the URL fragment (#t=...) so tokens are never sent in HTTP request lines
// or logged in nginx error logs, then POSTs them to /api/users/verify-account.
// Note: legacy emails carrying &t=<token> in the query string will no longer work.
export default function VerifyAccount () {
  const location = useLocation();
  const navigate = useNavigate();
  const [verifyParams] = useState(() => {
    const searchParams = new URLSearchParams(location.search);
    const hashParams = new URLSearchParams((location.hash || '').replace(/^#/, ''));
    return {
      id: (searchParams.get('id') || '').trim(),
      token: (hashParams.get('t') || '').trim()
    };
  });
  const submittedRef = useRef(false);
  const [status, setStatus] = useState('pending'); // pending | success | already | error
  const [message, setMessage] = useState('Verifying your account...');
  const [resendEmail, setResendEmail] = useState('');
  const [resendState, setResendState] = useState('idle'); // idle | sending | sent
  const [resendError, setResendError] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaPolicy, setCaptchaPolicy] = useState({ ready: false, enforced: true });
  const [captchaReset, setCaptchaReset] = useState(0);

  const handleResend = async (e) => {
    e.preventDefault();
    if (!resendEmail) return;
    if (!captchaPolicy.ready || (captchaPolicy.enforced && !captchaToken)) {
      setResendError('Please complete the CAPTCHA');
      return;
    }
    setResendError('');
    setResendState('sending');
    try {
      await api.post('/users/reverify-account', {
        email: resendEmail,
        captcha: captchaToken || undefined
      });
      setResendState('sent');
      setCaptchaToken('');
      setCaptchaReset(value => value + 1);
    } catch (err) {
      const apiError = err.response?.data?.error;
      setResendError(apiError || 'Failed to resend verification email. Please try again.');
      setResendState('idle');
      setCaptchaToken('');
      setCaptchaReset(value => value + 1);
    }
  };

  useEffect(() => {
    // Clear the URL fragment (and query) before any API call so the token does
    // not linger in browser history or leak via client-side telemetry.
    const hasLocationParams = Boolean(location.search || location.hash);
    if (hasLocationParams) {
      navigate(location.pathname, { replace: true, state: location.state });
    }
    const hasWindowParams = typeof window !== 'undefined' &&
      Boolean(window.location?.search || window.location?.hash);
    if (hasWindowParams && window.history && typeof window.history.replaceState === 'function') {
      window.history.replaceState(window.history.state, '', location.pathname);
    }
    if (submittedRef.current) return;
    submittedRef.current = true;

    const { id, token } = verifyParams;
    if (!id || !token) {
      setStatus('error');
      setMessage('Missing verification parameters. Please use the link from your email.');
      return;
    }
    (async () => {
      try {
        const resp = await api.post('/users/verify-account', { id, token });
        if (resp.data?.status === 'account verified') {
          setStatus('success');
          setMessage('Your account has been verified. You can now sign in.');
          setTimeout(() => navigate('/login', { replace: true }), 2500);
        } else if (resp.data?.status === 'account already verified') {
          setStatus('already');
          setMessage('Your account is already verified. You can sign in.');
          setTimeout(() => navigate('/login', { replace: true }), 2000);
        } else {
          setStatus('success');
          setMessage('Verification completed. You can sign in.');
          setTimeout(() => navigate('/login', { replace: true }), 2500);
        }
      } catch (e) {
        setStatus('error');
        if (e.response?.data?.error === 'Verification Error') {
          setMessage('Verification failed. The link may be invalid or already used. If you already verified, just sign in.');
        } else {
          setMessage('Unexpected error verifying account. Please try again or request a new verification email.');
        }
      }
    })();
  }, [location.hash, location.pathname, location.search, location.state, navigate, verifyParams]);

  const color = status === 'success' || status === 'already' ? 'success' : (status === 'error' ? 'danger' : 'secondary');

  return (
    <div className="d-flex align-items-center justify-content-center" style={{ minHeight: '60vh' }}>
      <div className={`alert alert-${color}`} style={{ maxWidth: 560 }}>
        <h5 className="mb-2">Account Verification</h5>
        <div>{message}</div>
        {status === 'error' && (
          <div className="mt-3">
            <button className="btn btn-outline-primary btn-sm me-2" onClick={() => window.location.reload()}>Retry</button>
            <button className="btn btn-link btn-sm" onClick={() => navigate('/login')}>Go to Login</button>
            {resendState === 'sent' ? (
              <div className="mt-3 small">Verification email sent (if that address is registered) - check your inbox.</div>
            ) : (
              <form className="mt-3" onSubmit={handleResend}>
                <TurnstileChallenge onToken={setCaptchaToken} onPolicy={setCaptchaPolicy} resetKey={captchaReset} />
                {resendError && <div role="alert" className="text-danger small mb-2">{resendError}</div>}
                <div className="d-flex gap-2">
                  <input
                    type="email" className="form-control form-control-sm" style={{ maxWidth: 260 }}
                    placeholder="Your email" value={resendEmail}
                    onChange={(e) => setResendEmail(e.target.value)} required
                  />
                  <button
                    type="submit"
                    className="btn btn-sm btn-outline-secondary"
                    disabled={resendState === 'sending' || !captchaPolicy.ready || (captchaPolicy.enforced && !captchaToken)}
                  >
                    {resendState === 'sending' ? 'Sending...' : 'Resend verification email'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
        {(status === 'success' || status === 'already') && (
          <div className="mt-3 small text-muted">Redirecting to login...</div>
        )}
      </div>
    </div>
  );
}
