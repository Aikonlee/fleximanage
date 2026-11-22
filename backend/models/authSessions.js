const mongoose = require('mongoose');
const mongoConns = require('../mongoConns')();

const sessionSchema = new mongoose.Schema({
  sid: { type: String, required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true },
  account: { type: mongoose.Schema.Types.ObjectId, ref: 'accounts', required: true },
  authVersion: { type: Number, required: true },
  refreshHash: { type: String, required: true, select: false },
  // One-shot grace for a just-rotated refresh. select:false keeps the hash off
  // default query projections; the rotation path reads it only in the filter.
  graceHash: { type: String, select: false },
  graceUntil: { type: Date },
  graceRotationCount: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null }
});

sessionSchema.index({ sid: 1 }, { unique: true });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
sessionSchema.index({ user: 1, revokedAt: 1 });

module.exports = mongoConns.getMainDB().model('authsessions', sessionSchema);
