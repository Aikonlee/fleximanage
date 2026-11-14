import React from 'react';
import './Footer.css';

const Footer = () => {
  return (
    <footer className="app-footer">
      <div className="footer-divider"></div>
      <div className="footer-content">
        <span className="footer-copyright">
          © OpenSource-OpenNetworking.org 2025.10, All Rights Reserved
        </span>
        <a 
          href="https://docs.flexiwan.com/" 
          target="_blank" 
          rel="noopener noreferrer"
          className="footer-link"
        >
          Documentation
        </a>
      </div>
    </footer>
  );
};

export default Footer;
