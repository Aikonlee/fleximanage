import MfaSettings from '../components/auth/MfaSettings';
import React, { useState, useEffect } from 'react';
import api from '../services/api';
import PageHeader from '../components/common/PageHeader';
import './UserProfile.css';

// User Profile page
// Displays current user info and allows changing password.

export default function UserProfile() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });
  const [msg, setMsg] = useState({ type: '', text: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchUser = async () => {
        try {
            // Fetch current user info from the dedicated /me endpoint
            const resp = await api.get('/users/me'); 
            setUser(resp.data);
        } catch (e) {
            console.error(e);
            setMsg({ type: 'error', text: 'Failed to load user profile' });
        } finally {
            setLoading(false);
        }
    };
    fetchUser();
  }, []);

  const openChangePassword = () => {
    setPasswordForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
    setMsg({ type: '', text: '' });
    setShowModal(true);
  };

  const handlePassChange = (e) => {
    const { name, value } = e.target;
    setPasswordForm(f => ({ ...f, [name]: value }));
  };

  const handleSubmitPassword = async (e) => {
    e.preventDefault();
    setMsg({ type: '', text: '' });

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setMsg({ type: 'error', text: 'New passwords do not match' });
      return;
    }
    if (passwordForm.newPassword.length < 8) {
      setMsg({ type: 'error', text: 'Password must be at least 8 characters' });
      return;
    }

    setSaving(true);
    try {
      await api.post('/users/change-password', {
        oldPassword: passwordForm.oldPassword,
        newPassword: passwordForm.newPassword
      });
      setMsg({ type: 'success', text: 'Password changed successfully' });
      setTimeout(() => setShowModal(false), 1500);
    } catch (e) {
      setMsg({ type: 'error', text: e.response?.data?.error || e.message || 'Failed to change password' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="user-profile-page p-3 p-md-4">
      <div className="profile-container">
        <PageHeader
          breadcrumb={[{ label: 'Home', path: '/home' }, { label: 'User Profile' }]}
          title="User Profile"
        />

        {/* 加载状态 */}
        {loading && (
          <div className="card">
            <div className="card-body">
              <p>Loading...</p>
            </div>
          </div>
        )}
        
        {/* 用户信息卡片 */}
        {user && !loading && (
          <div className="card">
            <div className="card-header">
              <span>User Information</span>
              <button className="btn btn-sm btn-primary btn-change-password" onClick={openChangePassword}>
                Change Password
              </button>
            </div>
            <div className="card-body card-body-table">
              <table className="profile-table">
                <tbody>
                  <tr>
                    <td className="field-label">Name</td>
                    <td className="field-value">{user.name}</td>
                  </tr>
                  <tr>
                    <td className="field-label">Email</td>
                    <td className="field-value">{user.email}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 错误提示 */}
        {!loading && !user && msg.text && (
          <div className="card error-card">
            <div className="card-body error-body">
              <strong>Error:</strong> {msg.text}
            </div>
          </div>
        )}
      </div>

      {user && <MfaSettings />}

      {showModal && (
        <>
          <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 1040 }} onClick={() => setShowModal(false)} />
          <div className="modal d-block" tabIndex="-1" style={{ zIndex: 1050 }}>
            <div className="modal-dialog">
              <div className="modal-content">
                <form onSubmit={handleSubmitPassword}>
                  <div className="modal-header py-2">
                    <h6 className="modal-title">Change Password</h6>
                    <button type="button" className="btn-close" onClick={() => setShowModal(false)} />
                  </div>
                  <div className="modal-body">
                    {msg.text && (
                      <div className={`alert ${msg.type === 'error' ? 'alert-danger' : 'alert-success'} py-2 mb-3`}>
                        {msg.text}
                      </div>
                    )}
                    <div className="mb-3">
                      <label className="form-label">Current Password</label>
                      <input 
                        type="password" 
                        className="form-control" 
                        name="oldPassword" 
                        value={passwordForm.oldPassword} 
                        onChange={handlePassChange} 
                        required 
                      />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">New Password</label>
                      <input 
                        type="password" 
                        className="form-control" 
                        name="newPassword" 
                        value={passwordForm.newPassword} 
                        onChange={handlePassChange} 
                        required 
                        minLength={8}
                      />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Confirm New Password</label>
                      <input 
                        type="password" 
                        className="form-control" 
                        name="confirmPassword" 
                        value={passwordForm.confirmPassword} 
                        onChange={handlePassChange} 
                        required 
                        minLength={8}
                      />
                    </div>
                  </div>
                  <div className="modal-footer py-2">
                    <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setShowModal(false)} disabled={saving}>Cancel</button>
                    <button type="submit" className="btn btn-sm btn-primary" disabled={saving}>{saving ? 'Changing...' : 'Change Password'}</button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
