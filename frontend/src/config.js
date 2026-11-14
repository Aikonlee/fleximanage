// Frontend configuration
const config = {
  // Backend API endpoint
  apiUrl: process.env.REACT_APP_API_URL || '/api',
  
  // WebSocket endpoint for real-time updates
  wsUrl: process.env.REACT_APP_WS_URL || 'wss://localhost:3443',
  
  // Application name
  appName: 'FlexiManage',
  
  // Company domain
  domain: 'miwide.com',
  
  // Support email
  supportEmail: 'support@miwide.com',
  
  // API request timeout (in milliseconds)
  requestTimeout: 30000,
  
  // Session refresh interval (in milliseconds)
  sessionRefreshInterval: 240000,
  
  // File size limits
  maxFileSize: 50 * 1024 * 1024, // 50MB
  
  // Date format for displaying
  dateFormat: 'YYYY-MM-DD HH:mm:ss',
  
  // Default pagination settings
  defaultPageSize: 10,
  
  // Token storage key
  tokenKey: 'token',
  
  // Enable debug mode in development
  debug: process.env.NODE_ENV === 'development'
};

export default config;