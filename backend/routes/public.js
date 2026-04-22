const express = require('express');
const router = express.Router();
const configs = require('../configs')();
const cors = require('./cors');
const https = require('https');
const http = require('http');

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

/**
 * Proxy endpoint for OpenStreetMap tiles
 * @openapi
 * /public/tiles/{z}/{x}/{y}:
 *   get:
 *     summary: Get map tile with proper headers
 *     tags:
 *       - Public
 *     parameters:
 *       - in: path
 *         name: z
 *         schema:
 *           type: integer
 *       - in: path
 *         name: x
 *         schema:
 *           type: integer
 *       - in: path
 *         name: y
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Map tile image
 *         content:
 *           image/png: {}
 *       404:
 *         description: Tile not found
 */
router.route('/tiles/:z/:x/:y')
  .get(cors.corsWithOptions, (req, res) => {
    const { z, x, y } = req.params;
    
    // Validate parameters
    if (!z || !x || !y || isNaN(z) || isNaN(x) || isNaN(y)) {
      return res.status(400).json({ error: 'Invalid tile coordinates' });
    }

    // Construct OSM tile URL
    const osmUrl = `https://a.tile.openstreetmap.org/${z}/${x}/${y}.png`;
    
    // Fetch tile with proper headers
    https.get(osmUrl, {
      headers: {
        'Referer': 'https://manage.miwide.com',
        'User-Agent': 'FlexiManage/1.0 (https://manage.miwide.com)'
      }
    }, (osmRes) => {
      // Only cache successful responses
      if (osmRes.statusCode === 200) {
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=2592000'); // 30 days
        osmRes.pipe(res);
      } else {
        res.status(osmRes.statusCode).send(`Error fetching tile: ${osmRes.statusCode}`);
      }
    }).on('error', (error) => {
      console.error('Error fetching OSM tile:', error);
      res.status(500).json({ error: 'Failed to fetch tile' });
    });
  });

module.exports = router;
