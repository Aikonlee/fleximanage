import React, { useState, useEffect } from 'react';
import { Card } from 'react-bootstrap';
import api from '../services/api';
import './About.css';

const About = () => {
  const [managementVersion, setManagementVersion] = useState('6.3.37');
  const [latestDeviceVersion, setLatestDeviceVersion] = useState('6.4.32');
  const [upgradeDeadline, setUpgradeDeadline] = useState('Dec 02, 2024, 08:00 AM');

  useEffect(() => {
    fetchVersionInfo();
  }, []);

  const fetchVersionInfo = async () => {
    try {
      // Try to fetch version from backend API
      const response = await api.get('/version');
      if (response.data) {
        if (response.data.management) {
          setManagementVersion(response.data.management);
        }
        if (response.data.device) {
          setLatestDeviceVersion(response.data.device);
        }
        if (response.data.upgradeDeadline) {
          setUpgradeDeadline(response.data.upgradeDeadline);
        }
      }
    } catch (error) {
      console.error('Error fetching version info:', error);
      // Use default values if API fails
    }
  };

  return (
    <div className="about-page">
      <div className="page-header">
        <h2>About flexiWAN</h2>
      </div>

      <Card className="about-card">
        <Card.Body>
          <div className="about-logo">
            <h1 className="brand-name">flexiWAN</h1>
          </div>

          <div className="about-info">
            <div className="info-item">
              <span className="info-label">Management version:</span>
              <span className="info-value">{managementVersion}</span>
            </div>

            <div className="info-item">
              <span className="info-label">Latest device version:</span>
              <span className="info-value">{latestDeviceVersion}</span>
            </div>

            <div className="info-item">
              <span className="info-label">Automatic upgrade deadline:</span>
              <span className="info-value">{upgradeDeadline}</span>
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
