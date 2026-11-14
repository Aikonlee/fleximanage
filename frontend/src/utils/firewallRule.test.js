import { normalizeFirewallRule } from './firewallRule';
const rule = () => ({ direction: 'outbound', enabled: true, destinationType: 'custom', classification: { source: { ipPort: { ip: '', ports: '' } }, destination: { ipProtoPort: { ip: '', ports: '', protocols: [] } } } });
test('Any source and destination omit empty filters rejected by the backend', () => {
  expect(normalizeFirewallRule(rule()).classification).toEqual({});
});
test('Any protocol with an explicit destination expands the supported protocol set', () => {
  const form = rule(); form.classification.destination.ipProtoPort.ip = '203.0.113.0/24';
  const result = normalizeFirewallRule(form);
  expect(result.classification).not.toHaveProperty('source');
  expect(result.classification.destination.ipProtoPort.protocols).toEqual(['tcp', 'udp', 'icmp']);
});
test('explicit protocol and ports preserved, empty classification selections rejected', () => {
  const form = rule(); form.classification.source.ipPort.ports = '443';
  form.classification.destination.ipProtoPort.protocols = ['tcp'];
  expect(normalizeFirewallRule(form).classification.source.ipPort.ports).toBe('443');
  expect(normalizeFirewallRule(form).classification.destination.ipProtoPort.protocols).toEqual(['tcp']);
  expect(() => normalizeFirewallRule({ ...form, destinationType: 'trafficId' })).toThrow('Select');
});
