// API configuration is shared by the Axios client and deployment overrides.
const config = {
  apiUrl: import.meta.env.REACT_APP_API_URL || import.meta.env.VITE_API_URL || '/api',
  requestTimeout: 30000,
  tokenKey: 'token'
};
export default config;
