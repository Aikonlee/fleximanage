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

/**
 * This module allows to send email from the webserver.
 * Two providers are supported, selected via the mailerProvider config:
 *  - 'smtp'  (default): direct SMTP via nodemailer
 *  - 'wecom': WeCom (企业微信) Exmail HTTP API
 *             https://developer.work.weixin.qq.com/document/path/97445
 */
const nodemailer = require('nodemailer');
const fetch = require('fetch-with-proxy').default;
const configs = require('../configs')();
const logger = require('../logging/logging')({ module: module.filename, type: 'req' });

const WECOM_API_BASE = 'https://qyapi.weixin.qq.com/cgi-bin';

class Mailer {
  /**
     * Initialize mailer class
     * @param {string} host               smtp hostname (used when mailerProvider = 'smtp')
     * @param {number} port               smtp port
     * @param {boolean} bypassCertificate true = bypass, false = don't bypass (default: false)
     *                                    Sometimes need to disable certificate validation for
     *                                    some anti-virus with MITM
     */
  constructor (host, port, bypassCertificate = false) {
    this.sendMailHTML = this.sendMailHTML.bind(this);
    this.provider = configs.get('mailerProvider') === 'wecom' ? 'wecom' : 'smtp';

    if (this.provider === 'smtp') {
      const service = configs.get('mailerService');
      const user = configs.get('mailerUser');
      const pass = configs.get('mailerPassword');
      const transportOptions = { logger: logger, debug: true };
      // A well-known service (e.g. 'gmail') supplies its own host/port/secure
      // settings, so mailerHost/mailerPort are only used without one.
      if (service) {
        transportOptions.service = service;
      } else {
        transportOptions.host = host;
        transportOptions.port = port;
      }
      if (user && pass) transportOptions.auth = { user, pass };
      if (bypassCertificate) transportOptions.tls = { rejectUnauthorized: false };
      this.smtpTransport = nodemailer.createTransport(transportOptions);
    } else {
      // access_token is cached in-memory and refreshed once it's about to expire
      this.wecomAccessToken = null;
      this.wecomAccessTokenExpiresAt = 0;
    }
  }

  /**
     * Returns a valid WeCom access_token, fetching a new one if the cached
     * token is missing or about to expire.
     * @return {Promise<string>}
     */
  async getWecomAccessToken () {
    const now = Date.now();
    // Refresh 60s before actual expiry to avoid races
    if (this.wecomAccessToken && now < this.wecomAccessTokenExpiresAt - 60000) {
      return this.wecomAccessToken;
    }

    const corpId = configs.get('wecomCorpId');
    const corpSecret = configs.get('wecomCorpSecret');
    const url = `${WECOM_API_BASE}/gettoken?corpid=${encodeURIComponent(corpId)}` +
      `&corpsecret=${encodeURIComponent(corpSecret)}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.errcode) {
      throw new Error(`WeCom gettoken failed: ${data.errcode} ${data.errmsg}`);
    }
    this.wecomAccessToken = data.access_token;
    // expires_in is in seconds
    this.wecomAccessTokenExpiresAt = now + (data.expires_in * 1000);
    return this.wecomAccessToken;
  }

  /**
     * Sends an email via the WeCom (企业微信) Exmail HTTP API.
     * @param  {string}  to       comma separated recipient email address(es)
     * @param  {string}  subject  subject of email
     * @param  {string}  html     HTML body
     * @return {Promise}
     */
  async sendMailWecom (to, subject, html) {
    const accessToken = await this.getWecomAccessToken();
    const url = `${WECOM_API_BASE}/exmail/app/compose_send` +
      `?access_token=${encodeURIComponent(accessToken)}`;
    const body = {
      agentid: configs.get('wecomAgentId', 'number'),
      to: { emails: to.split(',').map(addr => addr.trim()).filter(Boolean) },
      subject: subject,
      content: html,
      content_type: 'html'
    };
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (data.errcode) {
      throw new Error(`WeCom compose_send failed: ${data.errcode} ${data.errmsg}`);
    }
  }

  /**
     * Sends email with html body.
     * @param  {string}  envelopeFrom    Envelope from user
     * @param  {string}  from            From user
     * @param  {string}  to              To users
     * @param  {string}  subject         Subject of email
     * @param  {string}  html            HTML to embed in the mail
     * @return {Promise}
     */
  sendMailHTML (envelopeFrom, from, to, subject, html) {
    const fullHtml = html + `<p style='color:#bbbbbb;'>You are receiving this email because
      you are registered on flexiWAN.
      If you wish to delete your account on flexiWAN,
      please open a support ticket by sending an email to
      <a href="mailto:yourfriends@flexiwan.com">yourfriends@flexiwan.com</a> and put in
      the subject "Request to delete my account".
      The request must be sent from the email of the account owner
      that opened the account on flexiWAN..</p>`;

    if (this.provider === 'wecom') {
      return this.sendMailWecom(to, subject, fullHtml)
        .catch((error) => {
          logger.error('Send mail error', {
            params: { provider: 'wecom', to: to, subject: subject, error: error.message }
          });
          throw error;
        });
    }

    const mailOptions = {
      // Envelop is needed for adding the sender in the mail envelop
      // This fix the SPF failure as the sender is from flexiwan.com
      // DKIM is also signed per from domain as part of the SMTP server
      // This will send the mail as to <dest> from <from> via <noreply@flexiwan.com>
      // To remove the via, we need to add SPF record to the customer email and
      // use the <from> address in the envelop
      envelope: {
        from: envelopeFrom,
        to: to
      },
      from: from,
      to: to,
      subject: subject,
      generateTextFromHTML: true,
      html: fullHtml
    };

    const p = new Promise((resolve, reject) => {
      this.smtpTransport.sendMail(mailOptions, (error, response) => {
        let success = true;
        if (error) {
          logger.error('Send mail error', { params: { mailOptions: mailOptions, error: error } });
          success = false;
        }
        this.smtpTransport.close();
        if (success) resolve();
        else reject(error);
      });
    });
    return p;
  }
}

let mailerHandler = null;
module.exports = function (host, port, bypassCertificate) {
  if (mailerHandler) return mailerHandler;
  else {
    mailerHandler = new Mailer(host, port, bypassCertificate);
    return mailerHandler;
  }
};
