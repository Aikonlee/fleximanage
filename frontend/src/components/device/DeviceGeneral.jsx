import React from 'react';
import DeviceLocation from './DeviceLocation';
import { FaCheck } from 'react-icons/fa';

export default function DeviceGeneral({ activeTab, description, device, deviceName, isApproved, setDescription, setDeviceName, setIsApproved }) {
  return <>
{activeTab === 'general' && (
          <div>
            <div className="grid-row"><label className="grid-label">Device Name</label><div className="grid-content"><input type="text" className="input-template input-valid" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} /><FaCheck className="valid-icon" /></div></div>
            <div className="grid-row"><label className="grid-label">Description</label><div className="grid-content"><input type="text" className="input-template input-valid" value={description} onChange={(e) => setDescription(e.target.value)} /><FaCheck className="valid-icon" /></div></div>
            <div className="grid-row">
              <label className="grid-label">Approved</label>
              <div className="grid-content">
                <div className="toggle-wrapper">
                  <input
                    type="checkbox"
                    id="approved-toggle"
                    className="toggle-checkbox"
                    checked={isApproved}
                    onChange={(e) => setIsApproved(e.target.checked)}
                  />
                  <label
                    htmlFor="approved-toggle"
                    className={`toggle-label ${isApproved ? 'checked' : ''}`}
                  ></label>
                </div>
              </div>
            </div>
            <div className="grid-row"><label className="grid-label">Host Name</label><div className="grid-content"><input type="text" className="input-template input-readonly" value={device.hostname || ''} readOnly /></div></div>
            <div className="grid-row"><label className="grid-label">S/N</label><div className="grid-content"><input type="text" className="input-template input-readonly" value={device.serial || 'N/A'} readOnly /></div></div>
            <div className="grid-row"><label className="grid-label">Machine ID</label><div className="grid-content"><input type="text" className="input-template input-readonly" value={device.machineId || ''} readOnly /></div></div>
            <div className="grid-row"><label className="grid-label">Device Version</label><div className="grid-content"><input type="text" className="input-template input-readonly" value={device.versions?.agent || device.versions?.device || ''} readOnly /></div></div>
            <div className="grid-row" style={{marginTop: '2rem'}}><div className="col-span-12" style={{gridColumn: 'span 12'}}><DeviceLocation device={device} /></div></div>
          </div>
        )}
  </>;
}
