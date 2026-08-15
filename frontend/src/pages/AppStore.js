import React, { useCallback, useEffect, useState } from 'react';
import { Button, Alert, Row, Col } from 'react-bootstrap';
import { FaStore, FaTrash } from 'react-icons/fa';
import api from '../services/api';
import PageHeader from '../components/common/PageHeader';
import StatusBadge from '../components/common/StatusBadge';
import './AppStore.css';

const AppStore = () => {
  const [catalog, setCatalog] = useState([]);
  const [purchased, setPurchased] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const [catalogRes, purchasedRes] = await Promise.all([
        api.get('/appstore'),
        api.get('/appstore/purchased'),
      ]);
      setCatalog(catalogRes.data || []);
      setPurchased(purchasedRes.data || []);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch applications');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const isPurchased = (appId) => purchased.some((p) => (p.app?._id || p.app) === appId);

  const handlePurchase = async (app) => {
    if (!window.confirm(`Install "${app.name}" for this organization?`)) return;
    setBusyId(app._id);
    try {
      await api.post(`/appstore/purchase/${app._id}`);
      await fetchData();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to add application');
    } finally {
      setBusyId(null);
    }
  };

  const handleUninstall = async (purchasedApp) => {
    if (!window.confirm('Remove this application from your organization?')) return;
    setBusyId(purchasedApp._id);
    try {
      await api.delete(`/appstore/purchased/${purchasedApp._id}`);
      await fetchData();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to remove application');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <div className="page-container"><p className="text-muted">Loading...</p></div>;

  return (
    <div className="page-container">
      <PageHeader
        breadcrumb={[{ label: 'Home', path: '/home' }, { label: 'App Store' }]}
        title="App Store"
      />
      {error && <Alert variant="danger" onClose={() => setError(null)} dismissible>{error}</Alert>}

      <h6 className="fw-bold mb-2">Installed Applications</h6>
      {purchased.length === 0 ? (
        <div className="app-empty-card mb-4">No applications installed yet.</div>
      ) : (
        <Row className="mb-4">
          {purchased.map((p) => (
            <Col md={4} key={p._id} className="mb-3">
              <div className="app-card">
                <div className="d-flex justify-content-between align-items-start">
                  <div>
                    <h6 className="fw-bold mb-1">{p.app?.name || 'Application'}</h6>
                    <div className="text-muted small">v{p.installedVersion || '-'}</div>
                  </div>
                  <StatusBadge status={p.status || 'running'} label={p.status || 'installed'} />
                </div>
                <Button variant="outline-danger" size="sm" className="mt-3" disabled={busyId === p._id} onClick={() => handleUninstall(p)}>
                  <FaTrash className="me-1" /> Remove
                </Button>
              </div>
            </Col>
          ))}
        </Row>
      )}

      <h6 className="fw-bold mb-2">Available Applications</h6>
      <Row>
        {catalog.length === 0 ? (
          <div className="app-empty-card">No applications available in the catalog.</div>
        ) : catalog.map((app) => (
          <Col md={4} key={app._id} className="mb-3">
            <div className="app-card">
              <div className="d-flex align-items-center gap-2 mb-2">
                <FaStore className="text-muted" />
                <h6 className="fw-bold mb-0">{app.name}</h6>
              </div>
              <p className="text-muted small mb-2">{app.description}</p>
              <div className="d-flex justify-content-between align-items-center">
                <span className="small text-muted">{app.cost ? `$${app.cost}` : 'Free'}</span>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={isPurchased(app._id) || busyId === app._id}
                  onClick={() => handlePurchase(app)}
                >
                  {isPurchased(app._id) ? 'Installed' : 'Install'}
                </Button>
              </div>
            </div>
          </Col>
        ))}
      </Row>
    </div>
  );
};

export default AppStore;
