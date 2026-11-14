import TurnstileChallenge from '../components/auth/TurnstileChallenge';
import React, { useState } from 'react';
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
  const [captchaPolicy, setCaptchaPolicy] = useState({ ready: false, enforced: true });
  const [captchaReset, setCaptchaReset] = useState(0);

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
      
      if (!captchaPolicy.ready || (captchaPolicy.enforced && !captchaToken)) {
        setError(t('register.validation.captcha'));
        return;
      }

      // Add captcha token if available
      if (captchaToken) {
        body.captcha = captchaToken;
      }
      
      await api.post('/users/register', body);
      // Registration only creates the account - it isn't usable until the user
      // clicks the verification link emailed to them, so don't imply otherwise.
      navigate('/login?registered=1');
    } catch (err) {
      const apiErr = err?.response?.data?.error || err?.response?.data?.message;
      const displayError = apiErr || err?.message || 'Registration failed. Please try again.';
      setError(displayError); // TODO i18n
      setCaptchaToken(''); setCaptchaReset(value => value + 1);
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
                      <Form.Label className="small mb-0">Job Title *</Form.Label>
                    </Col>
                    <Col sm={8}>
                      <Form.Control
                        size="sm"
                        name="userJobTitle"
                        value={form.userJobTitle}
                        onChange={handleChange}
                        required
                        minLength={2}
                        maxLength={30}
                        pattern="[a-zA-Z0-9 -]{2,30}"
                        title="2-30 characters: letters, digits, spaces or dashes"
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

                <TurnstileChallenge onToken={setCaptchaToken} onPolicy={setCaptchaPolicy} resetKey={captchaReset} />

                <div className="d-grid">
                  <Button type="submit" variant="primary" size="sm" disabled={loading || !captchaPolicy.ready || (captchaPolicy.enforced && !captchaToken)}>
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
