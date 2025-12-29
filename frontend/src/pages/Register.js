import React, { useState, useEffect, useRef } from 'react';
import { BRAND_NAME } from '../constants/branding';
import { Card, Form, Button, Alert, Container, Row, Col } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { t } from '../i18n';

// Registration page with runtime + debug-enabled Cloudflare Turnstile (mirrors Login implementation)
const Register = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    accountName: '',
    userFirstName: '',
    userLastName: '',
    email: '',
    password: '',
    userJobTitle: '',
    userPhoneNumber: '',
    country: '',
    companySize: '',
    serviceType: '',
    numberSites: 1
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const captchaRenderedRef = useRef(false);

  // Cloudflare Turnstile key resolution precedence
  const buildTimeKey = process.env.REACT_APP_TURNSTILE_SITE_KEY;
  const injectedKey = (typeof window !== 'undefined' && (window.__TURNSTILE_SITE_KEY__ || window.__FLEXIWAN_SERVER_CONFIG__?.captchaSiteKey)) || '';
  const [runtimeCaptchaKey, setRuntimeCaptchaKey] = useState('');
  // Priority: 1. Runtime API Key, 2. Injected Window Key, 3. Build-time Env Key
  const TURNSTILE_SITE_KEY = runtimeCaptchaKey || injectedKey || buildTimeKey;
  const captchaKeySource = runtimeCaptchaKey ? 'runtime' : (injectedKey ? 'injected' : (buildTimeKey ? 'build' : 'none'));
  const CAPTCHA_DEBUG = (
    (process.env.REACT_APP_CAPTCHA_DEBUG === '1') ||
    (typeof window !== 'undefined' && (window.__CAPTCHA_DEBUG__ === true || localStorage.getItem('captchaDebug') === '1'))
  );

  // Log CAPTCHA debug mode status
  // eslint-disable-next-line no-console
  console.log('[captcha][register] Debug mode:', CAPTCHA_DEBUG);

  // Fetch runtime config
  useEffect(() => {
    api.get('/public/config')
      .then(res => {
        if (res.data?.captchaSiteKey) {
          setRuntimeCaptchaKey(res.data.captchaSiteKey);
        }
      })
      .catch(err => {
        // eslint-disable-next-line no-console
        console.warn('Failed to fetch public config', err);
      });
  }, []);

  // Load script & render captcha when key available
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) { CAPTCHA_DEBUG && console.log('[captcha][register] no site key yet, skip'); return; }
    if (captchaRenderedRef.current) return;
    if (typeof window === 'undefined') return;
    const ensureRender = () => {
      if (!window.turnstile || !window.turnstile.render) { CAPTCHA_DEBUG && console.log('[captcha][register] turnstile not ready retry'); return; }
      if (captchaRenderedRef.current) return;
      try {
        const widgetId = window.turnstile.render('#register-turnstile', {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (token) => { 
            setCaptchaToken(token); 
            CAPTCHA_DEBUG && console.log('[captcha][register] token received', token ? token.substring(0, 8) + '...' : '(empty)'); 
          },
          'error-callback': (error) => {
            setCaptchaToken('');
            // eslint-disable-next-line no-console
            console.error('[captcha][register] Turnstile error callback:', error);
          },
          'timeout-callback': () => {
            setCaptchaToken('');
            // eslint-disable-next-line no-console
            console.warn('[captcha][register] Turnstile timeout');
          }
        });
        captchaRenderedRef.current = true;
        CAPTCHA_DEBUG && console.log('[captcha][register] widget rendered id=', widgetId);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Turnstile render failed (register):', e);
        CAPTCHA_DEBUG && console.error('[captcha][register] render exception', e);
      }
    };
    if (!window.turnstile) {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      script.async = true;
      script.defer = true;
      script.onload = ensureRender;
      document.head.appendChild(script);
      CAPTCHA_DEBUG && console.log('[captcha][register] script tag injected');
    } else {
      ensureRender();
    }
  }, [TURNSTILE_SITE_KEY, CAPTCHA_DEBUG]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const body = { ...form };
      
      // Add default values for fields removed from simplified UI but required by backend
      if (!body.country) {
        body.country = 'US'; // Default country
      }
      if (!body.companySize) {
        body.companySize = '1-10'; // Default company size
      }
      if (!body.serviceType) {
        body.serviceType = 'general'; // Default service type
      }
      if (!body.numberSites) {
        body.numberSites = '1'; // Default number of sites
      }
      
      // Only require CAPTCHA if it's configured AND the token was successfully obtained
      // This allows for graceful degradation if Turnstile fails due to browser restrictions
      if (TURNSTILE_SITE_KEY && !captchaToken) {
        // Check if Turnstile widget was rendered (it will be if CAPTCHA_DEBUG is enabled or widget loaded)
        const turnstileWidget = document.querySelector('[data-sitekey]');
        if (turnstileWidget) {
          // Widget exists but no token - likely an error or still loading
          setError(t('register.validation.captcha'));
          setLoading(false);
          return;
        }
        // Widget doesn't exist or failed to load - proceed without captcha and let backend handle it
        // eslint-disable-next-line no-console
        console.warn('[captcha][register] Turnstile widget not found, proceeding without captcha. Backend will validate.');
      }
      
      // Add captcha token if available
      if (captchaToken) {
        body.captcha = captchaToken;
      }
      
      const resp = await api.post('/users/register', body);
      const fast = resp.data?.fastVerified ? 1 : 0;
      navigate(`/login?registered=1&fast=${fast}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Registration error details:', {
        message: err?.message,
        code: err?.code,
        response: err?.response?.status,
        responseData: err?.response?.data,
        fullError: err
      });
      const apiErr = err?.response?.data?.error || err?.response?.data?.message;
      const displayError = apiErr || err?.message || 'Registration failed. Please try again.';
      setError(displayError); // TODO i18n
      // eslint-disable-next-line no-console
      console.error('Setting error to:', displayError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container fluid className="login-container">
      <Row className="justify-content-center align-items-center min-vh-100">
        <Col md={8} lg={5} xl={4}>
          <Card className="login-card">
            <Card.Body className="p-4">
              <div className="text-center mb-3">
                <h2 className="login-title">{t('register.title')}</h2>
              </div>

              {error && <Alert variant="danger" className="mb-3 py-2">{error}</Alert>}

              <div className="mb-3 p-3 bg-light rounded small text-secondary">
                <p className="mb-0">
                  Proceed to create a new account. You become this account owner.
                </p>
              </div>

              <Form onSubmit={handleSubmit} autoComplete="off">
                {/* Company Name */}
                <Form.Group className="mb-2">
                  <Row className="align-items-center">
                    <Col sm={4}>
                      <Form.Label className="small mb-0">Company Name *</Form.Label>
                    </Col>
                    <Col sm={8}>
                      <Form.Control 
                        size="sm"
                        name="accountName" 
                        value={form.accountName} 
                        onChange={handleChange} 
                        required 
                        placeholder="Enter your company name"
                      />
                    </Col>
                  </Row>
                </Form.Group>

                {/* Business Email */}
                <Form.Group className="mb-2">
                  <Row className="align-items-center">
                    <Col sm={4}>
                      <Form.Label className="small mb-0">Business Email *</Form.Label>
                    </Col>
                    <Col sm={8}>
                      <Form.Control 
                        size="sm"
                        type="email" 
                        name="email" 
                        value={form.email} 
                        onChange={handleChange} 
                        required 
                        placeholder="your.email@company.com"
                      />
                    </Col>
                  </Row>
                </Form.Group>

                {/* First Name */}
                <Form.Group className="mb-2">
                  <Row className="align-items-center">
                    <Col sm={4}>
                      <Form.Label className="small mb-0">First Name *</Form.Label>
                    </Col>
                    <Col sm={8}>
                      <Form.Control 
                        size="sm"
                        name="userFirstName" 
                        value={form.userFirstName} 
                        onChange={handleChange} 
                        required 
                        placeholder="First name"
                      />
                    </Col>
                  </Row>
                </Form.Group>

                {/* Last Name */}
                <Form.Group className="mb-2">
                  <Row className="align-items-center">
                    <Col sm={4}>
                      <Form.Label className="small mb-0">Last Name *</Form.Label>
                    </Col>
                    <Col sm={8}>
                      <Form.Control 
                        size="sm"
                        name="userLastName" 
                        value={form.userLastName} 
                        onChange={handleChange} 
                        required 
                        placeholder="Last name"
                      />
                    </Col>
                  </Row>
                </Form.Group>

                {/* Job Title */}
                <Form.Group className="mb-2">
                  <Row className="align-items-center">
                    <Col sm={4}>
                      <Form.Label className="small mb-0">Job Title</Form.Label>
                    </Col>
                    <Col sm={8}>
                      <Form.Control 
                        size="sm"
                        name="userJobTitle" 
                        value={form.userJobTitle} 
                        onChange={handleChange} 
                        placeholder="Your job title"
                      />
                    </Col>
                  </Row>
                </Form.Group>

                {/* Phone Number */}
                <Form.Group className="mb-2">
                  <Row className="align-items-center">
                    <Col sm={4}>
                      <Form.Label className="small mb-0">Phone Number</Form.Label>
                    </Col>
                    <Col sm={8}>
                      <Form.Control 
                        size="sm"
                        name="userPhoneNumber" 
                        value={form.userPhoneNumber} 
                        onChange={handleChange} 
                        placeholder="+1 (555) 123-4567"
                      />
                    </Col>
                  </Row>
                </Form.Group>

                {/* Password */}
                <Form.Group className="mb-3">
                  <Row className="align-items-center">
                    <Col sm={4}>
                      <Form.Label className="small mb-0">Password *</Form.Label>
                    </Col>
                    <Col sm={8}>
                      <Form.Control 
                        size="sm"
                        type="password" 
                        name="password" 
                        value={form.password} 
                        onChange={handleChange} 
                        required 
                        placeholder="Create a strong password"
                      />
                    </Col>
                  </Row>
                </Form.Group>

                {TURNSTILE_SITE_KEY && (
                  <div className="mb-3" style={{ display: 'flex', justifyContent: 'center' }}>
                    <div id="register-turnstile" />
                  </div>
                )}

                {CAPTCHA_DEBUG && (
                  <div className="mb-2 small alert alert-info p-2">
                    <div><strong>{t('debug')}</strong></div>
                    <div>source: {captchaKeySource} | hasKey: {TURNSTILE_SITE_KEY ? 'yes' : 'no'} | scriptLoaded: {typeof window !== 'undefined' && window.turnstile ? 'yes' : 'no'}</div>
                    <div>token: {captchaToken ? (captchaToken.substring(0, 12) + '...') : '(empty)'}</div>
                  </div>
                )}

                <div className="d-grid mt-3 mb-2">
                  <Button type="submit" variant="primary" size="sm" disabled={loading}>
                    {loading ? t('register.labels.submit') + '...' : t('register.labels.submit')}
                  </Button>
                </div>

                <div className="text-center mt-2">
                  <small className="text-muted">
                    {t('register.helper.haveAccount')} <Link to="/login" className="text-decoration-none">{t('register.helper.signIn')}</Link>
                  </small>
                </div>
              </Form>
            </Card.Body>
          </Card>
          <div className="text-center mt-2">
            <small className="text-muted">
              © OpenSource-OpenNetworking.org 2025.10, All Rights Reserved
            </small>
          </div>
        </Col>
      </Row>
    </Container>
  );
};

export default Register;