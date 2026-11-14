import PermissionButton from '../../components/common/PermissionButton';
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Form } from 'react-bootstrap';
import api from '../../services/api';
import PageHeader from '../../components/common/PageHeader';
import { decodeJwtPayload } from '../../auth/permissions';
import '../../styles/unified-table.css';
import './NotificationsSettings.css';

const RULE_NAMES = [
  'Device connection', 'Running router', 'Link/Tunnel round trip time', 'Link/Tunnel default drop rate',
  'Device memory usage', 'Hard drive usage', 'Temperature', 'Software update', 'Internet connection',
  'Link status', 'Missing interface ip', 'Tunnel connection', 'Pending tunnel', 'Failed self-healing',
  'Static route state'
];

const getTokenIds = () => {
  const token = localStorage.getItem('token');
  const payload = decodeJwtPayload(token);
  return { org: payload?.org, account: payload?.account };
};

const NotificationsSettings = () => {
  const { org, account } = getTokenIds();
  const [rules, setRules] = useState({});
  const [emailUsers, setEmailUsers] = useState([]);
  const [webhook, setWebhook] = useState({ webhookURL: '', sendCriticalAlerts: true, sendWarningAlerts: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  const fetchAll = useCallback(async () => {
    // Notification rules are per-organization; a brand new account has none yet
    if (!org) {
      setLoading(false);
      return;
    }
    try {
      const [rulesRes, emailsRes, webhookRes] = await Promise.all([
        api.get('/notificationsConf', { params: { org } }),
        api.get('/notificationsConf/emails', { params: { org } }),
        api.get('/notificationsConf/webhooks', { params: { org } }),
      ]);
      setRules(rulesRes.data || {});
      setEmailUsers(emailsRes.data || []);
      setWebhook({ webhookURL: '', sendCriticalAlerts: true, sendWarningAlerts: false, ...webhookRes.data });
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch notification settings');
    } finally {
      setLoading(false);
    }
  }, [org]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const updateRule = (name, field, value) => {
    setRules({ ...rules, [name]: { ...rules[name], [field]: value } });
  };

  const applyRules = async () => {
    setSaving(true);
    try {
      await api.put('/notificationsConf', { org, rules });
      setMessage('Notification rules saved.');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save rules');
    } finally {
      setSaving(false);
    }
  };

  const applyDefaults = async (useAccountDefault) => {
    setSaving(true);
    try {
      const res = await api.get('/notificationsConf/default', { params: useAccountDefault ? { account } : {} });
      await api.put('/notificationsConf', { org, rules: res.data });
      setRules(res.data);
      setMessage(useAccountDefault ? 'Reset to account defaults.' : 'Reset to system defaults.');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to reset defaults');
    } finally {
      setSaving(false);
    }
  };

  const setAsAccountDefault = async () => {
    setSaving(true);
    try {
      await api.put('/notificationsConf/default', { account, rules });
      setMessage('Current settings set as account default for new organizations.');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to set account default');
    } finally {
      setSaving(false);
    }
  };

  const updateEmailUser = (idx, field, value) => {
    const next = [...emailUsers];
    next[idx] = { ...next[idx], [field]: value };
    setEmailUsers(next);
  };

  const applyEmails = async () => {
    setSaving(true);
    try {
      const emailsSigning = emailUsers.map((u) => ({
        _id: u._id, signedToCritical: u.signedToCritical, signedToWarning: u.signedToWarning, signedToDaily: u.signedToDaily
      }));
      await api.put('/notificationsConf/emails', { org, emailsSigning });
      setMessage('Email notification recipients saved.');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save email recipients');
    } finally {
      setSaving(false);
    }
  };

  const applyWebhook = async () => {
    setSaving(true);
    try {
      await api.put('/notificationsConf/webhooks', { org, webHookSettings: webhook });
      setMessage('Webhook settings saved.');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save webhook settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="page-container"><p className="text-muted">Loading...</p></div>;

  if (!org) {
    return (
      <div className="page-container">
        <PageHeader
          breadcrumb={[{ label: 'Home', path: '/home' }, { label: 'Account' }, { label: 'Notifications' }]}
          title="Notifications"
        />
        <p className="text-muted">
          Notification rules are configured per organization. <Link to="/organizations">Create an organization</Link> first
          to set them up.
        </p>
      </div>
    );
  }

  return (
    <div className="page-container">
      <PageHeader
        breadcrumb={[{ label: 'Home', path: '/home' }, { label: 'Account' }, { label: 'Notifications' }]}
        title="Notifications"
        actions={
          <>
            <PermissionButton permKey="notifications" method={'put'} variant="outline-primary" size="sm" onClick={setAsAccountDefault} disabled={saving}>Set as account default</PermissionButton>
            <PermissionButton permKey="notifications" method={'put'} variant="outline-secondary" size="sm" onClick={() => applyDefaults(true)} disabled={saving}>Reset to account defaults</PermissionButton>
            <PermissionButton permKey="notifications" method={'put'} variant="outline-secondary" size="sm" onClick={() => applyDefaults(false)} disabled={saving}>Reset to system defaults</PermissionButton>
          </>
        }
      />
      {error && <Alert variant="danger" onClose={() => setError(null)} dismissible>{error}</Alert>}
      {message && <Alert variant="success" onClose={() => setMessage(null)} dismissible>{message}</Alert>}

      <div className="d-flex justify-content-between align-items-center mb-2">
        <h6 className="fw-bold mb-0">Notification Rules</h6>
        <PermissionButton permKey="notifications" method={'put'} variant="primary" size="sm" onClick={applyRules} disabled={saving}>{saving ? 'Saving...' : 'Apply'}</PermissionButton>
      </div>
      <div className="table-container-template mb-4 notif-rules-table">
        <table className="custom-table-template">
          <thead>
            <tr><th>Event</th><th>Severity</th><th>Warning Threshold</th><th>Critical Threshold</th><th>Immediate Email</th><th>Send Webhook</th><th>Resolved Alert</th></tr>
          </thead>
          <tbody>
            {RULE_NAMES.map((name) => {
              const rule = rules[name] || {};
              return (
                <tr key={name}>
                  <td className="fw-bold">{name}</td>
                  <td>
                    <Form.Select size="sm" value={rule.severity || ''} onChange={(e) => updateRule(name, 'severity', e.target.value)}>
                      <option value="">-</option>
                      <option value="warning">Warning</option>
                      <option value="critical">Critical</option>
                    </Form.Select>
                  </td>
                  <td>
                    {rule.warningThreshold !== null && rule.warningThreshold !== undefined ? (
                      <div className="d-flex align-items-center gap-1">
                        <Form.Control size="sm" type="number" value={rule.warningThreshold ?? ''} onChange={(e) => updateRule(name, 'warningThreshold', Number(e.target.value))} />
                        {rule.thresholdUnit && <span className="text-muted small">{rule.thresholdUnit}</span>}
                      </div>
                    ) : <span className="text-muted">-</span>}
                  </td>
                  <td>
                    {rule.criticalThreshold !== null && rule.criticalThreshold !== undefined ? (
                      <div className="d-flex align-items-center gap-1">
                        <Form.Control size="sm" type="number" value={rule.criticalThreshold ?? ''} onChange={(e) => updateRule(name, 'criticalThreshold', Number(e.target.value))} />
                        {rule.thresholdUnit && <span className="text-muted small">{rule.thresholdUnit}</span>}
                      </div>
                    ) : <span className="text-muted">-</span>}
                  </td>
                  <td className="text-center"><Form.Check checked={Boolean(rule.immediateEmail)} onChange={(e) => updateRule(name, 'immediateEmail', e.target.checked)} /></td>
                  <td className="text-center"><Form.Check checked={Boolean(rule.sendWebHook)} onChange={(e) => updateRule(name, 'sendWebHook', e.target.checked)} /></td>
                  <td className="text-center"><Form.Check checked={rule.resolvedAlert !== false} onChange={(e) => updateRule(name, 'resolvedAlert', e.target.checked)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="d-flex justify-content-between align-items-center mb-2">
        <h6 className="fw-bold mb-0">Email Notifications</h6>
        <PermissionButton permKey="notifications" method={'put'} variant="primary" size="sm" onClick={applyEmails} disabled={saving}>{saving ? 'Saving...' : 'Apply'}</PermissionButton>
      </div>
      <div className="table-container-template mb-4">
        <table className="custom-table-template">
          <thead><tr><th>User</th><th>Email</th><th>Critical Alerts</th><th>Warning Alerts</th><th>Daily Summary</th></tr></thead>
          <tbody>
            {emailUsers.length > 0 ? emailUsers.map((u, idx) => (
              <tr key={u._id}>
                <td>{u.name} {u.lastName}</td>
                <td>{u.email}</td>
                <td className="text-center"><Form.Check checked={Boolean(u.signedToCritical)} onChange={(e) => updateEmailUser(idx, 'signedToCritical', e.target.checked)} /></td>
                <td className="text-center"><Form.Check checked={Boolean(u.signedToWarning)} onChange={(e) => updateEmailUser(idx, 'signedToWarning', e.target.checked)} /></td>
                <td className="text-center"><Form.Check checked={Boolean(u.signedToDaily)} onChange={(e) => updateEmailUser(idx, 'signedToDaily', e.target.checked)} /></td>
              </tr>
            )) : (
              <tr><td colSpan="5" className="text-center text-muted py-4">No users found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="d-flex justify-content-between align-items-center mb-2">
        <h6 className="fw-bold mb-0">Webhook Integration</h6>
        <PermissionButton permKey="notifications" method={'put'} variant="primary" size="sm" onClick={applyWebhook} disabled={saving}>{saving ? 'Saving...' : 'Apply'}</PermissionButton>
      </div>
      <div className="notif-webhook-card">
        <Form.Group className="mb-3">
          <Form.Label>Webhook URL (Slack, Microsoft Teams, or any compatible endpoint)</Form.Label>
          <Form.Control value={webhook.webhookURL || ''} onChange={(e) => setWebhook({ ...webhook, webhookURL: e.target.value })} placeholder="https://hooks.slack.com/services/..." />
        </Form.Group>
        <Form.Check className="mb-2" label="Send critical alerts" checked={Boolean(webhook.sendCriticalAlerts)} onChange={(e) => setWebhook({ ...webhook, sendCriticalAlerts: e.target.checked })} />
        <Form.Check label="Send warning alerts" checked={Boolean(webhook.sendWarningAlerts)} onChange={(e) => setWebhook({ ...webhook, sendWarningAlerts: e.target.checked })} />
      </div>
    </div>
  );
};

export default NotificationsSettings;
