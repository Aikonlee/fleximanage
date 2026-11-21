import React, { useState, useEffect } from 'react';
import { Card } from 'react-bootstrap';
import api from '../services/api';
import PageHeader from '../components/common/PageHeader';
import './About.css';

const formatDeadline = (isoDate) => {
  if (!isoDate) return '-';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: true
  });
};

const About = () => {
  const [managementVersion, setManagementVersion] = useState(null);
  const [latestDeviceVersion, setLatestDeviceVersion] = useState(null);
  const [upgradeDeadline, setUpgradeDeadline] = useState(null);

  useEffect(() => {
    fetchVersionInfo();
  }, []);

  const fetchVersionInfo = async () => {
    try {
      const response = await api.get('/version');
      if (response.data) {
        setManagementVersion(response.data.version || null);
        setLatestDeviceVersion(response.data.device || null);
        setUpgradeDeadline(response.data.upgradeDeadline || null);
      }
    } catch (error) {
      console.error('Error fetching version info:', error);
    }
  };

  return (
    <div className="about-page">
      <PageHeader breadcrumb={[{ label: 'Home', path: '/home' }, { label: 'About' }]} title="About" />
      <div className="page-header">
        <h2>Open SD-WAN Management Platform</h2>
      </div>

      <Card className="about-card">
        <Card.Body>
          <div className="about-logo">
            <h1 className="brand-name">OpenSource-OpenNetworking</h1>
          </div>

          <div className="about-info">
            <div className="info-item">
              <span className="info-label">Management version:</span>
              <span className="info-value">{managementVersion || '-'}</span>
            </div>

            <div className="info-item">
              <span className="info-label">Latest device version:</span>
              <span className="info-value">{latestDeviceVersion || '-'}</span>
            </div>

            <div className="info-item">
              <span className="info-label">Automatic upgrade deadline:</span>
              <span className="info-value">{formatDeadline(upgradeDeadline)}</span>
            </div>
          </div>

          <div className="about-description">
            <p>
              flexiWAN changes the closeness and vendor lock paradigm of SD-WAN by offering 
              an open source SD-WAN infrastructure that includes the vRouter, management, 
              orchestration and automation as well as core SD-WAN baseline functionality.
            </p>
          </div>
        </Card.Body>
      </Card>
    </div>
  );
};

export default About;