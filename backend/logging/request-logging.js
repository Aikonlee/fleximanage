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

const expressWinston = require('express-winston');
const os = require('os');
const configs = require('../configs')();
const { transports, format } = require('winston');
const { combine, timestamp, json } = format;

// ToDo: Add request/response body to the logs.
// This can be done after we map all sensitive data
// in our APIs and make sure it is removed from the log
// expressWinston.requestWhitelist.push('body');
// expressWinston.responseWhitelist.push('body');

// Use an explicit allowlist: request headers and structured query parameters can
// contain bearer tokens, cookies, reset links, or recovery material.
const requestWhitelist = ['url', 'method', 'httpVersion', 'ip', 'userId', 'id'];
const requestFilter = (req, key) => {
  if (key === 'headers' || key === 'query' || key === 'body') return undefined;
  const value = req[key];
  if ((key === 'url' || key === 'originalUrl') && typeof value === 'string') {
    return value.split('?', 1)[0];
  }
  return value;
};

// Env specific information
const hostname = os.hostname();

const createEnvEntry = () => {
  return {
    hostname: hostname
  };
};

/**
 * Creates a formated request log entry
 * that contains log headers and log data.
 * @param  {Object} info winston logger info object
 * @return {Object}      formatted log entry
 */
const createLogEntry = (info) => {
  const logEntry = {};
  const req = info.meta.req;
  // Global log fields
  logEntry.level = info.level;
  logEntry.module = 'app.js';
  logEntry.type = 'req';
  logEntry.env = createEnvEntry();
  logEntry.req = {
    reqId: req.id,
    user: req.userId || '',
    ip: req.ip,
    method: req.method,
    url: req.url
  };
  logEntry.job = {};
  logEntry.periodic = {};

  // Event message + data
  const safeMessage = `HTTP ${req.method} ${requestFilter(req, 'url') || ''} ` +
    `${info.meta?.res?.statusCode || ''}`;
  logEntry.event = {
    message: safeMessage.trim(),
    params: info.meta ? info.meta : {}
  };

  return logEntry;
};

const logFileFormat = combine(
  format(info => {
    info = createLogEntry(info);
    return info;
  })(),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  json());

const loggerOptions = {
  transports: [
    new transports.File({
      filename: configs.get('reqLogFilePath'),
      maxsize: '300000000', // Max file size is 300MB
      maxFiles: '5',
      tailable: true,
      format: logFileFormat
    })
  ],
  requestWhitelist,
  requestFilter,
  statusLevels: true
};

// Log full error details + stack only for 5xx status code
const errLoggerOptions = {
  ...loggerOptions,
  ...{
    skip: (req, res) => {
      return req.logSeverity < 500;
    }
  }
};

const reqLogger = expressWinston.logger(loggerOptions);
const errLogger = expressWinston.errorLogger(errLoggerOptions);

module.exports = {
  reqLogger: reqLogger,
  errLogger: errLogger
};
