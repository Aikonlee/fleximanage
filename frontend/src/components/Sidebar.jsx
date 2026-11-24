import React, { useCallback, useEffect, useRef, useState } from 'react';
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

export const MIN_THUMB_HEIGHT_PX = 28;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export function computeScrollbarMetrics({
  scrollTop = 0,
  scrollHeight = 0,
  clientHeight = 0,
  trackHeight,
  minThumbPx = MIN_THUMB_HEIGHT_PX
} = {}) {
  const safeClientHeight = Number.isFinite(clientHeight) && clientHeight > 0 ? clientHeight : 0;
  const safeScrollHeight = Number.isFinite(scrollHeight) && scrollHeight > 0 ? scrollHeight : 0;
  const maxScroll = safeScrollHeight - safeClientHeight;

  if (safeClientHeight <= 0 || maxScroll <= 0) {
    return {
      scrollable: false,
      scrollRatio: 0,
      thumbHeightRatio: 1,
      thumbHeightPx: 0,
      thumbTopPx: 0
    };
  }

  const safeScrollTop = Number.isFinite(scrollTop) ? scrollTop : 0;
  const scrollRatio = clamp(safeScrollTop / maxScroll, 0, 1);
  const thumbHeightRatio = clamp(safeClientHeight / safeScrollHeight, 0, 1);
  const effectiveTrackHeight =
    Number.isFinite(trackHeight) && trackHeight > 0 ? trackHeight : safeClientHeight;
  const safeMinThumb = Number.isFinite(minThumbPx) && minThumbPx > 0 ? minThumbPx : 0;
  const minThumb = Math.min(safeMinThumb, effectiveTrackHeight);
  const thumbHeightPx = clamp(thumbHeightRatio * effectiveTrackHeight, minThumb, effectiveTrackHeight);
  const maxThumbTopPx = Math.max(0, effectiveTrackHeight - thumbHeightPx);
  const thumbTopPx = scrollRatio * maxThumbTopPx;

  return {
    scrollable: true,
    scrollRatio,
    thumbHeightRatio,
    thumbHeightPx,
    thumbTopPx
  };
}

export function computeScrollTopForDrag({
  startScrollTop = 0,
  deltaY = 0,
  trackHeight = 0,
  thumbHeightPx = 0,
  scrollHeight = 0,
  clientHeight = 0
} = {}) {
  const maxScroll = scrollHeight - clientHeight;
  if (!Number.isFinite(maxScroll) || maxScroll <= 0) return 0;

  const safeStart = Number.isFinite(startScrollTop) ? startScrollTop : 0;
  const maxThumbTop = trackHeight - thumbHeightPx;
  if (!Number.isFinite(maxThumbTop) || maxThumbTop <= 0) {
    return clamp(safeStart, 0, maxScroll);
  }

  const safeDeltaY = Number.isFinite(deltaY) ? deltaY : 0;
  const scrollDelta = (safeDeltaY / maxThumbTop) * maxScroll;
  return clamp(safeStart + scrollDelta, 0, maxScroll);
}

export function computeScrollTopForTrackClick({
  clickOffsetY = 0,
  trackHeight = 0,
  thumbHeightPx = 0,
  scrollHeight = 0,
  clientHeight = 0
} = {}) {
  const maxScroll = scrollHeight - clientHeight;
  if (!Number.isFinite(maxScroll) || maxScroll <= 0) return 0;

  const maxThumbTop = trackHeight - thumbHeightPx;
  if (!Number.isFinite(maxThumbTop) || maxThumbTop <= 0) return 0;

  const safeClickY = Number.isFinite(clickOffsetY) ? clickOffsetY : 0;
  const desiredThumbTop = clamp(safeClickY - thumbHeightPx / 2, 0, maxThumbTop);
  const ratio = clamp(desiredThumbTop / maxThumbTop, 0, 1);
  return ratio * maxScroll;
}

const INITIAL_METRICS = {
  scrollable: false,
  scrollRatio: 0,
  thumbHeightRatio: 1,
  thumbHeightPx: 0,
  thumbTopPx: 0
};

const Sidebar = ({ collapsed }) => {
  // Default: all groups collapsed
  const [openSections, setOpenSections] = useState({
    account: false, inventory: false, traffic: false, security: false,
    dashboards: false, troubleshoot: false, admin: false
  });
  const [scrollMetrics, setScrollMetrics] = useState(INITIAL_METRICS);
  const [isDragging, setIsDragging] = useState(false);

  const sidebarRef = useRef(null);
  const contentRef = useRef(null);
  const trackRef = useRef(null);
  const dragCleanupRef = useRef(null);

  // Get current user permissions
  const { perms, isAdmin, orgName } = useAuth();

  const toggleSection = (key) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const updateMetrics = useCallback(() => {
    const sidebarEl = sidebarRef.current;
    if (!sidebarEl) return;

    const trackEl = trackRef.current;
    const trackHeight = trackEl && trackEl.clientHeight > 0
      ? trackEl.clientHeight
      : sidebarEl.clientHeight;

    const next = computeScrollbarMetrics({
      scrollTop: sidebarEl.scrollTop,
      scrollHeight: sidebarEl.scrollHeight,
      clientHeight: sidebarEl.clientHeight,
      trackHeight
    });

    setScrollMetrics(prev => (
      prev.scrollable === next.scrollable &&
      prev.scrollRatio === next.scrollRatio &&
      prev.thumbHeightRatio === next.thumbHeightRatio &&
      prev.thumbHeightPx === next.thumbHeightPx &&
      prev.thumbTopPx === next.thumbTopPx
        ? prev
        : next
    ));
  }, []);

  useEffect(() => {
    const sidebarEl = sidebarRef.current;
    if (!sidebarEl) return undefined;

    updateMetrics();
    sidebarEl.addEventListener('scroll', updateMetrics, { passive: true });
    window.addEventListener('resize', updateMetrics);

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        updateMetrics();
      });
      resizeObserver.observe(sidebarEl);
      if (contentRef.current) {
        resizeObserver.observe(contentRef.current);
      }
    }

    return () => {
      sidebarEl.removeEventListener('scroll', updateMetrics);
      window.removeEventListener('resize', updateMetrics);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [updateMetrics]);

  useEffect(() => {
    updateMetrics();
  }, [openSections, collapsed, isAdmin, orgName, perms, updateMetrics]);

  useEffect(() => () => {
    if (dragCleanupRef.current) {
      dragCleanupRef.current();
    }
  }, []);

  const startDrag = useCallback((pointerId, captureTarget, startClientY, startScrollTop) => {
    if (dragCleanupRef.current) {
      dragCleanupRef.current();
    }

    const sidebarEl = sidebarRef.current;
    if (!sidebarEl) return;

    try {
      if (pointerId != null && captureTarget?.setPointerCapture) {
        captureTarget.setPointerCapture(pointerId);
      }
    } catch (_err) {
      // Ignore synthetic events without an active pointer ID
    }

    setIsDragging(true);

    const handlePointerMove = (moveEvent) => {
      if (pointerId != null && moveEvent.pointerId != null && moveEvent.pointerId !== pointerId) {
        return;
      }
      const trackEl = trackRef.current;
      const trackHeight = trackEl && trackEl.clientHeight > 0
        ? trackEl.clientHeight
        : sidebarEl.clientHeight;
      const current = computeScrollbarMetrics({
        scrollTop: sidebarEl.scrollTop,
        scrollHeight: sidebarEl.scrollHeight,
        clientHeight: sidebarEl.clientHeight,
        trackHeight
      });
      if (!current.scrollable) return;

      sidebarEl.scrollTop = computeScrollTopForDrag({
        startScrollTop,
        deltaY: moveEvent.clientY - startClientY,
        trackHeight,
        thumbHeightPx: current.thumbHeightPx,
        scrollHeight: sidebarEl.scrollHeight,
        clientHeight: sidebarEl.clientHeight
      });
      updateMetrics();
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
      captureTarget?.removeEventListener?.('lostpointercapture', handleLostCapture);
      try {
        if (pointerId != null && captureTarget?.hasPointerCapture?.(pointerId)) {
          captureTarget.releasePointerCapture(pointerId);
        }
      } catch (_err) {
        // Ignore if capture was already released
      }
      setIsDragging(false);
      if (dragCleanupRef.current === cleanup) {
        dragCleanupRef.current = null;
      }
    };

    const handlePointerEnd = (endEvent) => {
      if (pointerId != null && endEvent.pointerId != null && endEvent.pointerId !== pointerId) {
        return;
      }
      cleanup();
    };

    const handleLostCapture = () => {
      cleanup();
    };

    dragCleanupRef.current = cleanup;
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
    captureTarget?.addEventListener?.('lostpointercapture', handleLostCapture);
  }, [updateMetrics]);

  const handleThumbPointerDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const sidebarEl = sidebarRef.current;
    if (!sidebarEl || !scrollMetrics.scrollable) return;

    startDrag(e.pointerId, e.currentTarget, e.clientY, sidebarEl.scrollTop);
  };

  const handleTrackPointerDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const sidebarEl = sidebarRef.current;
    const trackEl = trackRef.current;
    if (!sidebarEl || !trackEl || !scrollMetrics.scrollable) return;

    const rect = trackEl.getBoundingClientRect();
    const trackHeight = rect.height > 0
      ? rect.height
      : (trackEl.clientHeight > 0 ? trackEl.clientHeight : sidebarEl.clientHeight);
    const clickOffsetY = e.clientY - rect.top;

    const current = computeScrollbarMetrics({
      scrollTop: sidebarEl.scrollTop,
      scrollHeight: sidebarEl.scrollHeight,
      clientHeight: sidebarEl.clientHeight,
      trackHeight
    });
    if (!current.scrollable) return;

    const targetScrollTop = computeScrollTopForTrackClick({
      clickOffsetY,
      trackHeight,
      thumbHeightPx: current.thumbHeightPx,
      scrollHeight: sidebarEl.scrollHeight,
      clientHeight: sidebarEl.clientHeight
    });

    sidebarEl.scrollTop = targetScrollTop;
    updateMetrics();
    startDrag(e.pointerId, e.currentTarget, e.clientY, targetScrollTop);
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
        { path: '/device-templates', label: 'Device Templates', permKey: 'devicetemplates' },
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
    <div
      id="sidebar-scroll-container"
      ref={sidebarRef}
      className={`sidebar ${collapsed ? 'collapsed' : ''}`}
    >
      <div
        ref={trackRef}
        className={`sidebar-scrollbar ${scrollMetrics.scrollable ? 'is-scrollable' : 'is-inactive'} ${isDragging ? 'is-dragging' : ''}`}
        role="scrollbar"
        aria-controls="sidebar-scroll-container"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(scrollMetrics.scrollRatio * 100)}
        aria-label="Sidebar navigation scrollbar"
        aria-hidden={!scrollMetrics.scrollable}
        data-testid="sidebar-scrollbar-track"
        data-scrollable={scrollMetrics.scrollable ? 'true' : 'false'}
        onPointerDown={handleTrackPointerDown}
      >
        {scrollMetrics.scrollable && (
          <div
            className={`sidebar-scrollbar-thumb ${isDragging ? 'is-dragging' : ''}`}
            data-testid="sidebar-scrollbar-thumb"
            style={{
              height: `${scrollMetrics.thumbHeightPx}px`,
              top: `${scrollMetrics.thumbTopPx}px`
            }}
            onPointerDown={handleThumbPointerDown}
          />
        )}
      </div>
      <div ref={contentRef} className="sidebar-content">
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
    </div>
  );
};

export default Sidebar;