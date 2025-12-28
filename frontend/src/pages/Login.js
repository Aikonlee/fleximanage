import React, { useState, useEffect, useRef } from 'react';
import { BRAND_NAME, BRAND_TAGLINE } from '../constants/branding';
import { Card, Form, Button, Alert, Container, Row, Col } from 'react-bootstrap';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { FaUser, FaLock } from 'react-icons/fa';
import api from '../services/api';
import './Login.css';

const Login = ({ onLogin }) => {
  const [credentials, setCredentials] = useState({
    username: '',
    password: ''
  });
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaWidgetId, setCaptchaWidgetId] = useState(null);
  const captchaRenderedRef = useRef(false);
  const location = useLocation();
  const navigate = useNavigate();

  const buildTimeKey = process.env.REACT_APP_TURNSTILE_SITE_KEY;
  const injectedKey = (typeof window !== 'undefined' && (window.__TURNSTILE_SITE_KEY__ || window.__FLEXIWAN_SERVER_CONFIG__?.captchaSiteKey)) || '';
  const [runtimeCaptchaKey, setRuntimeCaptchaKey] = useState('');
  const [captchaEnforced, setCaptchaEnforced] = useState(typeof window !== 'undefined' ? (window.__FLEXIWAN_SERVER_CONFIG__?.captchaEnforced !== false) : true);
  const [captchaWarning, setCaptchaWarning] = useState('');
  
  // Priority: 1. Runtime API Key, 2. Injected Window Key, 3. Build-time Env Key
  const TURNSTILE_SITE_KEY = runtimeCaptchaKey || injectedKey || buildTimeKey;
  const captchaKeySource = runtimeCaptchaKey ? 'runtime' : (injectedKey ? 'injected' : (buildTimeKey ? 'build' : 'none'));

  // Debug flag
  const CAPTCHA_DEBUG = (
    (process.env.REACT_APP_CAPTCHA_DEBUG === '1') ||
    (typeof window !== 'undefined' && (window.__CAPTCHA_DEBUG__ === true || localStorage.getItem('captchaDebug') === '1'))
  );

  // 1. Fetch runtime config
  useEffect(() => {
    api.get('/public/config')
      .then(res => {
        if (res.data?.captchaSiteKey) {
          setRuntimeCaptchaKey(res.data.captchaSiteKey);
        }
        if (typeof res.data?.captchaEnforced === 'boolean') {
          setCaptchaEnforced(res.data.captchaEnforced);
        }
      })
      .catch(err => {
        console.warn('Failed to fetch public config', err);
      });
  }, []);

  // 2. Render logic
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) {
      return;
    }
    if (captchaRenderedRef.current) return;
    if (typeof window === 'undefined') return;

    const ensureRender = () => {
      if (!window.turnstile || !window.turnstile.render) {
        return;
      }
      if (captchaRenderedRef.current) return;
      try {
        const widgetId = window.turnstile.render('#login-turnstile', {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (token) => {
            setCaptchaToken(token);
            setCaptchaWarning(''); // Clear warning on success
          },
          'error-callback': () => {
            setCaptchaToken('');
            setCaptchaWarning('CAPTCHA error occurred. Please refresh.');
          },
          'timeout-callback': () => setCaptchaToken('')
        });
        setCaptchaWidgetId(widgetId);
        captchaRenderedRef.current = true;
      } catch (e) {
        console.warn('Turnstile render failed', e);
      }
    };

    if (!window.turnstile) {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      script.async = true;
      script.defer = true;
      script.onload = ensureRender;
      document.head.appendChild(script);
    } else {
      ensureRender();
    }

    // Watchdog: Increase timeout to 15 seconds for slow networks
    const watchdogMs = 15000; 
    const watchdog = setTimeout(() => {
      if (!captchaRenderedRef.current) {
        const msg = captchaEnforced
          ? 'CAPTCHA failed to load. Please check your network connection to Cloudflare (challenges.cloudflare.com).'
          : 'CAPTCHA unavailable. Proceeding without challenge.';
        setCaptchaWarning(msg);
      }
    }, watchdogMs);

    return () => clearTimeout(watchdog);
  }, [TURNSTILE_SITE_KEY, captchaEnforced]);
  const resetCaptcha = () => {
    if (captchaWidgetId !== null && window.turnstile && window.turnstile.reset) {
      try {
        window.turnstile.reset(captchaWidgetId);
        setCaptchaToken('');
      } catch (e) {
        console.warn('Failed to reset CAPTCHA widget:', e);
      }
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('registered')) {
      const fast = params.get('fast') === '1';
      setInfo(`Registration successful${fast ? ' (auto-verified)' : ''}. You can now sign in.`);
    }
  }, [location.search]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setCredentials(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (TURNSTILE_SITE_KEY && captchaEnforced && !captchaToken) {
        setError('Please complete the CAPTCHA');
        setLoading(false);
        return;
      }

      const response = await api.post('/users/login', {
        username: credentials.username,
        password: credentials.password,
        captcha: captchaToken || undefined
      });

      const hasProcessTokenOnly = response.data?.token && !response.data?.refreshToken;
      if (hasProcessTokenOnly) {
        localStorage.setItem('loginToken', response.data.token);
        setError('2FA authentication required. Feature coming soon.');
        return;
      }

      const finalToken = response.data?.token || response.headers['refresh-jwt'] || response.headers['Refresh-JWT'];
      if (finalToken) {
        localStorage.setItem('token', finalToken);
        if (response.data?.refreshToken) {
          localStorage.setItem('refreshToken', response.data.refreshToken);
        }
        onLogin();
        navigate('/home', { replace: true });
      } else {
        setError('Login failed: No token received');
      }
    } catch (err) {
      if (err.response?.data?.error) {
        setError(err.response.data.error);
      } else if (err.response?.status === 401) {
        setError('Invalid username or password');
      } else if (!err.response) {
        setError('Network error: Unable to connect to server.');
      } else {
        setError('Login failed. Please try again.');
      }
      resetCaptcha();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container fluid className="login-container">
      <Row className="justify-content-center align-items-center min-vh-100">
        <Col md={6} lg={4}>
          <Card className="login-card">
            <Card.Body className="p-5">
              <div className="text-center mb-4">
                <h2 className="login-title">{BRAND_NAME}</h2>
                <p className="text-muted">Open SD-WAN Management Platform</p>
              </div>

              {error && <Alert variant="danger" className="mb-4">{error}</Alert>}
              {info && <Alert variant="success" className="mb-4">{info}</Alert>}

              <Form onSubmit={handleSubmit}>
                <Form.Group className="mb-3">
                  <Form.Label>Username</Form.Label>
                  <div className="input-group">
                    <span className="input-group-text"><FaUser /></span>
                    <Form.Control type="text" name="username" value={credentials.username} onChange={handleChange} placeholder="Enter username" required />
                  </div>
                </Form.Group>

                <Form.Group className="mb-4">
                  <Form.Label>Password</Form.Label>
                  <div className="input-group">
                    <span className="input-group-text"><FaLock /></span>
                    <Form.Control type="password" name="password" value={credentials.password} onChange={handleChange} placeholder="Enter password" required />
                  </div>
                </Form.Group>

                {TURNSTILE_SITE_KEY && (
                  <div className="mb-3" style={{ minHeight: '65px', display: 'flex', justifyContent: 'center' }}>
                    <div id="login-turnstile" />
                  </div>
                )}
                
                {captchaWarning && (
                  <div className={`mb-3 small alert ${captchaEnforced ? 'alert-danger' : 'alert-warning'} p-2`}>
                    {captchaWarning}
                  </div>
                )}

                {CAPTCHA_DEBUG && (
                  <div className="mb-2 small alert alert-info p-2">
                    <div><strong>Captcha Debug</strong></div>
                    <div>Source: {captchaKeySource} | Key: {TURNSTILE_SITE_KEY ? 'Yes' : 'No'} | Enforced: {captchaEnforced ? 'Yes' : 'No'}</div>
                    <div>Token: {captchaToken ? 'Received' : 'None'}</div>
                  </div>
                )}

                <Button variant="primary" type="submit" className="w-100" size="lg" disabled={loading}>
                  {loading ? 'Signing in...' : 'Sign In'}
                </Button>
              </Form>

              <div className="text-center mt-4">
                <small className="text-muted">
                  Don't have an account? <Link to="/register">Register</Link>
                </small>
              </div>
            </Card.Body>
          </Card>
          <div className="text-center mt-3">
            <small className="text-muted">
              © OpenSource-OpenNetworking.org 2025.10, All Rights Reserved
            </small>
          </div>
        </Col>
      </Row>
    </Container>
  );
};

export default Login;