import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Col, Container, Form, Row } from 'react-bootstrap';
import { FaLock } from 'react-icons/fa';
import { BRAND_NAME } from '../constants/branding';
import { CopyrightLine } from '../components/Footer';
import { clearSession } from '../auth/session';
import api from '../services/api';
import './Login.css';

export default function ResetPassword() {
  const location = useLocation();
  const navigate = useNavigate();
  const [resetParams] = useState(() => {
    const params = new URLSearchParams(location.search);
    return {
      id: (params.get('id') || '').trim(),
      token: (params.get('t') || '').trim()
    };
  });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState('idle'); // idle | submitting | success | error
  const [error, setError] = useState('');

  useEffect(() => {
    if (location.search) {
      navigate(location.pathname, { replace: true });
    }
  }, [location.pathname, location.search, navigate]);

  const hasValidParams = Boolean(resetParams.id && resetParams.token);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!hasValidParams) {
      setError('Invalid or incomplete password reset link. Please request a new reset email.');
      setStatus('error');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      setStatus('error');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      setStatus('error');
      return;
    }

    setStatus('submitting');
    try {
      await api.post('/users/reset-password', {
        type: 'update',
        id: resetParams.id,
        token: resetParams.token,
        password
      }, { authFlow: true });
      clearSession();
      setPassword('');
      setConfirmPassword('');
      setStatus('success');
    } catch (err) {
      const apiError = err.response?.data?.error;
      if (apiError && apiError !== 'Password Reset Error') {
        setError(apiError);
      } else {
        setError('Password reset failed. The link may be invalid or expired.');
      }
      setStatus('error');
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
                <p className="text-muted">Reset Your Password</p>
              </div>

              {status === 'success' ? (
                <Alert variant="success" className="mb-4">
                  Your password has been reset. You can now sign in with your new password.
                  <div className="mt-3">
                    <Button variant="primary" size="sm" onClick={() => navigate('/login', { replace: true })}>
                      Go to Sign In
                    </Button>
                  </div>
                </Alert>
              ) : !hasValidParams ? (
                <Alert variant="danger" className="mb-4">
                  Invalid or incomplete password reset link. Please use the link from your email or request a new reset.
                </Alert>
              ) : (
                <>
                  {error && <Alert variant="danger" className="mb-4">{error}</Alert>}
                  <Form onSubmit={handleSubmit}>
                    <Form.Group className="mb-3" controlId="reset-new-password">
                      <Form.Label>New Password</Form.Label>
                      <div className="input-group">
                        <span className="input-group-text"><FaLock /></span>
                        <Form.Control
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Enter new password"
                          autoComplete="new-password"
                          minLength={8}
                          required
                        />
                      </div>
                    </Form.Group>

                    <Form.Group className="mb-4" controlId="reset-confirm-password">
                      <Form.Label>Confirm New Password</Form.Label>
                      <div className="input-group">
                        <span className="input-group-text"><FaLock /></span>
                        <Form.Control
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="Confirm new password"
                          autoComplete="new-password"
                          minLength={8}
                          required
                        />
                      </div>
                    </Form.Group>

                    <Button
                      variant="primary"
                      type="submit"
                      className="w-100"
                      size="lg"
                      disabled={status === 'submitting'}
                    >
                      {status === 'submitting' ? 'Resetting...' : 'Reset Password'}
                    </Button>
                  </Form>
                </>
              )}

              <div className="text-center mt-4">
                <small className="text-muted">
                  <Link to="/login">Back to Sign In</Link>
                </small>
              </div>
            </Card.Body>
          </Card>
          <div className="text-center mt-3">
            <small>
              <CopyrightLine light />
            </small>
          </div>
        </Col>
      </Row>
    </Container>
  );
}
