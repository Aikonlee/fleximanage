import React, { useState } from 'react';
import { BRAND_NAME } from '../constants/branding';
import { NavLink } from 'react-router-dom';
import { Nav } from 'react-bootstrap';
import {
  FaHome,
  FaServer,
  FaCog,
  FaChevronDown,
  FaUsers,
  FaInfoCircle,
  FaExchangeAlt,
  FaStore,
  FaShieldAlt,
  FaChartBar,
  FaWrench,
  FaUserShield
} from 'react-icons/fa';
import { hasViewPermission } from '../auth/permissions';
import { useAuth } from '../auth/AuthContext';
import './Sidebar.css';

const Sidebar = ({ collapsed }) => {
  // Default: all groups collapsed
  const [openSections, setOpenSections] = useState({
    account: false, inventory: false, traffic: false, security: false,
    dashboards: false, troubleshoot: false, admin: false
  });

  // Get current user permissions
  const { perms, isAdmin, orgName } = useAuth();

  const toggleSection = (key) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Menu taxonomy mirrors flexiWAN 6.5.1's own sidebar groups: Home / Account /
  // Users / Inventory / Traffic Optimization / App Store / Security / Dashboards / Troubleshoot / About
  const menuItems = [
    { type: 'item', path: '/home', icon: <FaHome />, label: 'Home' },
    {
      type: 'group',
      key: 'account',
      icon: <FaCog />,
      label: 'Account',
      children: [
        { path: '/account/profile', label: 'Profile', permKey: 'accounts' },
        { path: '/organizations', label: 'Organizations', permKey: 'organizations' },
        { path: '/account/access-keys', label: 'Access Keys', permKey: 'accesstokens' },
        { path: '/account/notifications', label: 'Notifications', permKey: 'notifications' },
        { path: '/account/billing', label: 'Billing', permKey: 'billing' },
      ]
    },
    { type: 'item', path: '/users', icon: <FaUsers />, label: 'Users', permKey: 'members' },
    {
      type: 'group',
      key: 'inventory',
      icon: <FaServer />,
      label: 'Inventory',
      children: [
        { path: '/devices', label: 'Devices', permKey: 'devices' },
        { path: '/tokens', label: 'Tokens', permKey: 'tokens' }
      ]
    },
    {
      type: 'group',
      key: 'traffic',
      icon: <FaExchangeAlt />,
      label: 'Traffic Optimization',
      children: [
        { path: '/tunnels', label: 'Tunnels', permKey: 'tunnels' },
        { path: '/path-labels', label: 'Path Labels', permKey: 'pathlabels' },
        { path: '/path-selection-policy', label: 'Path Selection Policy', permKey: 'mlpolicies' },
        { path: '/qos', label: 'Quality of Service', permKey: 'qospolicies' },
        { path: '/link-monitors', label: 'Link Monitors', permKey: 'linkmonitors' },
        { path: '/application-identification', label: 'Application Identification', permKey: 'appidentifications' },
        { path: '/ipsec-peering', label: 'IPsec Peering', permKey: 'peers' },
      ]
    },
    { type: 'item', path: '/app-store', icon: <FaStore />, label: 'App Store', permKey: 'applications' },
    {
      type: 'group',
      key: 'security',
      icon: <FaShieldAlt />,
      label: 'Security',
      children: [
        { path: '/firewall-policies', label: 'Firewall Policies', permKey: 'firewallpolicies' },
        { path: '/high-availability', label: 'High Availability', permKey: 'vrrp' },
        { path: '/ai-network-healing', label: 'AI Network Healing', permKey: 'devices' },
      ]
    },
    {
      type: 'group',
      key: 'dashboards',
      icon: <FaChartBar />,
      label: 'Dashboards',
      children: [
        { path: '/dashboards/network', label: 'Network Connectivity', permKey: 'devices' },
        { path: '/dashboards/world-map', label: 'World Map', permKey: 'devices' },
        { path: '/dashboards/traffic', label: 'Traffic PPS/BPS', permKey: 'devices' },
      ]
    },
    {
      type: 'group',
      key: 'troubleshoot',
      icon: <FaWrench />,
      label: 'Troubleshoot',
      children: [
        { path: '/device-upgrade', label: 'Device Upgrade', permKey: 'devices' },
        { path: '/troubleshoot/notifications', label: 'Notifications', permKey: 'notifications' },
      ]
    },
    {
      type: 'group',
      key: 'admin',
      icon: <FaUserShield />,
      label: 'Admin',
      adminOnly: true,
      children: [
        { path: '/admin/organizations', label: 'All Organizations' }
      ]
    },
    { type: 'item', path: '/about', icon: <FaInfoCircle />, label: 'About' },
  ];

  return (
    <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
  <h3 className="brand">{BRAND_NAME}</h3>
      </div>
      {!collapsed && (
        <div className="sidebar-org-band">
          <span className="sidebar-org-label">Organization:</span>
          <span className="sidebar-org-name">{orgName || '—'}</span>
        </div>
      )}
      <Nav className="flex-column sidebar-nav">
        {menuItems
          .filter(item => !item.adminOnly || isAdmin)
          .filter(item => !item.permKey || hasViewPermission(perms, item.permKey))
          .map(item => {
          if (item.type === 'group') {
            const visibleChildren = item.children.filter(
              child => !child.permKey || hasViewPermission(perms, child.permKey)
            );
            if (visibleChildren.length === 0) return null;
            item = { ...item, children: visibleChildren };
          }
          if (item.type === 'item') {
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              >
                <span className="nav-icon">{item.icon}</span>
                {!collapsed && <span className="nav-label">{item.label}</span>}
              </NavLink>
            );
          }
          if (item.type === 'group') {
            const isOpen = openSections[item.key];
            return (
              <div key={item.key} className={`nav-group ${isOpen ? 'open' : ''} ${collapsed ? 'collapsed' : ''}`}>
                <button type="button" className="nav-link nav-group-toggle" onClick={() => toggleSection(item.key)}>
                  <span className="nav-icon">{item.icon}</span>
                  {!collapsed && (
                    <>
                      <span className="nav-label">{item.label}</span>
                      <span className="nav-group-arrow" aria-hidden="true"><FaChevronDown /></span>
                    </>
                  )}
                </button>
                {isOpen && !collapsed && (
                  <div className="nav-submenu">
                    {item.children.map(child => (
                      <NavLink
                        key={child.path}
                        to={child.path}
                        className={({ isActive }) => `nav-sublink ${isActive ? 'active' : ''}`}
                      >
                        <span className="nav-sublabel">{child.label}</span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          }
          return null;
        })}
      </Nav>
    </div>
  );
};

export default Sidebar;