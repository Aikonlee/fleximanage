import React, { useCallback, useEffect, useState } from 'react';
import { Button, Alert, Modal, Form } from 'react-bootstrap';
import api from '../services/api';
import PageHeader from '../components/common/PageHeader';
import DataTable from '../components/common/DataTable';
import StatusBadge from '../components/common/StatusBadge';
import '../styles/unified-table.css';

const DeviceUpgrade = () => {
  const [devices, setDevices] = useState([]);
  const [latest, setLatest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState([]);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleTime, setScheduleTime] = useState('');
  const [applying, setApplying] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [devicesRes, latestRes] = await Promise.all([
        api.get('/devices?response=detailed'),
        api.get('/devices/latestVersions').catch(() => ({ data: null })),
      ]);
      setDevices(devicesRes.data?.devices || devicesRes.data || []);
      setLatest(latestRes.data);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch devices');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const applyUpgradeSchedule = async (isoTime) => {
    setApplying(true);
    try {
      await Promise.all(selected.map((deviceId) =>
        api.put(`/devices/${deviceId}`, { upgradeSchedule: { time: isoTime } })
      ));
      setSelected([]);
      setShowScheduleModal(false);
      await fetchData();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to schedule upgrade');
    } finally {
      setApplying(false);
    }
  };

  const handleUpgradeNow = () => {
    if (!window.confirm(`Upgrade ${selected.length} device(s) now to version ${latest?.versions?.device || 'latest'}?`)) return;
    applyUpgradeSchedule(new Date().toISOString());
  };

  const handleSchedule = () => {
    if (!scheduleTime) return;
    applyUpgradeSchedule(new Date(scheduleTime).toISOString());
  };

  const isOutdated = (device) => latest?.versions?.device && device.versions?.device && device.versions.device !== latest.versions.device;

  const columns = [
    { key: 'name', label: 'Device', sortable: true },
    { key: 'currentVersion', label: 'Current Version', render: (row) => row.versions?.device || '-' },
    { key: 'latestVersion', label: 'Latest Available', render: () => latest?.versions?.device || '-' },
    {
      key: 'status',
      label: 'Status',
      render: (row) => isOutdated(row)
        ? <StatusBadge status="pending" label="Update available" />
        : <StatusBadge status="running" label="Up to date" />,
    },
    {
      key: 'scheduled',
      label: 'Scheduled',
      render: (row) => row.upgradeSchedule?.time ? new Date(row.upgradeSchedule.time).toLocaleString() : '-',
    },
  ];

  return (
    <div className="page-container">
      <PageHeader
        breadcrumb={[{ label: 'Home', path: '/home' }, { label: 'Troubleshoot' }, { label: 'Device Upgrade' }]}
        title="Device Upgrade"
      />
      {error && <Alert variant="danger" onClose={() => setError(null)} dismissible>{error}</Alert>}
      {latest?.versions && (
        <p className="text-muted small mb-2">
          Latest available flexiEdge version: <strong>{latest.versions.device}</strong>
          {latest.versionDeadline && ` — deadline ${new Date(latest.versionDeadline).toLocaleDateString()}`}.
          flexiManage supports one major version backward compatibility.
        </p>
      )}

      {loading ? (
        <p className="text-muted">Loading...</p>
      ) : (
        <DataTable
          columns={columns}
          rows={devices}
          rowKey={(row) => row._id}
          selectable
          selected={selected}
          onSelectionChange={setSelected}
          actions={
            <>
              <Button variant="primary" disabled={selected.length === 0 || applying} onClick={handleUpgradeNow}>
                Upgrade Now ({selected.length})
              </Button>
              <Button variant="outline-primary" disabled={selected.length === 0 || applying} onClick={() => setShowScheduleModal(true)}>
                Schedule Upgrade...
              </Button>
            </>
          }
          emptyMessage="No devices found."
        />
      )}

      <Modal show={showScheduleModal} onHide={() => setShowScheduleModal(false)} centered>
        <Modal.Header closeButton><Modal.Title>Schedule Upgrade</Modal.Title></Modal.Header>
        <Modal.Body>
          <p className="text-muted small">
            {selected.length} device(s) selected. Devices connected to each other via tunnels should be upgraded at the same time to avoid version mismatch.
          </p>
          <Form.Group>
            <Form.Label>Upgrade Date/Time</Form.Label>
            <Form.Control type="datetime-local" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowScheduleModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleSchedule} disabled={!scheduleTime || applying}>{applying ? 'Scheduling...' : 'Schedule'}</Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default DeviceUpgrade;
