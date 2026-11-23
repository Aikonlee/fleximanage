import { decodeJwtPayload } from '../auth/permissions';
import TurnstileChallenge from '../components/auth/TurnstileChallenge';
import MfaChallenge from '../components/auth/MfaChallenge';
import { clearSession, setSessionTokens } from '../auth/session';
import React, { useState, useEffect } from 'react';
import { BRAND_NAME } from '../constants/branding';
import { CopyrightLine } from '../components/Footer';
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
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendState, setResendState] = useState('idle'); // idle | sending | sent
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaPolicy, setCaptchaPolicy] = useState({ ready: false, enforced: true });
  const [captchaReset, setCaptchaReset] = useState(0);
  const [loginToken, setLoginToken] = useState('');
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('registered')) {
      setInfo('Registration submitted! Check your email for a verification link before signing in.');
    }
  }, [location.search]);

  const handleResendVerification = async () => {
    setResendState('sending');
    try {
      await api.post('/users/reverify-account', { email: credentials.username });
    } finally {
      // Backend always returns OK here regardless of whether the email exists,
      // to avoid leaking which emails are registered - so just confirm we tried.
      setResendState('sent');
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setCredentials(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setNeedsVerification(false);
    setResendState('idle');

    try {
      if (!captchaPolicy.ready || (captchaPolicy.enforced && !captchaToken)) {
        setError('Please complete the CAPTCHA');
        setLoading(false);
        return;
      }

      clearSession();
      const response = await api.post('/users/login', {
        username: credentials.username,
        password: credentials.password,
        captcha: captchaToken || undefined
      }, { authFlow: true });

      const hasProcessTokenOnly = decodeJwtPayload(response.data?.token)?.type === 'login';
      if (hasProcessTokenOnly) {
        setLoginToken(response.data.token);
        setError('');
        return;
      }

      const finalToken = response.data?.token || response.headers['refresh-jwt'] || response.headers['Refresh-JWT'];
      const refreshToken = response.headers['refresh-token'];
      if (finalToken && refreshToken) {
        setSessionTokens(finalToken, refreshToken);
        onLogin();
        navigate('/home', { replace: true });
      } else {
        setError('Login failed: No token received');
      }
    } catch (err) {
      const apiError = err.response?.data?.error;
      if (apiError) {
        setError(apiError);
        if (/not verified/i.test(apiError)) setNeedsVerification(true);
      } else if (err.response?.status === 401) {
        setError('Invalid username or password');
      } else if (!err.response) {
        setError('Network error: Unable to connect to server.');
      } else {
        setError('Login failed. Please try again.');
      }
      setCaptchaToken(''); setCaptchaReset(value => value + 1);
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

              {error && (
                <Alert variant="danger" className="mb-4">
                  {error}
                  {needsVerification && (
                    <div className="mt-2">
                      {resendState === 'sent' ? (
                        <span className="small">Verification email sent (if that address is registered) - check your inbox.</span>
                      ) : (
                        <Button
                          variant="link" size="sm" className="p-0"
                          disabled={resendState === 'sending' || !credentials.username}
                          onClick={handleResendVerification}
                        >
                          {resendState === 'sending' ? 'Sending...' : 'Resend verification email'}
                        </Button>
                      )}
                    </div>
                  )}
                </Alert>
              )}
              {info && <Alert variant="success" className="mb-4">{info}</Alert>}

              {loginToken ? <MfaChallenge loginToken={loginToken} onAuthenticated={() => { onLogin(); navigate('/home', { replace: true }); }} onCancel={() => { setLoginToken(''); setCredentials(value => ({ ...value, password: '' })); setCaptchaToken(''); setCaptchaReset(value => value + 1); }} /> : <Form onSubmit={handleSubmit}>
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

                <TurnstileChallenge onToken={setCaptchaToken} onPolicy={setCaptchaPolicy} resetKey={captchaReset} />

                <Button variant="primary" type="submit" className="w-100" size="lg" disabled={loading || !captchaPolicy.ready || (captchaPolicy.enforced && !captchaToken)}>
                  {loading ? 'Signing in...' : 'Sign In'}
                </Button>
              </Form>}

              <div className="text-center mt-4">
                <small className="text-muted">
                  Don't have an account? <Link to="/register">Register</Link>
                </small>
              </div>
            </Card.Body>
          </Card>
          <div className="text-center mt-3">
            <small className="text-muted">
              <CopyrightLine />
            </small>
          </div>
        </Col>
      </Row>
    </Container>
  );
};

export default Login;