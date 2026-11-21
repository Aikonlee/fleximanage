/** @jest-environment node */
const { execFileSync } = require('child_process');
const path = require('path');
test('CIDR compatibility preserves IPv4/IPv6 overlap decisions under the deployed Node loader', () => {
  const cases = [
    ['192.0.2.0/24', '192.0.2.128/25'],
    ['192.0.2.0/24', '198.51.100.0/24'],
    ['10.0.0.1/32', '10.0.0.0/24'],
    ['2001:db8::/32', '2001:db8:1::/48'],
    ['2001:db8::/32', '2001:db9::/32'],
    ['192.0.2.0/24', '2001:db8::/32']
  ];
  const modulePath = path.resolve(__dirname, '../cidr.js');
  const script = `const { overlap } = require(${JSON.stringify(modulePath)});` +
    `console.log(JSON.stringify(${JSON.stringify(cases)}.map(([a,b]) => overlap(a,b))));`;
  expect(JSON.parse(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' })))
    .toEqual([true, false, true, true, false, false]);
});
