import PermissionButton from '../../components/common/PermissionButton';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Form } from 'react-bootstrap';
import api from '../../services/api';
import PageHeader from '../../components/common/PageHeader';
import StatusBadge from '../../components/common/StatusBadge';
import '../../styles/unified-table.css';
import './Billing.css';

const LOCAL_HTTP_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

// Invoice links come from flexibilling. Only https (or same-origin http on local dev) may be rendered.
export function safeDownloadUrl(value) {
  if (typeof value !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }
  if (parsed.protocol === 'https:') return parsed.href;
  if (parsed.protocol === 'http:' && isSameOriginLocalDev(parsed)) return parsed.href;
  return null;
}

function isSameOriginLocalDev(parsed) {
  if (typeof window === 'undefined' || !window.location) return false;
  if (window.location.protocol !== 'http:') return false;
  if (!LOCAL_HTTP_HOSTS.has(parsed.hostname)) return false;
  return parsed.host === window.location.host;
}

const AccountBilling = () => {
  const [invoices, setInvoices] = useState([]);
  const [summary, setSummary] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [coupon, setCoupon] = useState('');
  const [applyingCoupon, setApplyingCoupon] = useState(false);
  const [couponMessage, setCouponMessage] = useState(null);

  const fetchBilling = useCallback(async () => {
    try {
      const res = await api.get('/invoices');
      setInvoices(res.data.invoices || []);
      setSummary(res.data.summary || null);
      setSubscription(res.data.subscription || null);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch billing information');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBilling(); }, [fetchBilling]);

  const handleApplyCoupon = async () => {
    if (!coupon.trim()) return;
    setApplyingCoupon(true);
    setCouponMessage(null);
    try {
      await api.post('/coupons', { name: coupon.trim() });
      setCouponMessage({ variant: 'success', text: 'Coupon applied successfully.' });
      setCoupon('');
      await fetchBilling();
    } catch (err) {
      setCouponMessage({ variant: 'danger', text: err.response?.data?.error || err.message || 'Failed to apply coupon' });
    } finally {
      setApplyingCoupon(false);
    }
  };

  const usagePercent = summary && summary.max ? Math.min(100, Math.round((summary.current / summary.max) * 100)) : 0;

  if (loading) return <div className="page-container"><p className="text-muted">Loading...</p></div>;

  return (
    <div className="page-container">
      <PageHeader
        breadcrumb={[{ label: 'Home', path: '/home' }, { label: 'Account' }, { label: 'Billing' }]}
        title="Billing"
      />
      {error && (
        <Alert variant="warning">
          {error}. This account may not be linked to a billing/subscription provider yet.
        </Alert>
      )}

      {summary && (
        <div className="billing-card mb-4">
          <h6 className="fw-bold mb-2">Device Usage</h6>
          <div className="billing-usage-bar">
            <div className="billing-usage-fill" style={{ width: `${usagePercent}%` }} />
          </div>
          <p className="text-muted small mt-2 mb-0">{summary.current} of {summary.max} devices registered ({usagePercent}%)</p>
        </div>
      )}

      {subscription && (
        <div className="billing-card mb-4">
          <h6 className="fw-bold mb-2">Subscription</h6>
          <p className="mb-0">
            Status: <StatusBadge status={subscription.status || 'unknown'} label={subscription.status || JSON.stringify(subscription)} />
          </p>
        </div>
      )}

      <div className="billing-card mb-4">
        <h6 className="fw-bold mb-2">Apply Coupon</h6>
        {couponMessage && <Alert variant={couponMessage.variant} onClose={() => setCouponMessage(null)} dismissible>{couponMessage.text}</Alert>}
        <div className="d-flex gap-2">
          <Form.Control style={{ maxWidth: 280 }} value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder="Coupon code" />
          <PermissionButton permKey="billing" method={'post'} variant="primary" onClick={handleApplyCoupon} disabled={applyingCoupon || !coupon.trim()}>{applyingCoupon ? 'Applying...' : 'Apply'}</PermissionButton>
        </div>
      </div>

      <h6 className="fw-bold mb-2">Invoices</h6>
      <div className="table-container-template">
        <table className="custom-table-template">
          <thead><tr><th>Date</th><th>Amount</th><th>Currency</th><th>Payment Method</th><th>Status</th><th>Download</th></tr></thead>
          <tbody>
            {invoices.length > 0 ? invoices.map((inv) => {
              const downloadUrl = safeDownloadUrl(inv.download_url);
              return (
                <tr key={inv.id}>
                  <td>{inv.date ? new Date(inv.date * 1000).toLocaleDateString() : '-'}</td>
                  <td>{inv.amount}</td>
                  <td>{inv.base_currency_code}</td>
                  <td>{inv.payment_method}</td>
                  <td><StatusBadge status={inv.status === 'paid' ? 'running' : inv.status} label={inv.status} /></td>
                  <td>{downloadUrl ? <a href={downloadUrl} target="_blank" rel="noopener noreferrer">Download</a> : '-'}</td>
                </tr>
              );
            }) : (
              <tr><td colSpan="6" className="text-center text-muted py-4">No invoices yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AccountBilling;
