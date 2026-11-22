/**
 * This module sends info to web hooks
 */
const dns = require('dns');
const net = require('net');
const fetch = require('fetch-with-proxy').default;
const logger = require('../logging/logging')({
  module: module.filename,
  type: 'req'
});

const blockedWebhookTargets = new net.BlockList();
blockedWebhookTargets.addSubnet('127.0.0.0', 8, 'ipv4');
blockedWebhookTargets.addSubnet('10.0.0.0', 8, 'ipv4');
blockedWebhookTargets.addSubnet('172.16.0.0', 12, 'ipv4');
blockedWebhookTargets.addSubnet('192.168.0.0', 16, 'ipv4');
blockedWebhookTargets.addSubnet('169.254.0.0', 16, 'ipv4');
blockedWebhookTargets.addAddress('::1', 'ipv6');
blockedWebhookTargets.addSubnet('fe80::', 10, 'ipv6');

const WEBHOOK_TARGET_ERROR =
  'Webhook URL must not target a loopback, link-local, or private network address';

/**
 * Host or address portion of a webhook URL, hostname, or IP literal.
 * @param {string} value URL or hostname
 * @return {string} normalized host, or an empty string when it cannot be read
 */
function webhookHost (value) {
  if (value === null || value === undefined) return '';
  let host = String(value).trim().toLowerCase();
  if (!host) return '';
  if (host.includes('://')) {
    try {
      host = new URL(host).hostname;
    } catch (err) {
      return '';
    }
  }
  if (host.startsWith('[') && host.includes(']')) {
    host = host.slice(1, host.indexOf(']'));
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(host)) {
    host = host.slice(0, host.lastIndexOf(':'));
  }
  const zone = host.indexOf('%');
  if (zone !== -1) host = host.slice(0, zone);
  while (host.endsWith('.')) host = host.slice(0, -1);
  return host;
}

/**
 * True when the webhook URL or hostname is a blocked destination.
 * Literal addresses are rejected here. Names are resolved in sendToWebHook.
 * @param {string} urlOrHostname webhook URL, hostname, or IP
 * @return {boolean} true when the destination must be rejected
 */
function isBlockedWebhookTarget (urlOrHostname) {
  const host = webhookHost(urlOrHostname);
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  const family = net.isIP(host);
  if (family === 0) return false;
  try {
    return blockedWebhookTargets.check(host, family === 4 ? 'ipv4' : 'ipv6');
  } catch (err) {
    return false;
  }
}

function forbiddenWebhookError (detail) {
  const error = new Error(detail ? `${WEBHOOK_TARGET_ERROR}: ${detail}` : WEBHOOK_TARGET_ERROR);
  error.code = 'WEBHOOK_TARGET_FORBIDDEN';
  return error;
}

/**
 * Reject loopback, link-local (including cloud metadata), and RFC1918 targets
 * before any outbound request. Hostnames are resolved with dns.promises.lookup.
 * @param {string} url destination passed to sendToWebHook
 * @return {Promise<void>}
 */
async function assertWebhookTargetAllowed (url) {
  if (isBlockedWebhookTarget(url)) {
    throw forbiddenWebhookError(webhookHost(url) || url);
  }

  let host;
  try {
    host = webhookHost(new URL(url).href);
  } catch (err) {
    const error = new Error('Invalid webhook URL');
    error.code = 'WEBHOOK_TARGET_FORBIDDEN';
    throw error;
  }
  if (!host || net.isIP(host)) return;

  let records;
  try {
    records = await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch (err) {
    const error = new Error(`Webhook target "${host}" could not be resolved`);
    error.code = 'WEBHOOK_TARGET_UNRESOLVED';
    throw error;
  }

  const list = Array.isArray(records) ? records : [records];
  for (const record of list) {
    const address = typeof record === 'string' ? record : record && record.address;
    if (address && isBlockedWebhookTarget(address)) {
      throw forbiddenWebhookError(`${host} resolves to ${address}`);
    }
  }
}

class WebHooks {
  constructor () {
    this.sendToWebHook = this.sendToWebHook.bind(this);
  }

  /**
     * Sends a POST request to web hooks.
     * @async
     * @param  {string}         url     url to send the message to
     * @param  {Object}         message JSON object to send in body
     * @param  {string}         secret  secret key to send in the message (secret field)
     * @param  {string}         msgTitle A string describing the type of the message,
     * such as notification, user invitation, etc.
     * @return {boolean|Object}         false if send failed, response object otherwise
     */
  async sendToWebHook (url, message, secret = null, msgTitle = null) {
    // For an empty url (development), return true
    if (url === '') return Promise.resolve(true);
    try {
      await assertWebhookTargetAllowed(url);
    } catch (error) {
      logger.error('Rejected webhook target', {
        params: { url, error: error.message }
      });
      throw error;
    }
    let messageObject;

    // Check if the URL belongs to Slack or MS Teams
    if (url.includes('hooks.slack.com')) {
      // Format the message for Slack
      let formattedMsgForSlack = Object.keys(message).map(
        key => `${key}: ${message[key]}`).join('\n');
      if (msgTitle) {
        formattedMsgForSlack = `*${msgTitle}*\n` + formattedMsgForSlack;
      }
      messageObject = { text: formattedMsgForSlack };
    // TODO identify MS teams in a more specific way since this check is not specific enough
    } else if (url.includes('.office.com')) {
      // Format the message for MS teams
      let formattedMsgForTeams = Object.keys(message).map(
        key => `${key}: ${message[key]}`).join('<br>');
      if (msgTitle) {
        formattedMsgForTeams = `**${msgTitle}**<br>${formattedMsgForTeams}`;
      }
      messageObject = {
        '@type': 'MessageCard',
        '@context': 'http://schema.org/extensions',
        summary: msgTitle || 'FlexiWAN message',
        sections: [{ text: formattedMsgForTeams }]
      };
    } else {
      if (msgTitle) {
        message = { subject: msgTitle, ...message };
      }
      messageObject = message;
    }

    messageObject = { ...messageObject, ...(secret && { secret }) };
    const data = JSON.stringify(messageObject);

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': data.length,
      'User-Agent': 'flexiWAN webhook plugin'
    };

    return fetch(url, {
      method: 'POST',
      headers,
      body: data
    })
      .then(response => {
        return response.json()
          .then(json => {
            response.message = json;
            return response;
          },
          error => {
            throw error;
          });
      },
      error => {
        throw error;
      })
      .then(response => {
        if (response.ok) {
          // Success handling
          if (response.message === 1 || response.message.status === 'success') return true;
          return false;
        } else return false;
      })
      .catch((error) => {
        logger.error('Failed to send webhook', { params: { url, error } });
        // General error handling
        return false;
      });
  }
}

let webHooksHandler = null;
function webHooks (secretKey) {
  if (webHooksHandler) return webHooksHandler;
  webHooksHandler = new WebHooks();
  return webHooksHandler;
}
webHooks.isBlockedWebhookTarget = isBlockedWebhookTarget;
module.exports = webHooks;
