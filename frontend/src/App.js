import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
// import { Container } from 'react-bootstrap';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Footer from './components/Footer';
import Home from './pages/Home';
import Account from './pages/Account';
import AccountProfile from './pages/account/Profile';
import AccountOrganizations from './pages/account/Organizations';
import AccountNotificationsSettings from './pages/account/NotificationsSettings';
import AccountBilling from './pages/account/Billing';
import AccountAccessKeys from './pages/account/AccessKeys';
import AccountMembers from './pages/account/Members';
import UserProfile from './pages/UserProfile';
import Organizations from './pages/Organizations';
import AddOrganization from './pages/AddOrganization';
import EditOrganization from './pages/EditOrganization';
import Devices from './pages/Devices';
import DeviceInfo from './pages/DeviceInfo';
import Tunnels from './pages/Tunnels';
import Tokens from './pages/Tokens';
import Login from './pages/Login';
import VerifyAccount from './pages/VerifyAccount';
import About from './pages/About';
import PathLabels from './pages/PathLabels';
import PathSelectionPolicy from './pages/PathSelectionPolicy';
import PathSelectionPolicyEditor from './pages/PathSelectionPolicyEditor';
import QoS from './pages/QoS';
import QoSEditor from './pages/QoSEditor';
import FirewallPolicies from './pages/FirewallPolicies';
import FirewallPolicyEditor from './pages/FirewallPolicyEditor';
import IpsecPeering from './pages/IpsecPeering';
import IpsecPeeringEditor from './pages/IpsecPeeringEditor';
import HighAvailability from './pages/HighAvailability';
import HighAvailabilityEditor from './pages/HighAvailabilityEditor';
import DeviceUpgrade from './pages/DeviceUpgrade';
import Notifications from './pages/Notifications';
import AppStore from './pages/AppStore';
import LinkMonitors from './pages/LinkMonitors';
import ApplicationIdentification from './pages/ApplicationIdentification';
import WorldMapDashboard from './pages/dashboards/WorldMap';
import NetworkConnectivity from './pages/dashboards/NetworkConnectivity';
import TrafficDashboard from './pages/dashboards/TrafficDashboard';
import ComingSoon from './pages/ComingSoon';
import { decodeJwtPayload, extractPerms, hasViewPermission } from './auth/permissions';
import Forbidden from './components/Forbidden';
import Register from './pages/Register';
import './styles/App.css';
import './styles/layout.css';
import './styles/unified-table.css';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [sidebarCollapsed] = useState(false); // legacy placeholder
  const [perms, setPerms] = useState({});
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    // Check authentication status
    const token = localStorage.getItem('token');
    if (token) {
      setIsAuthenticated(true);
      const payload = decodeJwtPayload(token);
      setPerms(extractPerms(payload));
    }
  }, []);

  const handleLogin = () => {
    setIsAuthenticated(true);
    // Decode permissions after new token saved by Login component
    const token = localStorage.getItem('token');
    if (token) {
      const payload = decodeJwtPayload(token);
      setPerms(extractPerms(payload));
    }
    // If user was on /login (or any non-app path), send them to /home
    setTimeout(() => {
      if (location.pathname === '/login' || location.pathname === '/register') {
        navigate('/home', { replace: true });
      }
    }, 0);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setIsAuthenticated(false);
    setPerms({});
  };

  // Sidebar toggle removed from header; keeping state & logic placeholder if reintroduced later.
  // const toggleSidebar = () => setSidebarCollapsed(!sidebarCollapsed);

  if (!isAuthenticated) {
    // Unauthenticated routes (login, register, verify-account)
    if (location.pathname === '/register') return <Register />;
    if (location.pathname.startsWith('/verify-account')) return <VerifyAccount />;
    return <Login onLogin={handleLogin} />;
  }

  // Wrapper component for guarded routes
  const Guard = ({ permKey, element }) => {
    if (!permKey) return element; // no guard
    if (hasViewPermission(perms, permKey)) return element;
    return <Forbidden />;
  };

  return (
    <div className="app app-root">
      <Header onLogout={handleLogout} />
      <Sidebar collapsed={sidebarCollapsed} />
      <div className={`content-area ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <div className="page-content">
          <Routes>
            <Route path="/" element={<Navigate to="/home" replace />} />
            <Route path="/home" element={<Home />} />
            <Route path="/account" element={<Guard permKey="accounts" element={<Account />} />} />
            <Route path="/account/profile" element={<Guard permKey="accounts" element={<AccountProfile />} />} />
              <Route path="/account/organizations" element={<Guard permKey="organizations" element={<AccountOrganizations />} />} />
            <Route path="/account/notifications" element={<Guard permKey="notifications" element={<AccountNotificationsSettings />} />} />
            <Route path="/account/billing" element={<Guard permKey="billing" element={<AccountBilling />} />} />
            { /* Users page guarded by dedicated 'members' permission */ }
            <Route path="/users/profile" element={<UserProfile />} />
            <Route path="/users" element={<Guard permKey="members" element={<AccountMembers />} />} />
            <Route path="/account/members" element={<Navigate to="/users" replace />} />
            <Route path="/account/access-keys" element={<Guard permKey="accesstokens" element={<AccountAccessKeys />} />} />
            <Route path="/organizations" element={<Guard permKey="organizations" element={<Organizations />} />} />
            <Route path="/organizations/add" element={<Guard permKey="organizations" element={<AddOrganization />} />} />
            <Route path="/organizations/edit/:id" element={<Guard permKey="organizations" element={<EditOrganization />} />} />
            <Route path="/devices" element={<Guard permKey="devices" element={<Devices />} />} />
            <Route path="/devices/:deviceId" element={<Guard permKey="devices" element={<DeviceInfo />} />} />
            <Route path="/tunnels" element={<Guard permKey="tunnels" element={<Tunnels />} />} />
            <Route path="/tokens" element={<Guard permKey="accesstokens" element={<Tokens />} />} />
            <Route path="/path-labels" element={<Guard permKey="pathlabels" element={<PathLabels />} />} />
            <Route path="/path-selection-policy" element={<Guard permKey="mlpolicies" element={<PathSelectionPolicy />} />} />
            <Route path="/path-selection-policy/:id" element={<Guard permKey="mlpolicies" element={<PathSelectionPolicyEditor />} />} />
            <Route path="/qos" element={<Guard permKey="qospolicies" element={<QoS />} />} />
            <Route path="/qos/:id" element={<Guard permKey="qospolicies" element={<QoSEditor />} />} />
            <Route path="/link-monitors" element={<Guard permKey="linkmonitors" element={<LinkMonitors />} />} />
            <Route path="/application-identification" element={<Guard permKey="appidentifications" element={<ApplicationIdentification />} />} />
            <Route path="/ipsec-peering" element={<Guard permKey="peers" element={<IpsecPeering />} />} />
            <Route path="/ipsec-peering/:id" element={<Guard permKey="peers" element={<IpsecPeeringEditor />} />} />
            <Route path="/app-store" element={<Guard permKey="applications" element={<AppStore />} />} />
            <Route path="/firewall-policies" element={<Guard permKey="firewallpolicies" element={<FirewallPolicies />} />} />
            <Route path="/firewall-policies/:id" element={<Guard permKey="firewallpolicies" element={<FirewallPolicyEditor />} />} />
            <Route path="/high-availability" element={<Guard permKey="vrrp" element={<HighAvailability />} />} />
            <Route path="/high-availability/:id" element={<Guard permKey="vrrp" element={<HighAvailabilityEditor />} />} />
            <Route path="/ai-network-healing" element={<Guard permKey="devices" element={<ComingSoon
              title="AI Network Healing"
              breadcrumb={[{ label: 'Home', path: '/home' }, { label: 'Security' }, { label: 'AI Network Healing' }]}
              message={'AI Network Healing isn\'t a standalone settings page in flexiWAN - it runs automatically in the background. ' +
                'Watch for it via a tunnel\'s "Pending" status (hover for the detected issue) on the Tunnels page, ' +
                'related entries on Troubleshoot › Notifications, and the "Sync" action on a device’s page.'}
            />} />} />
            <Route path="/dashboards/network" element={<NetworkConnectivity />} />
            <Route path="/dashboards/world-map" element={<WorldMapDashboard />} />
            <Route path="/dashboards/traffic" element={<TrafficDashboard />} />
            <Route path="/device-upgrade" element={<Guard permKey="devices" element={<DeviceUpgrade />} />} />
            <Route path="/troubleshoot/notifications" element={<Guard permKey="notifications" element={<Notifications />} />} />
            <Route path="/about" element={<About />} />
          </Routes>
        </div>
        <Footer />
      </div>
    </div>
  );
}

export default App;