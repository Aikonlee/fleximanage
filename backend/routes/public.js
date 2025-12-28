const express = require('express');
const router = express.Router();
const configs = require('../configs')();
const cors = require('./cors');

/**
 * @openapi
 * /public/config:
 *   get:
 *     summary: Get public server configuration
 *     tags:
 *       - Public
 *     responses:
 *       200:
 *         description: Public configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 captchaSiteKey:
 *                   type: string
 *                 captchaEnforced:
 *                   type: boolean
 */
router.route('/config')
  .options(cors.corsWithOptions, (req, res) => { res.sendStatus(200); })
  .get(cors.corsWithOptions, (req, res) => {
    const clientConfig = configs.getClientConfig(req);
    res.json({
      captchaSiteKey: clientConfig.captchaSiteKey,
      captchaEnforced: clientConfig.captchaEnforced
    });
  });

module.exports = router;
