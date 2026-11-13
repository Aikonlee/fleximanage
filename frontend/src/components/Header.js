import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Navbar, Nav, Dropdown } from 'react-bootstrap';
import { FaUser, FaSignOutAlt, FaBell, FaCog, FaBars, FaGlobe } from 'react-icons/fa';
import { BRAND_NAME } from '../constants/branding';
import { getLocale, setLocale } from '../i18n';
import api from '../services/api';
import './Header.css';


const NOTIFICATIONS_PREVIEW_LIMIT = 8;

const Header = ({ onLogout }) => {
  const [notificationCount, setNotificationCount] = useState(0);
  const displayCount = notificationCount > 9 ? '9+' : notificationCount;
  const [locale, setLocaleState] = useState(getLocale());
  const [recentNotifications, setRecentNotifications] = useState([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsLoaded, setNotificationsLoaded] = useState(false);

  const fetchUnreadCount = async () => {
    try {
      const res = await api.get('/notifications', { params: { status: 'unread', limit: 1 } });
      setNotificationCount(Number(res.headers['records-total']) || 0);
    } catch (e) {
      // Non-fatal - leave the badge at its last known value
    }
  };

  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 60000);
    return () => clearInterval(interval);
  }, []);

  const fetchRecentNotifications = async () => {
    setNotificationsLoading(true);
    try {
      const res = await api.get('/notifications', {
        params: { status: 'unread', limit: NOTIFICATIONS_PREVIEW_LIMIT, sortField: 'time', sortOrder: 'desc' }
      });
      setRecentNotifications(res.data || []);
    } catch (e) {
      // Non-fatal - leave the last known list in place
    } finally {
      setNotificationsLoading(false);
      setNotificationsLoaded(true);
    }
  };

  const handleNotificationsToggle = (isOpen) => {
    if (isOpen) fetchRecentNotifications();
  };

  const markNotificationRead = async (id) => {
    setRecentNotifications((list) => list.filter((n) => n._id !== id));
    setNotificationCount((count) => Math.max(0, count - 1));
    try {
      await api.put(`/notifications/${id}`, { status: 'read' });
    } catch (e) {
      // Best-effort - a stale local state self-corrects on the next poll/open
    }
  };

  const markAllNotificationsRead = async () => {
    setRecentNotifications([]);
    setNotificationCount(0);
    try {
      // No `ids` - marks every notification in the org as read, not just this preview page
      await api.put('/notifications', { status: 'read' });
    } catch (e) {
      // Best-effort - a stale local state self-corrects on the next poll/open
    }
  };

  // Parse token to get username/email + org name
  let userLabel = 'User';
  let orgName = '';
  try {
    const token = localStorage.getItem('token');
    if (token) {
      const payloadB64 = token.split('.')[1];
      if (payloadB64) {
        const json = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'));
        const payload = JSON.parse(decodeURIComponent(escape(json)));
        userLabel = payload.email || payload.username || 'User';
        orgName = payload.orgName || payload.org_name || '';
      }
    }
  } catch (e) {}

  const handleLocaleChange = (loc) => {
    setLocale(loc);
    setLocaleState(loc);
  };

  const formatNotificationTime = (isoTime) => {
    if (!isoTime) return '';
    const diffMs = Date.now() - new Date(isoTime).getTime();
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.round(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return new Date(isoTime).toLocaleDateString();
  };

  return (
    <Navbar bg="white" className="header-navbar">
      <div className="d-flex align-items-center">
        <span className="sidebar-toggle btn btn-link disabled" style={{ cursor: 'default' }}>
          <FaBars />
        </span>
        <h4 className="mb-0 ms-2 header-brand">{BRAND_NAME}</h4>
      </div>

      <Nav className="ms-auto d-flex align-items-center">
        <Dropdown align="end" className="me-3 header-notifications-dropdown" onToggle={handleNotificationsToggle}>
          <Dropdown.Toggle
            variant="link"
            className="notifications-toggle"
            aria-label={`Notifications: ${notificationCount} unread`}
          >
            <FaBell className="notification-icon" />
            {notificationCount > 0 && (
              <span className="notification-badge" role="status" aria-live="polite">{displayCount}</span>
            )}
          </Dropdown.Toggle>
          <Dropdown.Menu className="notifications-menu">
            <div className="notifications-menu-header">
              <span>Notifications</span>
              {recentNotifications.length > 0 && (
                <button type="button" className="notifications-mark-all-btn" onClick={markAllNotificationsRead}>
                  Mark all as read
                </button>
              )}
            </div>
            {notificationsLoading && !notificationsLoaded ? (
              <div className="notifications-empty">Loading...</div>
            ) : recentNotifications.length === 0 ? (
              <div className="notifications-empty">No unread notifications</div>
            ) : (
              recentNotifications.map((n) => (
                <button
                  type="button"
                  key={n._id}
                  className="notification-item"
                  onClick={() => markNotificationRead(n._id)}
                  title="Mark as read"
                >
                  <div className="notification-item-title">
                    {n.severity && <span className={`notification-item-severity ${n.severity}`} />}
                    {n.title}
                  </div>
                  {n.details && <div className="notification-item-details">{n.details}</div>}
                  <div className="notification-item-time">{formatNotificationTime(n.time)}</div>
                </button>
              ))
            )}
            <Dropdown.Item as={Link} to="/account/notifications" className="notifications-menu-footer">
              Notification settings
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>

        <Dropdown align="end" className="me-3 header-locale-dropdown">
          <Dropdown.Toggle variant="link" className="locale-dropdown-toggle">
            <FaGlobe className="me-1" />
            {locale.toUpperCase()}
          </Dropdown.Toggle>
          <Dropdown.Menu>
            <Dropdown.Item onClick={() => handleLocaleChange('en')}>English</Dropdown.Item>
            <Dropdown.Item onClick={() => handleLocaleChange('zh')}>中文</Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>

        <Dropdown align="end">
          <Dropdown.Toggle variant="link" className="user-dropdown">
            <FaUser className="me-2" />
            <span className="user-dropdown-label">
              <span className="user-dropdown-name">{userLabel}</span>
              {orgName && <span className="user-dropdown-org">{orgName}</span>}
            </span>
          </Dropdown.Toggle>

          <Dropdown.Menu>
            <Dropdown.Item as={Link} to="/users/profile">
              <FaUser className="me-2" />
              Profile
            </Dropdown.Item>
            <Dropdown.Item as={Link} to="/account/profile">
              <FaCog className="me-2" />
              Settings
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>

        <button type="button" className="header-logout-btn ms-2" onClick={onLogout} title="Logout">
          <FaSignOutAlt />
        </button>
      </Nav>
    </Navbar>
  );
};

export default Header;