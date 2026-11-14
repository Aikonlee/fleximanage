import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { inferBaseURL } from '../../services/api';

export default function DeviceLocation({ device }) {
  const container = useRef(null);
  useEffect(() => {
    if (!device || !container.current) return undefined;
    const coords = Array.isArray(device.coords) && device.coords.length === 2
      ? device.coords : [device.location?.lat ?? 40.416775, device.location?.lon ?? -3.70379];
    const map = L.map(container.current).setView(coords, 13);
    L.tileLayer(`${inferBaseURL()}/public/tiles/{z}/{x}/{y}`, {
      attribution: '&copy; OpenStreetMap contributors', maxZoom: 19, crossOrigin: 'anonymous'
    }).addTo(map);
    // Use a DOM node so device names are treated as text rather than popup HTML.
    const label = document.createElement('span'); label.textContent = device.name || 'Device';
    const icon = L.divIcon({ className: 'custom-map-marker',
      html: '<div style="background:#f7941d;width:14px;height:14px;border-radius:50%;border:2px solid white"></div>',
      iconSize: [14, 14], popupAnchor: [0, -7] });
    L.marker(coords, { icon }).addTo(map).bindPopup(label).openPopup();
    return () => map.remove();
  }, [device]);
  return <div id="device-map" ref={container} className="map-container-template" />;
}
