// Match the backend contract: an omitted side means Any; an empty filter does not.
export function normalizeFirewallRule(form) {
  const source = form.classification?.source || {};
  const original = form.classification?.destination || {};
  const destinationType = form.destinationType || (original.trafficId ? 'trafficId' : (original.trafficTags?.category || original.trafficTags?.serviceClass || original.trafficTags?.importance) ? 'trafficTags' : 'custom');
  let destination;
  if (destinationType === 'trafficId') {
    if (!original.trafficId) throw new Error('Select a traffic identification.');
    destination = { trafficId: original.trafficId };
  } else if (destinationType === 'trafficTags') {
    const tags = Object.fromEntries(Object.entries(original.trafficTags || {}).filter(([, value]) => value));
    if (!Object.keys(tags).length) throw new Error('Specify a category, service class or importance.');
    destination = { trafficTags: tags };
  } else {
    const { ip = '', ports = '', protocols = [], ...extra } = original.ipProtoPort || {};
    if (ip.trim() || ports.trim() || protocols.length || Object.keys(extra).length) {
      destination = { ipProtoPort: { ...extra, ip: ip.trim(), ports: ports.trim(), protocols: protocols.length ? protocols : ports.trim() ? ['tcp', 'udp'] : ['tcp', 'udp', 'icmp'] } };
    }
  }
  const { ipPort, ...otherSource } = source;
  if (ipPort?.ip?.trim() || ipPort?.ports?.trim()) otherSource.ipPort = { ...ipPort, ip: (ipPort.ip || '').trim(), ports: (ipPort.ports || '').trim() };
  const result = { ...form, classification: {
    ...(Object.keys(otherSource).length ? { source: otherSource } : {}),
    ...(destination ? { destination } : {})
  } };
  delete result.destinationType;
  return result;
}
