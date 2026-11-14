// Compatibility boundary for the maintained CIDR library's named ESM API.
const { overlapCidr, normalizeCidr } = require('cidr-tools');
module.exports = {
  overlap: overlapCidr,
  networkStart: value => normalizeCidr(value).split('/')[0]
};
