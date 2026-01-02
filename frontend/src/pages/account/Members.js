import React, { useEffect, useState, useCallback } from 'react';
import { Card, Button, Form, Alert, Badge } from 'react-bootstrap';
import { FaUser, FaSearch, FaCheck, FaTrash, FaUserShield, FaUserMinus } from 'react-icons/fa';
import api from '../../services/api';
import '../../styles/unified-table.css';

// Simple Members listing page. Fetches /members and displays basic columns.
// Reuses existing auth token + permissions guard applied at routing level.
export default function AccountMembers () {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [page, setPage] = useState(0); // zero-based
  const [pageSize, setPageSize] = useState(25);
  const [serverMeta, setServerMeta] = useState({ offset: 0, limit: 25, total: 0 });
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  // Initialize with both states so the interface clearly shows "all states" instead of relying on empty array semantics
  const [stateFilters, setStateFilters] = useState(['unverified', 'verified']); // ['unverified','verified'] means show all
  const [sort, setSort] = useState([]); // array of { key, dir } where dir is 'asc'|'desc'
  const [selectedIds, setSelectedIds] = useState([]); // user__id values
  const allSelected = rows.length > 0 && selectedIds.length === rows.map(r => r.user__id).filter((v, i, a) => a.indexOf(v) === i).length;

  // Debounce search input
  useEffect(() => {
    const h = setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => clearTimeout(h);
  }, [search]);

  const load = useCallback(async ({ page: p, pageSize: ps, q, states, sort: sortState }) => {
    setLoading(true); setError(null);
    try {
      const offset = p * ps;
      const params = { offset, limit: ps };
      if (q && q !== '') params.q = q;
      if (states && states.length > 0) params.state = states.join(',');
      if (sortState && sortState.length > 0) {
        const sortParam = sortState.map(s => (s.dir === 'desc' ? '-' : '') + s.key).join(',');
        if (sortParam) params.sort = sortParam;
      }
      const resp = await api.get('/members', { params });
      const data = resp.data;
      if (Array.isArray(data)) {
        // Pagination metadata now sent via headers when backend returns an array
        const totalHdr = resp.headers['x-total-count'];
        const offHdr = resp.headers['x-offset'];
        const limHdr = resp.headers['x-limit'];
        setRows(data);
        setServerMeta({
          offset: offHdr ? parseInt(offHdr, 10) : offset,
          limit: limHdr ? parseInt(limHdr, 10) : ps,
            total: totalHdr ? parseInt(totalHdr, 10) : (offset + data.length)
        });
      } else {
        // (Legacy/object mode)
        setRows(data.items || []);
        setServerMeta({ offset: data.offset || offset, limit: data.limit || ps, total: data.total ?? (offset + (data.items?.length || 0)) });
      }
    } catch (e) {
      // Prefer API-provided error message when available to avoid showing
      // generic axios messages like "Request failed with status code 400"
      setError((e.response && e.response.data && e.response.data.error) || e.message || 'Failed to load members');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load({ page, pageSize, q: debouncedSearch, states: stateFilters, sort });
  }, [load, page, pageSize, debouncedSearch, stateFilters, sort]);
  const toggleSort = (key) => {
    setPage(0);
    setSort(prev => {
      // simple single-column toggle for now
      const existing = prev.find(s => s.key === key);
      if (!existing) return [{ key, dir: 'asc' }];
      if (existing.dir === 'asc') return [{ key, dir: 'desc' }];
      return []; // remove sort on third click
    });
  };

  const sortIndicator = (key) => {
    const s = sort.find(x => x.key === key);
    if (!s) return null;
    return s.dir === 'asc' ? ' ▲' : ' ▼';
  };


  useEffect(() => {
    // Determine super admin from token (admin flag added to JWT payload)
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      const payloadB64 = token.split('.')[1];
      if (!payloadB64) return;
      const json = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'));
      const payload = JSON.parse(decodeURIComponent(escape(json)));
      setIsSuperAdmin(payload.admin === true);
    } catch (_) {}
  }, []);

  if (loading && !rows.length) return <div className="text-center p-5"><div className="spinner-border text-primary" role="status"><span className="visually-hidden">Loading...</span></div><p className="mt-2 text-muted">Loading users...</p></div>;
  if (error && !rows.length) return <div className="account-members-page p-3 p-md-4"><Alert variant="danger">{error}</Alert></div>;

  return (
    <div className="account-members-page p-3 p-md-4">
      <div className="page-header d-flex justify-content-between align-items-center mb-4 pb-3 border-bottom">
        <div>
          <h1 className="h2 mb-0 text-primary fw-bold">Users</h1>
          <p className="text-muted mb-0 mt-1 small">Manage organization members and permissions</p>
        </div>
        <div className="small text-muted">Total Users: {serverMeta.total}</div>
      </div>

      <div className="filters-bar mb-4 p-3 bg-white border rounded shadow-sm">
        <div className="d-flex flex-wrap gap-3 align-items-end">
          <div className="flex-grow-1">
            <Form.Label className="small fw-bold mb-1">Search</Form.Label>
            <div className="input-group input-group-sm">
              <span className="input-group-text bg-light border-end-0"><FaSearch className="text-muted" /></span>
              <Form.Control
                type="text"
                placeholder="Name / Email / Username / Org"
                value={search}
                onChange={e => { setPage(0); setSearch(e.target.value); }}
                className="border-start-0 ps-0"
              />
              {debouncedSearch && (
                <Button variant="outline-secondary" onClick={() => { setSearch(''); setPage(0); }}>Clear</Button>
              )}
            </div>
          </div>
          
          <div>
            <Form.Label className="small fw-bold mb-1">Filter by State</Form.Label>
            <div className="d-flex gap-2">
              <div className="btn-group">
                <Button
                  variant={stateFilters.length === 1 && stateFilters[0] === 'unverified' ? 'primary' : 'outline-secondary'}
                  size="sm"
                  onClick={() => { setPage(0); setStateFilters(['unverified']); }}
                >Unverified</Button>
                <Button
                  variant={stateFilters.length === 1 && stateFilters[0] === 'verified' ? 'primary' : 'outline-secondary'}
                  size="sm"
                  onClick={() => { setPage(0); setStateFilters(['verified']); }}
                >Verified</Button>
                <Button
                  variant={(stateFilters.includes('unverified') && stateFilters.includes('verified')) ? 'primary' : 'outline-secondary'}
                  size="sm"
                  onClick={() => { setPage(0); setStateFilters(['unverified', 'verified']); }}
                >All</Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {rows.length === 0 && !loading ? (
        <Alert variant="info" className="text-center shadow-sm">No users found matching criteria.</Alert>
      ) : (
        <Card className="shadow-sm border-0">
          <Card.Header className="bg-white border-bottom py-3 d-flex justify-content-between align-items-center">
            <h5 className="mb-0 text-primary fw-bold d-flex align-items-center">
              <FaUser className="me-2" />
              Members List
            </h5>
            {selectedIds.length > 0 && (
              <div className="d-flex align-items-center gap-2">
                <span className="badge bg-secondary">{selectedIds.length} selected</span>
                {isSuperAdmin && (
                  <Button variant="outline-danger" size="sm">Bulk Actions</Button>
                )}
              </div>
            )}
          </Card.Header>
          <Card.Body className="p-0">
            <div className="unified-table-responsive">
              <table className="unified-table table table-hover align-middle mb-0">
                <thead className="table-light">
                  <tr>
                    {isSuperAdmin && (
                      <th style={{ width: '40px' }} className="text-center">
                        <Form.Check
                          type="checkbox"
                          checked={allSelected}
                          onChange={e => {
                            if (e.target.checked) {
                              setSelectedIds(rows.map(r => r.user__id));
                            } else setSelectedIds([]);
                          }}
                        />
                      </th>
                    )}
                    <th role="button" onClick={() => toggleSort('name')}>First Name{sortIndicator('name')}</th>
                    <th role="button" onClick={() => toggleSort('lastName')}>Last Name{sortIndicator('lastName')}</th>
                    <th role="button" onClick={() => toggleSort('email')}>Email{sortIndicator('email')}</th>
                    <th role="button" onClick={() => toggleSort('username')}>Username{sortIndicator('username')}</th>
                    <th role="button" onClick={() => toggleSort('state')}>State{sortIndicator('state')}</th>
                    <th role="button" onClick={() => toggleSort('role')}>Role{sortIndicator('role')}</th>
                    <th role="button" onClick={() => toggleSort('scope')}>Scope{sortIndicator('scope')}</th>
                    <th role="button" onClick={() => toggleSort('organization')}>Organization{sortIndicator('organization')}</th>
                    <th role="button" onClick={() => toggleSort('mfa')}>MFA</th>
                    {isSuperAdmin && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const scope = r.to === 'account' ? 'Account' : (r.to === 'organization' ? 'Organization' : (r.to === 'group' ? 'Group' : r.to));
                    return (
                      <tr key={r._id} className={r.user_state === 'unverified' ? 'table-warning' : ''}>
                        {isSuperAdmin && (
                          <td className="text-center">
                            <Form.Check
                              type="checkbox"
                              checked={selectedIds.includes(r.user__id)}
                              onChange={e => {
                                setSelectedIds(prev => e.target.checked
                                  ? [...prev, r.user__id]
                                  : prev.filter(id => id !== r.user__id));
                              }}
                            />
                          </td>
                        )}
                        <td>{r.user_name || '-'}</td>
                        <td>{r.user_lastName || '-'}</td>
                        <td>
                          <div className="d-flex align-items-center">
                            {r.user_email || '-'}
                            {r.user_admin === true && (
                              <Badge bg="danger" className="ms-2">ADMIN</Badge>
                            )}
                          </div>
                        </td>
                        <td><code>{r.user_username || '-'}</code></td>
                        <td>
                          <Badge bg={r.user_state === 'verified' ? 'success' : 'warning'}>
                            {r.user_state || '-'}
                          </Badge>
                        </td>
                        <td>{r.role || '-'}</td>
                        <td><Badge bg="info">{scope}</Badge></td>
                        <td>{r.organization_name || (r.to === 'account' ? '-' : '')}</td>
                        <td>{r['user.mfa.enabled'] ? <FaCheck className="text-success" /> : <span className="text-muted">-</span>}</td>
                        {isSuperAdmin && (
                          <td>
                            <div className="d-flex gap-1">
                              {r.user_state === 'unverified' && (
                                <Button
                                  variant="success"
                                  size="sm"
                                  onClick={async () => {
                                    try {
                                      await api.post(`/users/${r.user__id}/verify`);
                                      window.location.reload();
                                    } catch (e) {
                                      alert('Verify failed: ' + (e.message || 'error'));
                                    }
                                  }}
                                  title="Approve User"
                                >
                                  <FaCheck />
                                </Button>
                              )}
                              {r.user_admin === true ? (
                                <Button
                                  variant="outline-danger"
                                  size="sm"
                                  onClick={async () => {
                                    if (!window.confirm('Demote this admin user?')) return;
                                    try {
                                      await api.delete(`/users/${r.user__id}/admin`);
                                      window.location.reload();
                                    } catch (e) {
                                      alert('Demote failed: ' + (e.message || 'error'));
                                    }
                                  }}
                                  title="Demote Admin"
                                >
                                  <FaUserMinus />
                                </Button>
                              ) : (
                                <Button
                                  variant="outline-warning"
                                  size="sm"
                                  onClick={async () => {
                                    try {
                                      await api.put(`/users/${r.user__id}/admin`);
                                      window.location.reload();
                                    } catch (e) {
                                      alert('Promote failed: ' + (e.message || 'error'));
                                    }
                                  }}
                                  title="Promote to Admin"
                                >
                                  <FaUserShield />
                                </Button>
                              )}
                              <Button
                                variant="danger"
                                size="sm"
                                onClick={async () => {
                                  if (!window.confirm(`Delete user ${r.user_name} (${r.user_email})?`)) return;
                                  try {
                                    await api.delete(`/members/${r._id}`);
                                    load({ page, pageSize, q: debouncedSearch, states: stateFilters, sort });
                                  } catch (e) {
                                    alert('Delete failed: ' + (e.response?.data?.error || e.message || 'error'));
                                  }
                                }}
                                title="Delete User"
                              >
                                <FaTrash />
                              </Button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card.Body>
          <Card.Footer className="bg-white border-top">
            <div className="d-flex align-items-center gap-3 flex-wrap justify-content-between">
              <div className="d-flex align-items-center gap-2">
                <Form.Select
                  size="sm"
                  style={{ width: 'auto' }}
                  value={pageSize}
                  onChange={e => { setPage(0); setPageSize(parseInt(e.target.value, 10)); }}
                >
                  {[10, 25, 50, 100].map(s => <option key={s} value={s}>{s} per page</option>)}
                </Form.Select>
                <div className="small text-muted">
                  Showing {serverMeta.offset + 1}-{Math.min(serverMeta.offset + rows.length, serverMeta.total)} of {serverMeta.total}
                </div>
              </div>
              <div className="btn-group">
                <Button variant="outline-secondary" size="sm" disabled={page === 0 || loading} onClick={() => setPage(p => Math.max(0, p - 1))}>Prev</Button>
                <Button
                  variant="outline-secondary"
                  size="sm"
                  disabled={loading || (serverMeta.offset + rows.length) >= serverMeta.total}
                  onClick={() => setPage(p => p + 1)}
                >Next</Button>
              </div>
            </div>
          </Card.Footer>
        </Card>
      )}
      
      {isSuperAdmin && selectedIds.length > 0 && (
        <Alert variant="secondary" className="mt-3 d-flex flex-wrap align-items-center gap-2 shadow-sm">
          <span className="small fw-bold">Bulk Actions ({selectedIds.length}):</span>
          <Button
            variant="outline-success"
            size="sm"
            onClick={async () => {
              try {
                await api.post('/users/verify/batch', { ids: selectedIds });
                setSelectedIds([]);
                load({ page, pageSize, q: debouncedSearch, states: stateFilters, sort });
              } catch (e) {
                alert('Batch verify failed: ' + (e.message || 'error'));
              }
            }}
          >Batch Verify</Button>
          <Button
            variant="outline-warning"
            size="sm"
            onClick={async () => {
              try {
                await api.post('/users/admin/batch', { promote: selectedIds });
                setSelectedIds([]);
                load({ page, pageSize, q: debouncedSearch, states: stateFilters, sort });
              } catch (e) {
                alert('Batch promote failed: ' + (e.message || 'error'));
              }
            }}
          >Batch Promote Admin</Button>
          <Button
            variant="outline-danger"
            size="sm"
            onClick={async () => {
              if (!window.confirm('Demote selected admins (non-admins ignored)?')) return;
              try {
                await api.post('/users/admin/batch', { demote: selectedIds });
                setSelectedIds([]);
                load({ page, pageSize, q: debouncedSearch, states: stateFilters, sort });
              } catch (e) {
                alert('Batch demote failed: ' + (e.message || 'error'));
              }
            }}
          >Batch Demote Admin</Button>
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={() => setSelectedIds([])}
          >Clear Selection</Button>
        </Alert>
      )}
    </div>
  );
}