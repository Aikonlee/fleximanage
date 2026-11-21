import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FaChevronDown, FaChevronRight, FaSyncAlt } from 'react-icons/fa';
import api from '../../services/api';
import PageHeader from '../../components/common/PageHeader';
import '../../styles/unified-table.css';
import './AdminOrganizations.css';

// Admin only: every account / organization in the system and the devices
// installed in each organization (GET /api/admin/organizations).

const fmtDate = (d) => (d ? new Date(d).toLocaleString() : '-');

const StateBadge = ({ device }) => {
  if (!device.isApproved) return <span className="badge bg-secondary">Not approved</span>;
  if (!device.isConnected) return <span className="badge bg-danger">Offline</span>;
  if (device.state === 'running') return <span className="badge bg-success">Running</span>;
  return <span className="badge bg-warning text-dark">{device.state || 'Unknown'}</span>;
};

const AdminOrganizations = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/admin/organizations');
      setData(res.data);
    } catch (e) {
      setError(e.response?.status === 403
        ? 'Only system administrators can view this page.'
        : (e.response?.data?.error || e.message || 'Failed to load organizations'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // flatten to rows (one per organization) and apply the search filter
  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const out = [];
    for (const acct of data.accounts) {
      for (const org of acct.organizations) {
        const devices = q
          ? org.devices.filter(d => [d.name, d.hostname, d.machineId, d.serial, d.ipList,
            ...(d.publicIPs || [])].some(v => v && String(v).toLowerCase().includes(q)))
          : org.devices;
        const orgMatch = !q || [acct.name, org.name, org.description, org.group]
          .some(v => v && String(v).toLowerCase().includes(q));
        if (orgMatch || devices.length) {
          out.push({ acct, org, devices: orgMatch ? org.devices : devices });
        }
      }
    }
    return out;
  }, [data, query]);

  const toggle = (id) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  const allOpen = rows.length > 0 && rows.every(r => expanded[String(r.org._id)]);
  const toggleAll = () => {
    const next = {};
    if (!allOpen) rows.forEach(r => { next[String(r.org._id)] = true; });
    setExpanded(next);
  };

  const s = data?.summary;

  return (
    <div className="admin-orgs-page p-3 p-md-4">
      <PageHeader
        breadcrumb={[{ label: 'Home', path: '/home' }, { label: 'Admin' }, { label: 'All Organizations' }]}
        title="All Organizations"
        actions={(
          <button className="btn btn-sm btn-outline-secondary" onClick={load} disabled={loading}>
            <FaSyncAlt className="me-1" /> Refresh
          </button>
        )}
      />

      {error && <div className="alert alert-danger py-2">{error}</div>}

      {s && (
        <div className="admin-orgs-tiles">
          {[
            ['Accounts', s.accounts],
            ['Organizations', s.organizations],
            ['Devices', s.devices],
            ['Connected', s.connected],
            ['Approved', s.approved],
            ['Active Tunnels', s.tunnels]
          ].map(([label, value]) => (
            <div className="admin-orgs-tile" key={label}>
              <div className="admin-orgs-tile-value">{value}</div>
              <div className="admin-orgs-tile-label">{label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="admin-orgs-toolbar">
        <input
          type="search"
          className="form-control form-control-sm"
          placeholder="Search account, organization, device name, hostname, machine ID, IP..."
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <button className="btn btn-sm btn-outline-primary" onClick={toggleAll} disabled={!rows.length}>
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>

      {loading && !data && (
        <div className="text-center py-5 text-muted">
          <div className="spinner-border spinner-border-sm me-2" />Loading...
        </div>
      )}

      {data && (
        <div className="card border-0 shadow-sm">
          <div className="table-responsive">
            <table className="table unified-table mb-0 align-middle">
              <thead className="table-light">
                <tr>
                  <th style={{ width: 32 }} />
                  <th>Account</th>
                  <th>Organization</th>
                  <th>Group</th>
                  <th className="text-center">Devices</th>
                  <th className="text-center">Connected</th>
                  <th className="text-center">Approved</th>
                  <th className="text-center">Tunnels</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={9} className="text-center text-muted py-4">No organizations found</td></tr>
                )}
                {rows.map(({ acct, org, devices }) => {
                  const id = String(org._id);
                  const open = !!expanded[id];
                  return (
                    <React.Fragment key={id}>
                      <tr className="admin-orgs-row" onClick={() => toggle(id)}>
                        <td className="text-muted">{open ? <FaChevronDown /> : <FaChevronRight />}</td>
                        <td>
                          <div className="fw-semibold">{acct.name}</div>
                          {acct.users?.length > 0 && (
                            <div className="small text-muted">{acct.users.join(', ')}</div>
                          )}
                        </td>
                        <td>
                          {org.name}
                          {org.deleted && <span className="badge bg-secondary ms-2">deleted</span>}
                          {org.description && <div className="small text-muted">{org.description}</div>}
                        </td>
                        <td>{org.group || '-'}</td>
                        <td className="text-center">{org.devicesCount}</td>
                        <td className="text-center">{org.connectedCount}</td>
                        <td className="text-center">{org.approvedCount}</td>
                        <td className="text-center">{org.tunnels}</td>
                        <td className="small">{fmtDate(org.createdAt)}</td>
                      </tr>
                      {open && (
                        <tr className="admin-orgs-devices">
                          <td />
                          <td colSpan={8}>
                            {devices.length === 0 ? (
                              <div className="text-muted small py-2">No devices installed in this organization</div>
                            ) : (
                              <table className="table table-sm mb-0">
                                <thead>
                                  <tr>
                                    <th>Device</th>
                                    <th>Hostname</th>
                                    <th>Machine ID / Serial</th>
                                    <th>Status</th>
                                    <th>Versions</th>
                                    <th>IPs</th>
                                    <th>Registered</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {devices.map(d => (
                                    <tr key={d._id}>
                                      <td>
                                        {d.name || '-'}
                                        {d.description && <div className="small text-muted">{d.description}</div>}
                                      </td>
                                      <td>{d.hostname || '-'}</td>
                                      <td className="small font-monospace">
                                        {d.machineId}
                                        {d.serial && <div className="text-muted">{d.serial}</div>}
                                      </td>
                                      <td><StateBadge device={d} /></td>
                                      <td className="small">
                                        {d.versions?.agent && <div>Agent {d.versions.agent}</div>}
                                        {d.versions?.device && <div className="text-muted">Device {d.versions.device}</div>}
                                        {d.distro?.version && <div className="text-muted">OS {d.distro.version}</div>}
                                      </td>
                                      <td className="small">
                                        {d.ipList && <div>{d.ipList}</div>}
                                        {d.publicIPs?.length > 0 && (
                                          <div className="text-muted">Public {d.publicIPs.join(', ')}</div>
                                        )}
                                        {!d.ipList && !d.publicIPs?.length && '-'}
                                      </td>
                                      <td className="small">{fmtDate(d.createdAt)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminOrganizations;
