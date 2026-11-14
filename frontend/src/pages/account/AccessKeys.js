import PermissionButton from '../../components/common/PermissionButton';
import React, { useEffect, useMemo, useState } from 'react';
import { Card, Button, Form, Alert, Row, Col } from 'react-bootstrap';
import { FaKey, FaCopy, FaTrash, FaPlus, FaTimes } from 'react-icons/fa';
import api from '../../services/api';
import PageHeader from '../../components/common/PageHeader';
import '../../styles/unified-table.css';

// Access Keys management: creates scoped access keys with role-based permissions.
// Backend (OpenAPI) expects AccessTokenRequest: {
//   name, accessKeyPermissionTo (account|group|organization), accessKeyEntity, accessKeyRole (owner|manager|viewer), validityEntity
// }

const AccountAccessKeys = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [keys, setKeys] = useState([]);
  const [creating, setCreating] = useState(false);
  const [orgs, setOrgs] = useState([]); // organizations list
  const [groups, setGroups] = useState([]); // derived group names
  const [formName, setFormName] = useState('');
  const [permissionTo, setPermissionTo] = useState('account');
  const [entity, setEntity] = useState(''); // holds account id, group name, or org id
  const [role, setRole] = useState('owner');
  const [validity, setValidity] = useState('Default'); // placeholder for future validity options
  const [accountName, setAccountName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [newToken, setNewToken] = useState(null);
  const [page, setPage] = useState(0);
  const [pageSize] = useState(10);
  const [copiedKey, setCopiedKey] = useState(null); // track which key was copied for feedback
  const [showForm, setShowForm] = useState(false);

  // Decode token to get accountName (payload.accountName)
  useEffect(() => {
    try {
      const token = localStorage.getItem('token');
      if (token) {
        const payloadB64 = token.split('.')[1];
        const json = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'));
        const p = JSON.parse(decodeURIComponent(escape(json)));
        if (p.accountName) setAccountName(p.accountName);
        if (p.account) setAccountId(p.account);
      }
    } catch (_) { /* ignore decode errors */ }
  }, []);

  const copyToClipboard = async (tokenValue, keyId) => {
    try {
      // Modern browsers - use Clipboard API
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(tokenValue);
        setCopiedKey(keyId);
        // Clear feedback after 2 seconds
        setTimeout(() => setCopiedKey(null), 2000);
        return;
      }
      
      // Fallback for older browsers or non-HTTPS contexts
      const textArea = document.createElement('textarea');
      textArea.value = tokenValue;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      
      if (successful) {
        setCopiedKey(keyId);
        setTimeout(() => setCopiedKey(null), 2000);
      } else {
        throw new Error('Copy command failed');
      }
    } catch (err) {
      console.error('Failed to copy access key:', err);
      // Provide fallback - select the text for manual copy
      const keyElement = document.querySelector(`[data-key-id="${keyId}"]`);
      if (keyElement) {
        const range = document.createRange();
        range.selectNodeContents(keyElement);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
      alert('Copy failed. Please manually select and copy the highlighted key.');
    }
  };

  const loadKeys = async () => {
    setLoading(true); setError(null);
    try {
      const resp = await api.get('/accesstokens');
      const list = Array.isArray(resp.data) ? resp.data : [];
      // Normalise: service returns _id vs legacy id
      const mapped = list.map(r => ({
        id: r._id || r.id,
        name: r.name,
        token: r.token,
        to: r.to,
        role: r.role,
        group: r.group,
        organization: r.organization,
        isValid: r.isValid
      }));
      setKeys(mapped);
      setPage(0); // reset page on reload
    } catch (e) {
      setError((e.response && e.response.data && e.response.data.error) || e.message || 'Failed to load access keys');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKeys();
    (async () => {
      try {
        const resp = await api.get('/organizations');
        const list = Array.isArray(resp.data) ? resp.data : [];
        setOrgs(list);
        const uniqueGroups = Array.from(new Set(list.map(o => o.group))).filter(Boolean).sort();
        setGroups(uniqueGroups);
      } catch (e) { /* ignore */ }
    })();
  }, []);

  // Recompute default entity whenever permissionTo or orgs/groups/account changes
  useEffect(() => {
    if (permissionTo === 'account') {
      setEntity(accountId || '');
      setRole(r => ['owner', 'manager', 'viewer'].includes(r) ? r : 'owner');
    } else if (permissionTo === 'group') {
      setEntity(prev => groups.includes(prev) ? prev : (groups[0] || ''));
      setRole(r => ['manager', 'viewer'].includes(r) ? r : 'manager');
    } else if (permissionTo === 'organization') {
      setEntity(prev => (orgs.some(o => (o._id || o.id) === prev) ? prev : (orgs[0]?._id || orgs[0]?.id || '')));
      setRole(r => ['manager', 'viewer'].includes(r) ? r : 'manager');
    }
  }, [permissionTo, accountId, orgs, groups]);

  const availableRoles = useMemo(() => {
    if (permissionTo === 'account') return ['owner', 'manager', 'viewer'];
    return ['manager', 'viewer'];
  }, [permissionTo]);

  const entityLabel = useMemo(() => {
    switch (permissionTo) {
      case 'account': return accountName || '-';
      case 'group': return entity || '-';
      case 'organization': {
        const org = orgs.find(o => (o._id || o.id) === entity);
        return org?.name || '-';
      }
      default: return '-';
    }
  }, [permissionTo, entity, orgs, accountName]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!formName.trim()) { setError('Name is required'); return; }
    if (!permissionTo) { setError('Permission scope required'); return; }
    if (!entity) { setError('Entity required'); return; }
    if (!role) { setError('Role required'); return; }
    setCreating(true); setError(null); setNewToken(null);
    try {
      const payload = {
        name: formName.trim(),
        accessKeyPermissionTo: permissionTo,
        accessKeyEntity: entity,
        accessKeyRole: role,
        validityEntity: validity
      };
      const resp = await api.post('/accesstokens', payload);
      if (resp.data) {
        const rec = resp.data;
        setNewToken(rec.token);
        // Insert optimistic row (GET again if we want full list fields)
        setKeys(prev => [{
          id: rec._id || rec.id,
          name: rec.name,
          token: rec.token,
          to: permissionTo,
            role: role,
          group: permissionTo === 'group' ? entity : '',
          organization: permissionTo === 'organization' ? (orgs.find(o => (o._id || o.id) === entity)?.name || '') : null,
          isValid: true
        }, ...prev]);
        setPage(0);
        // Don't close form immediately so user can copy token
      }
    } catch (ePost) {
      setError(ePost.response?.data?.error || ePost.message);
    } finally {
      setCreating(false);
    }
  };

  const closeForm = () => {
    setShowForm(false);
    setNewToken(null);
    setFormName('');
    setError(null);
  };

  return (
    <div className="account-access-keys-page p-3 p-md-4">
      <PageHeader
        breadcrumb={[{ label: 'Home', path: '/home' }, { label: 'Account' }, { label: 'Access Keys' }]}
        title="Access Keys"
        actions={(
          <Button
            variant={showForm ? "secondary" : "primary"}
            onClick={showForm ? closeForm : () => setShowForm(true)}
            className="shadow-sm d-flex align-items-center"
          >
            {showForm ? <><FaTimes className="me-2" /> Close Form</> : <><FaPlus className="me-2" /> Add Access Key</>}
          </Button>
        )}
      />

      {showForm && (
        <Card className="border-0 shadow-sm mb-4">
          <Card.Header className="bg-white border-bottom py-3">
            <h5 className="mb-0 text-primary fw-bold d-flex align-items-center">
              <FaKey className="me-2" />
              Create New Access Key
            </h5>
          </Card.Header>
          <Card.Body>
            <Form onSubmit={handleAdd}>
              <Row className="g-3 align-items-end">
                <Col md={3}>
                  <Form.Group>
                    <Form.Label className="small fw-bold">Name</Form.Label>
                    <Form.Control size="sm" value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. CI Pipeline" required disabled={creating} />
                  </Form.Group>
                </Col>
                <Col md={2}>
                  <Form.Group>
                    <Form.Label className="small fw-bold">Permission To</Form.Label>
                    <Form.Select size="sm" value={permissionTo} onChange={e => setPermissionTo(e.target.value)} disabled={creating}>
                      <option value="account">Account</option>
                      <option value="group">Group</option>
                      <option value="organization">Organization</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={2}>
                  <Form.Group>
                    <Form.Label className="small fw-bold">Entity</Form.Label>
                    {permissionTo === 'account' && (
                      <Form.Control size="sm" value={entityLabel} disabled readOnly />
                    )}
                    {permissionTo === 'group' && (
                      <Form.Select size="sm" value={entity} onChange={e => setEntity(e.target.value)} disabled={creating || groups.length === 0}>
                        {groups.length === 0 && <option value="">No Groups</option>}
                        {groups.map(g => <option key={g} value={g}>{g}</option>)}
                      </Form.Select>
                    )}
                    {permissionTo === 'organization' && (
                      <Form.Select size="sm" value={entity} onChange={e => setEntity(e.target.value)} disabled={creating || orgs.length === 0}>
                        {orgs.length === 0 && <option value="">No Orgs</option>}
                        {orgs.map(o => <option key={o._id || o.id} value={o._id || o.id}>{o.name}</option>)}
                      </Form.Select>
                    )}
                  </Form.Group>
                </Col>
                <Col md={2}>
                  <Form.Group>
                    <Form.Label className="small fw-bold">Role</Form.Label>
                    <Form.Select size="sm" value={role} onChange={e => setRole(e.target.value)} disabled={creating}>
                      {availableRoles.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={1}>
                  <Form.Group>
                    <Form.Label className="small fw-bold">Validity</Form.Label>
                    <Form.Select size="sm" value={validity} onChange={e => setValidity(e.target.value)} disabled>
                      <option value="Default">Default</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={2}>
                  <PermissionButton permKey="accesstokens" method={'post'} type="submit" variant="primary" size="sm" className="w-100" disabled={creating}>
                    {creating ? 'Adding...' : 'Create Key'}
                  </PermissionButton>
                </Col>
              </Row>
            </Form>

            <div className="mt-3">
              <p className="small text-muted mb-0">Token will be shown only once after creation. Store it securely.</p>
            </div>

            {error && <Alert variant="danger" className="mt-3 py-2">{error}</Alert>}
            
            {newToken && (
              <Alert variant="warning" className="mt-3 py-3 shadow-sm border-warning">
                <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
                  <div>
                    <strong>Copy your token now:</strong> 
                    <code className="ms-2 user-select-all bg-white px-2 py-1 rounded border" data-key-id="new-token">{newToken}</code>
                  </div>
                  <Button
                    variant={copiedKey === 'new-token' ? "success" : "outline-dark"}
                    size="sm"
                    onClick={() => copyToClipboard(newToken, 'new-token')}
                  >
                    {copiedKey === 'new-token' ? 'Copied!' : <><FaCopy className="me-1"/> Copy Token</>}
                  </Button>
                </div>
              </Alert>
            )}
          </Card.Body>
        </Card>
      )}

      {loading ? (
        <div className="text-center py-5 text-muted"><div className="spinner-border spinner-border-sm me-2"></div>Loading...</div>
      ) : (
        <Card className="shadow-sm border-0">
          <Card.Body className="p-0">
            {keys.length === 0 ? (
              <div className="text-center p-5 text-muted">No access keys found. Click "Add Access Key" to create one.</div>
            ) : (
              <>
                <div className="unified-table-container shadow-none border-0">
                  <table className="table unified-table table-hover align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th style={{ minWidth: 120 }}>Name</th>
                        <th style={{ minWidth: 260 }}>Key</th>
                        <th>To</th>
                        <th>Entity</th>
                        <th>Role</th>
                        <th>Status</th>
                        <th style={{ width: 140, textAlign: 'center' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {keys.slice(page * pageSize, page * pageSize + pageSize).map(k => {
                        const entityDisplay = k.to === 'account'
                          ? accountName
                          : (k.to === 'group' ? k.group : (k.organization || '-'));
                        return (
                          <tr key={k.id}>
                            <td className="fw-bold text-primary text-break" style={{ maxWidth: 180 }}>{k.name || '-'}</td>
                            <td className="font-monospace text-muted small" style={{ wordBreak: 'break-all', maxWidth: 360 }}>
                              {k.token ? (
                                <span data-key-id={k.id}>{k.token}</span>
                              ) : (
                                <span className="text-muted fst-italic">(hidden)</span>
                              )}
                            </td>
                            <td><span className="badge bg-secondary">{k.to}</span></td>
                            <td>{entityDisplay || '-'}</td>
                            <td>{k.role || '-'}</td>
                            <td>
                              <span className={`badge ${k.isValid ? 'bg-success' : 'bg-danger'}`}>
                                {k.isValid ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td>
                              <div className="d-flex justify-content-center gap-2">
                                <Button
                                  variant={copiedKey === k.id ? "success" : "outline-secondary"}
                                  size="sm"
                                  disabled={!k.token}
                                  onClick={() => copyToClipboard(k.token, k.id)}
                                  title="Copy"
                                >
                                  {copiedKey === k.id ? 'Copied' : <FaCopy />}
                                </Button>
                                <PermissionButton permKey="accesstokens" method={'delete'}
                                  variant="outline-danger"
                                  size="sm"
                                  onClick={async () => {
                                    if (!window.confirm('Delete this access key?')) return;
                                    try {
                                      await api.delete(`/accesstokens/${k.id}`);
                                      setKeys(prev => prev.filter(x => x.id !== k.id));
                                    } catch (eDel) {
                                      alert('Delete failed: ' + (eDel.response?.data?.error || eDel.message));
                                    }
                                  }}
                                  title="Delete"
                                >
                                  <FaTrash />
                                </PermissionButton>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {/* Pagination Footer */}
                <div className="card-footer bg-white border-top d-flex justify-content-between align-items-center">
                  <div className="small text-muted">
                    {(() => {
                      const total = keys.length;
                      const start = total === 0 ? 0 : page * pageSize + 1;
                      const end = Math.min(total, page * pageSize + pageSize);
                      return `Showing ${start} to ${end} of ${total} Results`;
                    })()}
                  </div>
                  <div className="btn-group">
                    <Button variant="outline-secondary" size="sm" disabled={page === 0} onClick={() => setPage(0)}>First</Button>
                    <Button variant="outline-secondary" size="sm" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>Back</Button>
                    <div className="btn btn-sm btn-outline-secondary disabled text-dark fw-bold" style={{ opacity: 1 }}>{page + 1}</div>
                    <Button variant="outline-secondary" size="sm" disabled={(page + 1) * pageSize >= keys.length} onClick={() => setPage(p => ((p + 1) * pageSize < keys.length ? p + 1 : p))}>Next</Button>
                    <Button variant="outline-secondary" size="sm" disabled={(page + 1) * pageSize >= keys.length} onClick={() => setPage(Math.max(0, Math.ceil(keys.length / pageSize) - 1))}>Last</Button>
                  </div>
                </div>
              </>
            )}
          </Card.Body>
        </Card>
      )}
    </div>
  );
};

export default AccountAccessKeys;