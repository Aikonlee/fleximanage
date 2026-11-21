import React, { useEffect, useRef, useState } from 'react';
import api from '../../services/api';

let scriptPromise;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => resolve(window.turnstile);
    script.onerror = () => { script.remove(); scriptPromise = null; reject(new Error('Verification service unavailable. Please retry.')); };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export default function TurnstileChallenge({ onToken, onPolicy, resetKey = 0 }) {
  const container = useRef(null);
  const [config, setConfig] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    api.get('/public/config').then(({ data }) => {
      if (!active) return;
      const policy = { enforced: data.captchaEnforced !== false, ready: true };
      setConfig({ ...policy, key: data.captchaSiteKey }); onPolicy(policy);
    }).catch(() => { if (active) setError('Unable to load verification settings. Please retry.'); });
    return () => { active = false; };
  }, [onPolicy, attempt]);
  useEffect(() => {
    if (!config?.enforced) return undefined;
    if (!config.key) { setError('Verification is not configured. Contact the administrator.'); return undefined; }
    let active = true; let widget;
    onToken(''); setError('');
    const timer = setTimeout(() => { if (active) setError('Verification timed out. Please retry.'); }, 15000);
    loadTurnstile().then(turnstile => {
      if (!active || !container.current) return;
      widget = turnstile.render(container.current, {
        sitekey: config.key,
        callback: token => { if (active) { onToken(token); setError(''); clearTimeout(timer); } },
        'expired-callback': () => { if (active) onToken(''); },
        'error-callback': () => { if (active) { onToken(''); setError('Verification failed. Please retry.'); } }
      });
    }).catch(reason => { if (active) setError(reason.message); });
    return () => {
      active = false; clearTimeout(timer);
      if (widget !== undefined && window.turnstile) window.turnstile.remove(widget);
    };
  }, [config, onToken, resetKey]);
  return <div className="mb-3">
    <div ref={container} />
    {error && <div role="alert" className="alert alert-danger small">{error} <button type="button" className="btn btn-link btn-sm" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry</button></div>}
  </div>;
}
