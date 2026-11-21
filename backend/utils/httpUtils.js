// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2019  flexiWAN Ltd.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

const configs = require('../configs')();
const url = require('url');
const logger = require('../logging/logging')({ module: module.filename, type: 'httpUtils' });

const getUiServerUrl = req => {
  let uiServerUrl = null;
  const uiServers = configs.get('uiServerUrl', 'list');
  let refererHeader = req.get('Referer');
  if (refererHeader) {
    refererHeader = refererHeader.slice(0, -1); // no need the slash at end
    const found = uiServers.find(s => s === refererHeader);
    if (found) {
      uiServerUrl = refererHeader;
    } else {
      uiServerUrl = uiServers[0];
    }
  } else {
    uiServerUrl = uiServers[0];
  }
  return uiServerUrl;
};

const getAgentBroker = tokenServer => {
  const brokerServers = configs.get('agentBroker', 'list');
  let broker = brokerServers[0];  // Use raw server string first
  
  logger.info('Getting agent broker server', {
    params: {
      tokenServer: tokenServer,
      brokerServers: brokerServers,
      initialBroker: broker
    }
  });

  if (tokenServer) {
    try {
      // Try to find broker with the same domain as the token
      const urlSchema = new url.URL(tokenServer);
      const tokenDomain = urlSchema.hostname.replace(/^[^.]+\./g, '');
      
      for (const s of brokerServers) {
        const sUrlSchema = new url.URL('https://' + s);
        const sDomain = sUrlSchema.hostname.replace(/^[^.]+\./g, '');
        if (sDomain === tokenDomain) {
          broker = s;
          break;
        }
      }
    } catch (err) {
      logger.error('Error processing token server URL', {
        params: { error: err.message, tokenServer }
      });
    }
  }

  logger.info('Selected agent broker server', {
    params: { finalBroker: broker }
  });

  return broker;
};

const getRedisAuthUrl = redisUrl => {
  let redisAuth = null;
  let redisUrlNoAuth = redisUrl;

  if (redisUrl.includes('@')) {
    const urlParts = redisUrl.split('@');
    redisAuth = urlParts[0].split('//')[1];
    redisUrlNoAuth = urlParts[1];
    if (!redisUrlNoAuth.startsWith('redis://')) {
      redisUrlNoAuth = 'redis://' + redisUrlNoAuth;
    }
  }

  return { redisAuth, redisUrlNoAuth };
};

module.exports = {
  getUiServerUrl,
  getAgentBroker,
  getRedisAuthUrl
};
