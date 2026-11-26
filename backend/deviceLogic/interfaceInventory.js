/* eslint-disable max-len */
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

const mongoose = require('mongoose');
const validators = require('../models/validators');
const { mapLteNames } = require('../utils/deviceUtils');

// Raw agent report / detection helper keys that are mapped onto schema-backed fields
// and should not be persisted verbatim on normalized new interface objects.
const RAW_REPORT_ONLY_KEYS = [
  'link',
  'public_ip',
  'public_port',
  'nat_type',
  'vpp_managed',
  'vpp_supported',
  'vppSupported',
  'linuxManaged',
  'linux_managed',
  'hostManaged',
  'host_managed',
  'isManagement',
  'is_management',
  'managedBy',
  'managed_by'
];

// Linux wireless interface name prefixes (legacy wlan* and systemd predictable wl*)
const LINUX_WIFI_NAME_RE = /^(wlan|wlp|wls|wlx|wlo)\d*/i;

// Common Linux kernel wireless drivers that are host-managed and not VPP/DPDK-bindable
const LINUX_WIFI_DRIVER_RE = /^(iwlwifi|brcmfmac|brcmsmac|rtw88|rtw89|rtl8|ath9k|ath10k|ath11k|ath12k|mt76|mt79|mwifiex|rt2800|carl9170|r8188eu|mac80211_hwsim|wl$|b43$)/i;

const HOST_MANAGED_OWNERS = new Set([
  'linux',
  'host',
  'os',
  'system',
  'networkmanager',
  'systemd-networkd',
  'wpa_supplicant',
  'management'
]);

const LINUX_WIFI_DEVICE_TYPES = new Set([
  'linux-wifi',
  'host-wifi',
  'mgmt-wifi',
  'management-wifi',
  'wifi-mgmt'
]);

const WIFI_STATION_MODES = new Set([
  'station',
  'client',
  'sta',
  'managed'
]);

// Schema-typed scalar fields that Mongoose casts to String or Number on save.
// Casting these consistently avoids spurious diffs between raw reports and persisted docs.
const SCHEMA_STRING_SCALAR_FIELDS = [
  'PublicPort',
  'metric',
  'IPv4Mask',
  'IPv6Mask',
  'vlanTag'
];

/**
 * Checks whether a devId is a non-empty valid device bus/VLAN identifier.
 * Note: validators.validateDevId('') returns true in models/validators.js,
 * so we explicitly reject empty/whitespace-only strings here.
 *
 * @param {*} devId
 * @returns {boolean}
 */
const isValidDevId = (devId) => {
  if (typeof devId !== 'string') return false;
  const trimmed = devId.trim();
  return trimmed.length > 0 && validators.validateDevId(trimmed);
};

/**
 * Checks whether a devId is explicitly provided but invalid (non-empty and fails validation).
 *
 * @param {*} devId
 * @returns {boolean}
 */
const isMalformedDevId = (devId) => {
  if (devId === undefined || devId === null) return false;
  if (typeof devId !== 'string') return true;
  const trimmed = devId.trim();
  return trimmed.length > 0 && !validators.validateDevId(trimmed);
};

/**
 * Normalizes a MAC address to lowercase trimmed form if valid, else ''.
 *
 * @param {*} mac
 * @returns {string}
 */
const normalizeMac = (mac) => {
  if (typeof mac !== 'string') return '';
  const trimmed = mac.trim();
  if (!trimmed || !validators.validateMacAddress(trimmed)) return '';
  return trimmed.toLowerCase();
};

/**
 * Normalizes a schema String scalar (e.g. metric, PublicPort) consistently.
 *
 * @param {*} val
 * @returns {string}
 */
const normalizeScalarString = (val) => {
  if (val === undefined || val === null) return '';
  return String(val).trim();
};

/**
 * Extracts VLAN tag from a VLAN devId ("vlan.<tag>.<parent>") or explicit vlanTag field.
 *
 * @param {Object} ifc
 * @returns {string}
 */
const getVlanKey = (ifc) => {
  if (!ifc || typeof ifc !== 'object') return '';
  if (typeof ifc.devId === 'string') {
    const parts = ifc.devId.trim().split('.');
    if (parts.length > 2 && parts[0].toLowerCase() === 'vlan' && parts[1]) {
      return parts[1];
    }
  }
  if (ifc.vlanTag !== undefined && ifc.vlanTag !== null && String(ifc.vlanTag).trim() !== '') {
    return String(ifc.vlanTag).trim();
  }
  return '';
};

const getVlanParentDevId = (ifc) => {
  if (!ifc || typeof ifc !== 'object') return '';
  if (typeof ifc.devId === 'string') {
    const parts = ifc.devId.trim().split('.');
    if (parts.length > 2 && parts[0].toLowerCase() === 'vlan' && parts[1]) {
      return parts.slice(2).join('.').trim().toLowerCase();
    }
  }
  if (typeof ifc.parentDevId === 'string' && ifc.parentDevId.trim() !== '') {
    return ifc.parentDevId.trim().toLowerCase();
  }
  return '';
};

const isVlanInterface = (ifc) => {
  if (!ifc || typeof ifc !== 'object') return false;
  return (typeof ifc.devId === 'string' && ifc.devId.trim().toLowerCase().startsWith('vlan')) ||
    Boolean(ifc.parentDevId);
};

/**
 * Checks whether an interface report carries explicit evidence that it is
 * Linux host-managed / not VPP-managed (as opposed to name/driver heuristics).
 *
 * @param {Object} ifc
 * @param {string} [effectiveDeviceType='']
 * @returns {boolean}
 */
const hasExplicitHostManagementEvidence = (ifc, effectiveDeviceType = '') => {
  if (!ifc || typeof ifc !== 'object') return false;

  if (
    ifc.vppManaged === false ||
    ifc.vpp_managed === false ||
    ifc.vppSupported === false ||
    ifc.vpp_supported === false ||
    ifc.assignable === false ||
    ifc.linuxManaged === true ||
    ifc.linux_managed === true ||
    ifc.hostManaged === true ||
    ifc.host_managed === true ||
    ifc.isManagement === true ||
    ifc.is_management === true
  ) {
    return true;
  }

  const managedBy = typeof ifc.managedBy === 'string'
    ? ifc.managedBy.trim().toLowerCase()
    : typeof ifc.managed_by === 'string'
      ? ifc.managed_by.trim().toLowerCase()
      : '';
  if (managedBy && HOST_MANAGED_OWNERS.has(managedBy)) {
    return true;
  }

  const reportedDeviceType = typeof ifc.deviceType === 'string'
    ? ifc.deviceType.trim().toLowerCase()
    : '';
  if (LINUX_WIFI_DEVICE_TYPES.has(reportedDeviceType)) {
    return true;
  }

  const mode = typeof ifc.wifiMode === 'string'
    ? ifc.wifiMode.trim().toLowerCase()
    : typeof ifc.mode === 'string'
      ? ifc.mode.trim().toLowerCase()
      : '';
  const deviceTypeForMode = reportedDeviceType || effectiveDeviceType;
  if (deviceTypeForMode === 'wifi' && mode && WIFI_STATION_MODES.has(mode)) {
    return true;
  }

  return false;
};

/**
 * Detection rule for Linux host-managed Wi-Fi interfaces that appear in Linux
 * inventory but cannot be bound to or managed by VPP:
 *
 * An interface is classified as Linux host-managed (assignable: false, vppManaged: false) when:
 *   1. The report explicitly indicates non-VPP or Linux/host management via any of:
 *      - vppManaged === false || vpp_managed === false
 *      - vppSupported === false || vpp_supported === false
 *      - assignable === false
 *      - linuxManaged === true || linux_managed === true
 *      - hostManaged === true || host_managed === true
 *      - isManagement === true || is_management === true
 *      - managedBy / managed_by in ['linux', 'host', 'os', 'system', 'networkmanager',
 *        'systemd-networkd', 'wpa_supplicant', 'management']
 *      - deviceType in ['linux-wifi', 'host-wifi', 'mgmt-wifi', 'management-wifi', 'wifi-mgmt']
 *      - deviceType === 'wifi' with client/station mode (wifiMode / mode in ['station', 'client', 'sta', 'managed'])
 *   2. OR the interface is NOT declared as a flexiWAN-managed Wi-Fi AP (effective deviceType !== 'wifi'
 *      and vppManaged !== true) AND it identifies as a Linux wireless interface by either:
 *      - a Linux wireless interface name (wlan*, wlp*, wls*, wlx*, wlo*), or
 *      - a known Linux wireless kernel driver (iwlwifi, brcmfmac, rtw88*, ath10k*, mt76*, etc.).
 *
 * When refreshing an existing stored interface (`existingIfc`), the stored interface
 * provides the base deviceType/ownership state whenever the report omits them.
 * An existing flexiWAN-managed Wi-Fi AP (deviceType === 'wifi') requires explicit
 * host-management evidence (rule 1) before being reclassified as unassignable/non-VPP,
 * so partial refreshes that omit deviceType never disable a healthy AP.
 *
 * @param {Object} ifc
 * @param {Object|null} [existingIfc=null]
 * @returns {boolean}
 */
const isLinuxManagementWifi = (ifc, existingIfc = null) => {
  if (!ifc || typeof ifc !== 'object') return false;

  const reportedDeviceType = typeof ifc.deviceType === 'string'
    ? ifc.deviceType.trim().toLowerCase()
    : '';
  const storedDeviceType = existingIfc && typeof existingIfc.deviceType === 'string'
    ? existingIfc.deviceType.trim().toLowerCase()
    : '';
  const effectiveDeviceType = reportedDeviceType || storedDeviceType;

  // Rule 1: Explicit host-management / non-VPP evidence on the report always applies
  if (hasExplicitHostManagementEvidence(ifc, effectiveDeviceType)) {
    return true;
  }

  // Explicitly marked VPP-managed on the report
  if (ifc.vppManaged === true) {
    return false;
  }

  // FlexiWAN-managed Wi-Fi APs (whether declared on this report or inherited from the
  // stored interface on a partial refresh) require explicit rule-1 evidence to reclassify.
  if (effectiveDeviceType === 'wifi') {
    return Boolean(existingIfc && existingIfc.vppManaged === false);
  }

  // Preserve previously classified non-VPP status on stored interface
  if (existingIfc && existingIfc.vppManaged === false) {
    return true;
  }

  // Rule 2 applies only to new or currently unassigned interfaces. For an existing
  // assigned interface, only explicit rule-1 evidence or an already-stored
  // vppManaged === false (handled above) may downgrade it.
  if (existingIfc && existingIfc.isAssigned === true) {
    return false;
  }

  // Rule 2: Linux wireless name/driver heuristic for non-AP interfaces
  const name = typeof ifc.name === 'string' && ifc.name.trim() !== ''
    ? ifc.name.trim()
    : (existingIfc && typeof existingIfc.name === 'string' ? existingIfc.name.trim() : '');
  const driver = typeof ifc.driver === 'string' && ifc.driver.trim() !== ''
    ? ifc.driver.trim()
    : (existingIfc && typeof existingIfc.driver === 'string' ? existingIfc.driver.trim() : '');
  if (LINUX_WIFI_NAME_RE.test(name) || LINUX_WIFI_DRIVER_RE.test(driver)) {
    return true;
  }

  return false;
};

/**
 * Converts a Mongoose subdocument or plain object into a plain JS object copy.
 *
 * @param {Object} ifc
 * @returns {Object}
 */
const toPlainInterface = (ifc) => {
  if (!ifc || typeof ifc !== 'object') return ifc;
  if (typeof ifc.toObject === 'function') {
    return ifc.toObject({ minimize: false });
  }
  return { ...ifc };
};

const normalizeInternetAccess = (reportedVal, linkStatus) => {
  if (reportedVal === undefined) return '';
  if (linkStatus === 'down') return 'no';
  if (reportedVal === false || reportedVal === 'no') return 'no';
  return reportedVal ? 'yes' : 'no';
};

const parseMtu = (mtuVal, fallback = 1500) => {
  if (mtuVal === undefined || mtuVal === null || mtuVal === '') return fallback;
  const parsed = Number(mtuVal);
  return Number.isFinite(parsed) && parsed >= 500 && parsed <= 9999 ? parsed : fallback;
};

/**
 * Scores how informative a reported interface entry is for deduplication.
 * Higher score wins; ties prefer the later entry.
 *
 * @param {Object} entry
 * @returns {number}
 */
const reportInfoScore = (entry) => {
  let score = 0;
  if (isValidDevId(entry.devId)) score += 10;
  if (normalizeMac(entry.MAC)) score += 5;
  if (typeof entry.name === 'string' && entry.name.trim()) score += 2;
  if (entry.IPv4) score += 2;
  if (entry.IPv6) score += 1;
  if (entry.gateway) score += 1;
  if (entry.link === 'up' || entry.linkStatus === 'up') score += 2;
  else if (entry.link || entry.linkStatus) score += 1;
  if (entry.driver) score += 1;
  if (entry.public_ip || entry.PublicIP) score += 1;
  if (entry.mtu !== undefined && entry.mtu !== null && entry.mtu !== '') score += 1;
  return score;
};

/**
 * Combines two duplicate reported entries, preferring the latest/most informative entry
 * while preserving valid devId/MAC and non-empty identity fields from either entry.
 *
 * @param {Object} earlier
 * @param {Object} later
 * @returns {Object}
 */
const mergeDuplicateReportedEntries = (earlier, later) => {
  const earlierScore = reportInfoScore(earlier);
  const laterScore = reportInfoScore(later);
  const primary = laterScore >= earlierScore ? later : earlier;
  const secondary = primary === later ? earlier : later;
  const merged = { ...secondary, ...primary };

  if (!isValidDevId(merged.devId) && isValidDevId(secondary.devId)) {
    merged.devId = secondary.devId;
  }
  if (!normalizeMac(merged.MAC) && normalizeMac(secondary.MAC)) {
    merged.MAC = secondary.MAC;
  }
  for (const field of ['name', 'driver', 'IPv4', 'IPv4Mask', 'IPv6', 'IPv6Mask', 'gateway', 'link', 'deviceType']) {
    const mergedEmpty = merged[field] === undefined || merged[field] === '' ||
      (field === 'name' && typeof merged[field] === 'string' && merged[field].trim() === '');
    const secondaryNonEmpty = secondary[field] !== undefined && secondary[field] !== '' &&
      !(field === 'name' && typeof secondary[field] === 'string' && secondary[field].trim() === '');
    if (mergedEmpty && secondaryNonEmpty) {
      merged[field] = secondary[field];
    }
  }

  // Order-independent handling of conflicting names for the same valid devId:
  // never let arrival order pick a winning name that could redirect a Pass 3 backfill.
  const sameValidDevId = isValidDevId(earlier.devId) &&
    isValidDevId(later.devId) &&
    earlier.devId.trim().toLowerCase() === later.devId.trim().toLowerCase();
  const earlierName = typeof earlier.name === 'string' ? earlier.name.trim() : '';
  const laterName = typeof later.name === 'string' ? later.name.trim() : '';
  if (sameValidDevId && earlierName && laterName && earlierName !== laterName) {
    merged.name = '';
  }

  return merged;
};

/**
 * Deduplicates reported interface entries with strict devId precedence and
 * order-independent semantics:
 *   - devId identity ALWAYS wins over MAC: two entries with DIFFERENT valid devIds
 *     (e.g. cloned MAC across two PCI ports, or VLAN sharing parent MAC) are NEVER
 *     collapsed together.
 *   - An entry with a missing/invalid devId is NEVER merged with an entry carrying
 *     a valid devId through the MAC+VLAN bucket fallback (in either arrival order),
 *     preventing a devId-less entry from attaching fields such as name to an
 *     arbitrary valid-devId report.
 *   - MAC + vlanKey is only used to collapse duplicates when both entries lack a
 *     valid devId.
 *
 * @param {Array} reportedInterfaces
 * @returns {Array}
 */
const dedupeReportedInterfaces = (reportedInterfaces) => {
  if (!Array.isArray(reportedInterfaces)) return [];

  const deduped = [];
  const devIdIndex = new Map();
  const noDevIdMacIndex = new Map();
  const firstNonEmptyNameByDevKey = new Map();
  const conflictedNameDevKeys = new Set();

  for (const raw of reportedInterfaces) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = { ...raw };
    if (typeof entry.devId === 'string') {
      entry.devId = entry.devId.trim();
    }
    if (typeof entry.MAC === 'string') {
      entry.MAC = entry.MAC.trim();
    }

    const devKey = isValidDevId(entry.devId) ? entry.devId.toLowerCase() : '';
    const trimmedName = typeof entry.name === 'string' ? entry.name.trim() : '';
    const normMac = normalizeMac(entry.MAC);
    const macKey = normMac ? `${normMac}|${getVlanKey(entry)}` : '';

    if (devKey && trimmedName) {
      if (!firstNonEmptyNameByDevKey.has(devKey)) {
        firstNonEmptyNameByDevKey.set(devKey, trimmedName);
      } else if (firstNonEmptyNameByDevKey.get(devKey) !== trimmedName) {
        conflictedNameDevKeys.add(devKey);
      }
    }

    let existingIdx;
    if (devKey) {
      if (devIdIndex.has(devKey)) {
        // Exact valid devId duplicate
        existingIdx = devIdIndex.get(devKey);
      }
    } else if (macKey && noDevIdMacIndex.has(macKey)) {
      // Missing/invalid devId entries only collapse with other missing/invalid devId
      // entries sharing the same MAC+VLAN key.
      existingIdx = noDevIdMacIndex.get(macKey);
    }

    if (existingIdx !== undefined) {
      deduped[existingIdx] = mergeDuplicateReportedEntries(deduped[existingIdx], entry);
      if (devKey && conflictedNameDevKeys.has(devKey)) {
        deduped[existingIdx].name = '';
      }
    } else {
      const idx = deduped.length;
      deduped.push(entry);
      if (devKey) {
        devIdIndex.set(devKey, idx);
      } else if (macKey) {
        noDevIdMacIndex.set(macKey, idx);
      }
    }
  }

  return deduped;
};

/**
 * Normalizes a list of brand-new interfaces (used by registration and for newly
 * appended interfaces during refresh). Pure function; does not mutate inputs.
 *
 * @param {Array} rawInterfaces
 * @param {Object} [options]
 * @param {string} [options.sourceIP]
 * @param {string} [options.defaultDev]
 * @param {string} [options.defaultRoute]
 * @param {number} [options.initialHighestMetric=0]
 * @param {boolean} [options.assignObjectIds=false]
 * @returns {{ interfaces: Array, dropped: Array }}
 */
const normalizeNewInterfaces = (rawInterfaces, options = {}) => {
  const {
    sourceIP = '',
    defaultDev = '',
    defaultRoute = '',
    initialHighestMetric = 0,
    assignObjectIds = false
  } = options;

  const deduped = dedupeReportedInterfaces(rawInterfaces);
  const valid = [];
  const dropped = [];

  for (const entry of deduped) {
    if (!isValidDevId(entry.devId)) {
      dropped.push(entry);
      continue;
    }
    valid.push(entry);
  }

  // Get an interface with gateway and the lowest metric
  const defaultIntf = valid.reduce((res, intf) =>
    intf.gateway && (!res || +res.metric > +intf.metric)
      ? intf
      : res, undefined);
  const lowestMetric = defaultIntf && normalizeScalarString(defaultIntf.metric) !== ''
    ? normalizeScalarString(defaultIntf.metric)
    : '0';

  let highestMetric = Number.isFinite(initialHighestMetric) ? initialHighestMetric : 0;
  const setAutoMetricIndexes = new Set();

  const normalized = valid.map((raw, idx) => {
    const intf = { ...raw };
    const linuxMgmtWifi = isLinuxManagementWifi(raw);

    // VLAN identification by devId, example "vlan.10.pci:0000:00:08.00"
    const idParts = intf.devId.split('.');
    if (idParts.length > 2 && idParts[0].toLowerCase() === 'vlan' && idParts[1]) {
      intf.vlanTag = idParts[1];
      intf.parentDevId = idParts.slice(2).join('.');
    }

    if (assignObjectIds && !intf._id) {
      intf._id = new mongoose.Types.ObjectId();
    }

    intf.locked = true;
    intf.isAssigned = false;
    intf.useStun = true;
    intf.useFixedPublicPort = false;
    intf.assignable = !linuxMgmtWifi;
    intf.vppManaged = !linuxMgmtWifi;
    intf.deviceType = intf.deviceType || 'dpdk';

    const linkStatus = raw.link !== undefined
      ? raw.link
      : (raw.linkStatus !== undefined ? raw.linkStatus : '');
    intf.linkStatus = linkStatus;
    intf.internetAccess = normalizeInternetAccess(raw.internetAccess, linkStatus);
    intf.mtu = parseMtu(raw.mtu, 1500);
    intf.IPv4 = raw.IPv4 !== undefined && raw.IPv4 !== null ? String(raw.IPv4) : '';
    if (raw.IPv4Mask !== undefined && raw.IPv4Mask !== null) {
      intf.IPv4Mask = String(raw.IPv4Mask);
    }
    intf.IPv6 = raw.IPv6 !== undefined && raw.IPv6 !== null ? String(raw.IPv6) : '';
    if (raw.IPv6Mask !== undefined && raw.IPv6Mask !== null) {
      intf.IPv6Mask = String(raw.IPv6Mask);
    }
    intf.hasIpOnDevice = intf.IPv4 !== '';

    const rawPublicIp = raw.public_ip !== undefined ? raw.public_ip : raw.PublicIP;
    const rawPublicPort = raw.public_port !== undefined ? raw.public_port : raw.PublicPort;
    const rawNatType = raw.nat_type !== undefined ? raw.nat_type : raw.NatType;

    if (!defaultIntf && defaultDev && intf.name === defaultDev) {
      // old version agent
      intf.PublicIP = rawPublicIp || sourceIP;
      intf.PublicPort = normalizeScalarString(rawPublicPort);
      intf.NatType = rawNatType || '';
      intf.type = 'WAN';
      intf.dhcp = raw.dhcp || 'no';
      intf.gateway = defaultRoute || '';
      intf.metric = '0';
    } else if (raw.gateway || ['lte', 'pppoe'].includes(intf.deviceType)) {
      intf.type = 'WAN';
      intf.dhcp = raw.dhcp || 'no';
      if (intf.deviceType === 'lte') {
        intf.deviceParams = raw.deviceParams ? mapLteNames({ ...raw.deviceParams }) : {};
        intf.metric = null;
      } else {
        const rawMetric = normalizeScalarString(raw.metric);
        intf.metric = (!rawMetric && defaultRoute && raw.gateway === defaultRoute)
          ? '0'
          : (rawMetric || null);
      }
      intf.PublicIP = rawPublicIp || (intf.metric === lowestMetric ? sourceIP : '');
      intf.PublicPort = normalizeScalarString(rawPublicPort);
      intf.NatType = rawNatType || '';
      if (intf.deviceType === 'pppoe') {
        intf.dhcp = 'yes';
      }

      // to calculate auto metrics, store the highest configured metric
      // and the interfaces that we need to add an auto metric.
      if (intf.metric) {
        highestMetric = Math.max(highestMetric, parseInt(intf.metric, 10));
      } else {
        setAutoMetricIndexes.add(idx);
      }
    } else {
      intf.type = 'LAN';
      // set LAN as DHCP only if it's DHCP in Linux and has IP address.
      // Otherwise set it to static on registration.
      intf.dhcp = raw.dhcp === 'yes' && intf.IPv4 !== '' ? 'yes' : 'no';
      intf.routing = 'NONE';
      intf.gateway = '';
      intf.metric = '';
      intf.PublicIP = rawPublicIp || '';
      intf.PublicPort = normalizeScalarString(rawPublicPort);
      intf.NatType = rawNatType || '';
    }

    for (const key of RAW_REPORT_ONLY_KEYS) {
      delete intf[key];
    }

    return intf;
  });

  // set auto metrics for interfaces without a metric.
  // This loop is done at the end to avoid metric duplication.
  setAutoMetricIndexes.forEach((i) => {
    highestMetric += 100;
    normalized[i].metric = String(highestMetric);
  });

  return { interfaces: normalized, dropped };
};

/**
 * Registration entrypoint: validates, dedupes, and normalizes reported interfaces
 * before devices.create.
 */
const normalizeRegistrationInterfaces = (rawInterfaces, options = {}) =>
  normalizeNewInterfaces(rawInterfaces, { ...options, assignObjectIds: false });

/**
 * Refreshes only volatile fields on an existing stored interface from a matched report,
 * preserving _id, name, isAssigned, locked, pathlabels, qosPolicy, tunnel references,
 * and every other non-volatile field.
 *
 * @param {Object} existingPlain
 * @param {Object} reported
 * @param {string} resolvedDevId
 * @returns {Object}
 */
const refreshMatchedInterface = (existingPlain, reported, resolvedDevId) => {
  const reportedLink = reported.link !== undefined ? reported.link : reported.linkStatus;
  const nextLinkStatus = reportedLink !== undefined ? reportedLink : existingPlain.linkStatus;
  const reportedPublicIp = reported.public_ip !== undefined ? reported.public_ip : reported.PublicIP;
  const reportedPublicPort = reported.public_port !== undefined ? reported.public_port : reported.PublicPort;
  const reportedNatType = reported.nat_type !== undefined ? reported.nat_type : reported.NatType;

  const normalizedReportedPort = normalizeScalarString(reportedPublicPort);
  const normalizedExistingPort = normalizeScalarString(existingPlain.PublicPort);

  const updInterface = {
    ...existingPlain,
    devId: resolvedDevId,
    PublicIP: reportedPublicIp && existingPlain.useStun
      ? String(reportedPublicIp)
      : existingPlain.PublicIP,
    PublicPort: normalizedReportedPort && existingPlain.useStun
      ? normalizedReportedPort
      : (existingPlain.PublicPort !== undefined ? normalizedExistingPort : existingPlain.PublicPort),
    NatType: reportedNatType || existingPlain.NatType,
    internetAccess: normalizeInternetAccess(reported.internetAccess, nextLinkStatus),
    linkStatus: nextLinkStatus,
    hasIpOnDevice: reported.IPv4 !== undefined
      ? reported.IPv4 !== ''
      : existingPlain.hasIpOnDevice
  };

  // Backfill MAC only if previously missing on the stored interface
  if (!normalizeMac(existingPlain.MAC) && normalizeMac(reported.MAC)) {
    updInterface.MAC = reported.MAC.trim();
  }

  // Evaluate Linux host-managed Wi-Fi using the stored interface as the base so
  // partial reports omitting deviceType never reclassify a healthy flexiWAN Wi-Fi AP.
  if (isLinuxManagementWifi(reported, existingPlain)) {
    updInterface.assignable = false;
    updInterface.vppManaged = false;
  }

  // Allow modifying interface type dpdk/pppoe for unassigned interfaces
  if (!existingPlain.isAssigned && ['dpdk', 'pppoe'].includes(reported.deviceType)) {
    // Don't allow changing LTE or WiFi deviceType dynamically
    if (existingPlain.deviceType !== 'lte' && existingPlain.deviceType !== 'wifi') {
      updInterface.deviceType = reported.deviceType;
    }
    if (reported.dhcp !== undefined) {
      updInterface.dhcp = reported.dhcp;
    }
    if (reported.deviceType === 'pppoe') {
      updInterface.type = 'WAN';
      updInterface.routing = 'NONE';
    }
  }

  if (existingPlain.dhcp === 'yes' || !existingPlain.isAssigned || existingPlain.deviceType === 'pppoe') {
    if (reported.IPv4 !== undefined) updInterface.IPv4 = String(reported.IPv4);
    if (reported.IPv4Mask !== undefined && reported.IPv4Mask !== null) {
      updInterface.IPv4Mask = String(reported.IPv4Mask);
    }
    if (reported.IPv6 !== undefined) updInterface.IPv6 = String(reported.IPv6);
    if (reported.IPv6Mask !== undefined && reported.IPv6Mask !== null) {
      updInterface.IPv6Mask = String(reported.IPv6Mask);
    }
    if (reported.gateway !== undefined) updInterface.gateway = String(reported.gateway);
  }

  if (!existingPlain.isAssigned || existingPlain.deviceType === 'pppoe') {
    // Don't update metric for LTE interface; metric is static in flexiManage.
    // When a report omits metric ('', null, undefined) for a WAN interface that
    // already has a generated metric, preserve the stored metric so identical
    // repeated reports never oscillate or overwrite auto-assigned metrics.
    if (existingPlain.deviceType !== 'lte') {
      const normalizedReportedMetric = normalizeScalarString(reported.metric);
      if (normalizedReportedMetric !== '') {
        updInterface.metric = normalizedReportedMetric;
      } else if (!updInterface.gateway && updInterface.deviceType !== 'pppoe') {
        updInterface.metric = '';
      } else if (existingPlain.metric !== undefined && existingPlain.metric !== null) {
        updInterface.metric = normalizeScalarString(existingPlain.metric);
      }
    }
    if (reported.mtu !== undefined && reported.mtu !== null && reported.mtu !== '') {
      const parsedMtu = Number(reported.mtu);
      if (Number.isFinite(parsedMtu)) {
        updInterface.mtu = parsedMtu;
      }
    }
  }

  if (!existingPlain.isAssigned && updInterface.deviceType === 'dpdk') {
    // Changing the type of an unassigned DPDK interface based on the gateway.
    // Non-dpdk interfaces (pppoe/lte/wifi) retain the type set on registration.
    updInterface.type = updInterface.gateway ? 'WAN' : 'LAN';
  }

  updInterface.locked = existingPlain.locked;
  return updInterface;
};

/**
 * Pure additive, idempotent inventory merge between stored interfaces and a live
 * agent report.
 *
 * Matching precedence:
 *   1. Valid non-empty devId (case-insensitive) — always wins over MAC
 *   2. Case-insensitive MAC — only when at least one side lacks a valid devId
 *      (never matches two different valid devIds) and VLAN/parent keys match
 *   3. Interface name as a last resort (never matching malformed devIds or conflicting MACs/devIds)
 *
 * Invariants:
 *   - Additive for all physical/persistent interfaces: no physical interface is ever dropped.
 *   - Sole narrow exception to the additive rule: baseline Connections.reconfigCheck VLAN
 *     removal semantics. When a non-empty report omits a stored VLAN sub-interface
 *     (devId starting with 'vlan'), it is unlocked if assigned (so the user can remove it)
 *     and omitted if unassigned, because VLAN sub-interfaces are ephemeral virtual Linux
 *     interfaces that can be deleted on the device.
 *   - Every valid unmatched reported interface is appended with a fresh Mongoose ObjectId,
 *     locked: true, isAssigned: false, and registration-equivalent normalized defaults.
 *   - Never produces two stored interfaces sharing a devId.
 *
 * @param {Array} existingInterfaces
 * @param {Array} reportedInterfaces
 * @param {Object} [options]
 * @returns {{
 *   interfaces: Array,
 *   matchedPairs: Array,
 *   recoveredDevIds: Array,
 *   missingInterfaces: Array,
 *   removedVlans: Array,
 *   addedInterfaces: Array,
 *   droppedReported: Array
 * }}
 */
const mergeInterfaceInventory = (existingInterfaces, reportedInterfaces, options = {}) => {
  const existingPlainList = (existingInterfaces || []).map(toPlainInterface);
  const hasNonEmptyReport = Array.isArray(reportedInterfaces) && reportedInterfaces.length > 0;
  const dedupedReported = dedupeReportedInterfaces(reportedInterfaces);

  const existingMatch = new Array(existingPlainList.length).fill(null);
  const reportedUsed = new Array(dedupedReported.length).fill(false);

  // Track all valid devIds already owned by existing interfaces so we never create duplicates.
  const usedDevIds = new Set();
  for (const ex of existingPlainList) {
    if (isValidDevId(ex.devId)) {
      usedDevIds.add(ex.devId.trim().toLowerCase());
    }
  }

  // Pass 1: Match by valid non-empty devId (always takes precedence over MAC)
  for (let ei = 0; ei < existingPlainList.length; ei++) {
    const ex = existingPlainList[ei];
    if (!isValidDevId(ex.devId)) continue;
    const exDevKey = ex.devId.trim().toLowerCase();

    for (let ri = 0; ri < dedupedReported.length; ri++) {
      if (reportedUsed[ri]) continue;
      const rep = dedupedReported[ri];
      if (!isValidDevId(rep.devId)) continue;
      if (rep.devId.trim().toLowerCase() === exDevKey) {
        existingMatch[ei] = { ri, matchType: 'devId' };
        reportedUsed[ri] = true;
        break;
      }
    }
  }

  // Pass 2: Match remaining by case-insensitive MAC ONLY when at least one side
  // has a missing/invalid devId (no conflicting valid devIds on both sides) AND
  // VLAN/parent identity matches.
  // Snapshot full (MAC, VLAN/parent-key) groups before making any Pass 2 decisions
  // so ambiguity evaluation and matching are independent of stored/report row order.
  // Require an unambiguous match (unique corroborating interface name within the
  // group, or an original single-stored-row / single-usable-report group) before
  // backfilling a devId; never backfill a devId-less stored row from a cloned-MAC
  // group without unique name corroboration.
  const ambiguousExisting = new Set();
  const ambiguousReported = new Set();
  const pass2BlockedGroupByReported = new Map();

  // Count all stored rows (including Pass-1 matched rows) per (MAC, vlanKey) so a
  // multi-stored-row cloned-MAC key never degenerates into a misleading singleton.
  const totalStoredCountByMacKey = new Map();
  const unmatchedStoredByMacKey = new Map();
  for (let ei = 0; ei < existingPlainList.length; ei++) {
    const ex = existingPlainList[ei];
    const exMac = normalizeMac(ex.MAC);
    if (!exMac) continue;
    const key = `${exMac}|${getVlanKey(ex)}`;
    totalStoredCountByMacKey.set(key, (totalStoredCountByMacKey.get(key) || 0) + 1);
    if (!existingMatch[ei]) {
      if (!unmatchedStoredByMacKey.has(key)) {
        unmatchedStoredByMacKey.set(key, []);
      }
      unmatchedStoredByMacKey.get(key).push(ei);
    }
  }

  const unmatchedReportedByMacKey = new Map();
  for (let ri = 0; ri < dedupedReported.length; ri++) {
    if (reportedUsed[ri]) continue;
    const rep = dedupedReported[ri];
    const repMac = normalizeMac(rep.MAC);
    if (!repMac) continue;
    const key = `${repMac}|${getVlanKey(rep)}`;
    if (!unmatchedReportedByMacKey.has(key)) {
      unmatchedReportedByMacKey.set(key, []);
    }
    unmatchedReportedByMacKey.get(key).push(ri);
  }

  const isMacCompatible = (ex, rep) => {
    if (isValidDevId(ex.devId) && isValidDevId(rep.devId)) return false;
    const exParent = getVlanParentDevId(ex);
    const repParent = getVlanParentDevId(rep);
    if (exParent && repParent && exParent !== repParent) return false;
    return true;
  };

  for (const [macKey, storedIndices] of unmatchedStoredByMacKey.entries()) {
    const reportedIndices = unmatchedReportedByMacKey.get(macKey) || [];
    if (reportedIndices.length === 0) continue;

    const totalStoredInGroup = totalStoredCountByMacKey.get(macKey) || storedIndices.length;

    if (totalStoredInGroup === 1 && storedIndices.length === 1) {
      // Single stored row for this (MAC, vlanKey) in the pre-Pass-2 inventory.
      const ei = storedIndices[0];
      const ex = existingPlainList[ei];
      const usableReported = reportedIndices.filter((ri) =>
        isMacCompatible(ex, dedupedReported[ri])
      );
      if (usableReported.length === 0) continue;

      if (usableReported.length === 1) {
        const chosenRi = usableReported[0];
        existingMatch[ei] = { ri: chosenRi, matchType: 'mac' };
        reportedUsed[chosenRi] = true;
      } else {
        // Multiple usable reports for a single stored row: disambiguate by unique name match.
        const nameMatches = ex.name
          ? usableReported.filter((ri) => dedupedReported[ri].name === ex.name)
          : [];
        const validDevIdCandidates = usableReported.filter((ri) =>
          isValidDevId(dedupedReported[ri].devId)
        );
        if (nameMatches.length === 1) {
          const chosenRi = nameMatches[0];
          existingMatch[ei] = { ri: chosenRi, matchType: 'mac' };
          reportedUsed[chosenRi] = true;
        } else if (
          validDevIdCandidates.length === 1 &&
          ex.name &&
          dedupedReported[validDevIdCandidates[0]].name === ex.name
        ) {
          // A single valid-devId candidate corroborated by the stored row's name must not
          // be made ambiguous by co-occurring ID-less observation(s) on the same MAC+VLAN key.
          const chosenRi = validDevIdCandidates[0];
          existingMatch[ei] = { ri: chosenRi, matchType: 'mac' };
          reportedUsed[chosenRi] = true;
          for (const ri of nameMatches) {
            if (ri !== chosenRi && !isValidDevId(dedupedReported[ri].devId)) {
              ambiguousReported.add(ri);
            }
          }
        } else {
          // Fully ambiguous single-stored-row case: keep stored row untouched and drop
          // ambiguous candidate reports rather than duplicating the unresolved port.
          ambiguousExisting.add(ei);
          for (const ri of usableReported) {
            ambiguousReported.add(ri);
          }
        }
      }
      continue;
    }

    // Multi-stored-row cloned-MAC group (snapshot-based, order-independent):
    // 1. Resolve unique corroborating name matches across the full snapshot first.
    //    If two or more unmatched stored rows share the same name, name does not disambiguate.
    const storedNameCounts = new Map();
    for (const ei of storedIndices) {
      const name = existingPlainList[ei].name;
      if (name) {
        storedNameCounts.set(name, (storedNameCounts.get(name) || 0) + 1);
      }
    }

    const plannedMatches = [];
    for (const ei of storedIndices) {
      const ex = existingPlainList[ei];
      if (!ex.name || storedNameCounts.get(ex.name) !== 1) continue;

      const usableNameMatches = reportedIndices.filter((ri) => {
        const rep = dedupedReported[ri];
        return rep.name === ex.name && isMacCompatible(ex, rep);
      });
      if (usableNameMatches.length === 1) {
        plannedMatches.push({ ei, ri: usableNameMatches[0] });
      }
    }

    for (const { ei, ri } of plannedMatches) {
      existingMatch[ei] = { ri, matchType: 'mac' };
      reportedUsed[ri] = true;
    }

    // 2. Do NOT run a singleton fallback on remaining rows of a multi-stored-row group.
    //    Any remaining unmatched stored row keeps its original devId untouched (and is
    //    blocked from Pass 3), while unused reports with distinct valid devIds remain
    //    eligible for unassigned new-inventory append (invalid devIds are dropped later).
    const unresolvedGroupStored = new Set();
    for (const ei of storedIndices) {
      if (!existingMatch[ei]) {
        ambiguousExisting.add(ei);
        unresolvedGroupStored.add(ei);
      }
    }
    if (unresolvedGroupStored.size > 0) {
      for (const ri of reportedIndices) {
        if (!reportedUsed[ri]) {
          pass2BlockedGroupByReported.set(ri, unresolvedGroupStored);
        }
      }
    }
  }

  // Snapshot unmatched stored rows and unused reports by name before Pass 3 runs
  // so name-only matching and devId backfill are independent of row order.
  const omitsAllVlanIdentity = (ifc) =>
    !getVlanKey(ifc) &&
    !getVlanParentDevId(ifc) &&
    (ifc.vlanTag === undefined || ifc.vlanTag === null || String(ifc.vlanTag).trim() === '') &&
    (ifc.parentDevId === undefined || ifc.parentDevId === null || String(ifc.parentDevId).trim() === '');

  const isPartialVlanNameRefresh = (ex, rep) =>
    isValidDevId(ex.devId) &&
    typeof ex.devId === 'string' &&
    ex.devId.trim().startsWith('vlan') &&
    !isValidDevId(rep.devId) &&
    !isMalformedDevId(rep.devId) &&
    omitsAllVlanIdentity(rep);

  const isPass3IdentityCompatible = (ex, rep) => {
    if (!ex.name || !rep.name || rep.name !== ex.name) return false;
    if (isMalformedDevId(rep.devId)) return false;

    if (!isPartialVlanNameRefresh(ex, rep)) {
      if (getVlanKey(ex) !== getVlanKey(rep)) return false;
      const exParent = getVlanParentDevId(ex);
      const repParent = getVlanParentDevId(rep);
      if (exParent && repParent && exParent !== repParent) return false;
      if (Boolean(exParent) !== Boolean(repParent) && !getVlanKey(ex)) return false;
    }

    const exMac = normalizeMac(ex.MAC);
    const repMac = normalizeMac(rep.MAC);
    if (exMac && repMac && exMac !== repMac) return false;

    // If both have valid devIds and didn't match in Pass 1, they are distinct bus addresses
    if (isValidDevId(ex.devId) && isValidDevId(rep.devId)) return false;

    return true;
  };

  const unmatchedStoredByName = new Map();
  for (let ei = 0; ei < existingPlainList.length; ei++) {
    if (existingMatch[ei]) continue;
    const name = existingPlainList[ei].name;
    if (!name) continue;
    if (!unmatchedStoredByName.has(name)) {
      unmatchedStoredByName.set(name, []);
    }
    unmatchedStoredByName.get(name).push(ei);
  }

  const unusedReportedByName = new Map();
  for (let ri = 0; ri < dedupedReported.length; ri++) {
    if (reportedUsed[ri]) continue;
    const name = dedupedReported[ri].name;
    if (!name) continue;
    if (!unusedReportedByName.has(name)) {
      unusedReportedByName.set(name, []);
    }
    unusedReportedByName.get(name).push(ri);
  }

  const canPass2BlockedReportMatchInPass3 = (ri, ei) => {
    const blockedGroupStored = pass2BlockedGroupByReported.get(ri);
    if (!blockedGroupStored) return true;
    if (blockedGroupStored.has(ei)) return false;

    const rep = dedupedReported[ri];
    if (!rep.name || isMalformedDevId(rep.devId)) return false;

    // Keep report blocked while it still competes for an unresolved stored row
    // with the same name in its own cloned-MAC group.
    for (const gei of blockedGroupStored) {
      const gex = existingPlainList[gei];
      if (gex.name === rep.name && isMacCompatible(gex, rep)) {
        return false;
      }
    }

    // Allow Pass 3 pairing only when the report's name uniquely identifies this
    // single compatible unmatched stored row outside the cloned-MAC group and no
    // other identity-compatible unused report is eligible for that stored row.
    const sameNameStored = unmatchedStoredByName.get(rep.name) || [];
    const compatibleOutside = sameNameStored.filter((oei) => {
      if (blockedGroupStored.has(oei)) return false;
      return isPass3IdentityCompatible(existingPlainList[oei], rep);
    });
    if (compatibleOutside.length !== 1 || compatibleOutside[0] !== ei) {
      return false;
    }

    const ex = existingPlainList[ei];
    const sameNameReports = unusedReportedByName.get(rep.name) || [];
    const eligibleReports = sameNameReports.filter((ori) =>
      !ambiguousReported.has(ori) && isPass3IdentityCompatible(ex, dedupedReported[ori])
    );
    return eligibleReports.length === 1 && eligibleReports[0] === ri;
  };

  // Pass 3: Match remaining by name as a last resort.
  // Never match malformed non-empty devIds by name (those require MAC identification),
  // never match entries with conflicting valid MACs, VLAN tags/parents, or valid devIds,
  // never backfill a devId onto a devId-less stored row without a unique eligible
  // name match on both sides, and never override an unresolved competing MAC ambiguity.
  for (let ei = 0; ei < existingPlainList.length; ei++) {
    if (existingMatch[ei] || ambiguousExisting.has(ei)) continue;
    const ex = existingPlainList[ei];
    if (!ex.name) continue;
    const exHasValidDevId = isValidDevId(ex.devId);

    for (let ri = 0; ri < dedupedReported.length; ri++) {
      if (reportedUsed[ri] || ambiguousReported.has(ri)) continue;
      const rep = dedupedReported[ri];
      if (!isPass3IdentityCompatible(ex, rep)) continue;
      if (!canPass2BlockedReportMatchInPass3(ri, ei)) continue;

      const repHasValidDevId = isValidDevId(rep.devId);
      if ((!exHasValidDevId && repHasValidDevId) || isPartialVlanNameRefresh(ex, rep)) {
        const sameNameStored = unmatchedStoredByName.get(ex.name) || [];
        const eligibleStored = sameNameStored.filter((oei) =>
          isPass3IdentityCompatible(existingPlainList[oei], rep)
        );
        const sameNameReports = unusedReportedByName.get(rep.name) || [];
        const eligibleReports = sameNameReports.filter((ori) =>
          !ambiguousReported.has(ori) && isPass3IdentityCompatible(ex, dedupedReported[ori])
        );
        if (
          eligibleStored.length !== 1 ||
          eligibleStored[0] !== ei ||
          eligibleReports.length !== 1 ||
          eligibleReports[0] !== ri
        ) {
          continue;
        }
      }

      existingMatch[ei] = { ri, matchType: 'name' };
      reportedUsed[ri] = true;
      break;
    }
  }

  const merged = [];
  const matchedPairs = [];
  const recoveredDevIds = [];
  const missingInterfaces = [];
  const removedVlans = [];

  for (let ei = 0; ei < existingPlainList.length; ei++) {
    const ex = existingPlainList[ei];
    const match = existingMatch[ei];

    if (!match) {
      // Sole narrow exception to the additive inventory rule:
      // Unlike physical ports (which are never dropped), VLAN sub-interfaces are
      // ephemeral Linux virtual interfaces. Matching baseline Connections.reconfigCheck,
      // when a non-empty device report omits a stored VLAN sub-interface, unlock it if
      // assigned (allowing the user to remove it in flexiManage) or omit it if unassigned.
      if (hasNonEmptyReport && isVlanInterface(ex) &&
        typeof ex.devId === 'string' && ex.devId.trim().startsWith('vlan')) {
        if (ex.isAssigned) {
          merged.push({ ...ex, locked: false });
        } else {
          removedVlans.push(ex);
        }
        continue;
      }

      // Additive guarantee for all non-VLAN interfaces: never drop an existing stored interface
      missingInterfaces.push(ex);
      merged.push({ ...ex });
      continue;
    }

    const rep = dedupedReported[match.ri];
    const exHasValidDevId = isValidDevId(ex.devId);
    const repHasValidDevId = isValidDevId(rep.devId);

    let resolvedDevId = ex.devId;
    if (!exHasValidDevId && repHasValidDevId) {
      const candidateKey = rep.devId.trim().toLowerCase();
      if (!usedDevIds.has(candidateKey)) {
        resolvedDevId = rep.devId.trim();
        usedDevIds.add(candidateKey);
        if (match.matchType === 'mac') {
          recoveredDevIds.push({ existing: ex, reported: rep, devId: resolvedDevId });
        }
      }
    } else if (exHasValidDevId) {
      // Preserve existing valid devId (even when the report omits or sends an invalid devId)
      resolvedDevId = ex.devId;
    }

    const updated = refreshMatchedInterface(ex, rep, resolvedDevId);
    merged.push(updated);
    matchedPairs.push({ existing: ex, reported: rep, updated, matchType: match.matchType });
  }

  // Collect unmatched reported entries to append as new interfaces
  const unmatchedReported = [];
  const droppedReported = [];

  for (let ri = 0; ri < dedupedReported.length; ri++) {
    if (reportedUsed[ri]) continue;
    const rep = dedupedReported[ri];
    if (ambiguousReported.has(ri)) {
      droppedReported.push(rep);
      continue;
    }
    if (!isValidDevId(rep.devId)) {
      droppedReported.push(rep);
      continue;
    }
    const devKey = rep.devId.trim().toLowerCase();
    if (usedDevIds.has(devKey)) {
      droppedReported.push(rep);
      continue;
    }
    usedDevIds.add(devKey);
    unmatchedReported.push(rep);
  }

  // Preserve highest existing metric so newly appended WAN interfaces get non-colliding auto metrics
  const existingHighestMetric = existingPlainList.reduce((max, ifc) => {
    const num = parseInt(ifc.metric, 10);
    return Number.isFinite(num) ? Math.max(max, num) : max;
  }, 0);

  const { interfaces: addedInterfaces, dropped: extraDropped } = normalizeNewInterfaces(
    unmatchedReported,
    {
      ...options,
      initialHighestMetric: existingHighestMetric,
      assignObjectIds: true
    }
  );

  for (const d of extraDropped) {
    droppedReported.push(d);
  }

  for (const added of addedInterfaces) {
    merged.push(added);
  }

  return {
    interfaces: merged,
    matchedPairs,
    recoveredDevIds,
    missingInterfaces,
    removedVlans,
    addedInterfaces,
    droppedReported
  };
};

const isObjectId = (val) => {
  if (!val || typeof val !== 'object') return false;
  return (
    val instanceof mongoose.Types.ObjectId ||
    val._bsontype === 'ObjectId' ||
    val._bsontype === 'ObjectID'
  );
};

/**
 * Casts schema-typed scalar fields on an interface object before deep equality
 * so numeric vs string representations of schema String/Number fields (e.g.
 * PublicPort 4789 vs '4789', metric 100 vs '100', mtu '1500' vs 1500) compare equal.
 *
 * @param {Object} ifc
 * @returns {Object}
 */
const canonicalizeInterfaceForCompare = (ifc) => {
  if (!ifc || typeof ifc !== 'object') return ifc;
  const copy = { ...ifc };
  for (const field of SCHEMA_STRING_SCALAR_FIELDS) {
    if (copy[field] !== undefined && copy[field] !== null) {
      copy[field] = String(copy[field]).trim();
    }
  }
  if (copy.mtu !== undefined && copy.mtu !== null && copy.mtu !== '') {
    const num = Number(copy.mtu);
    if (Number.isFinite(num)) {
      copy.mtu = num;
    }
  }
  return copy;
};

/**
 * Deep equality tailored for Mongoose/MongoDB plain interface documents
 * (handles ObjectIds, Dates, Arrays, key ordering, and undefined vs missing keys).
 *
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
const deepEqual = (a, b) => {
  if (a === b) return true;
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;

  if (isObjectId(a) || isObjectId(b)) {
    if (isObjectId(a) && isObjectId(b)) {
      return a.toString() === b.toString();
    }
    return false;
  }

  if (a instanceof Date || b instanceof Date) {
    if (a instanceof Date && b instanceof Date) {
      return a.getTime() === b.getTime();
    }
    return false;
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a).filter((k) => a[k] !== undefined);
    const keysB = Object.keys(b).filter((k) => b[k] !== undefined);
    if (keysA.length !== keysB.length) return false;
    for (const k of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
      if (!deepEqual(a[k], b[k])) return false;
    }
    return true;
  }

  return false;
};

const areInterfaceListsEqual = (listA, listB) => {
  if (!Array.isArray(listA) || !Array.isArray(listB)) {
    return deepEqual(listA, listB);
  }
  return deepEqual(
    listA.map(canonicalizeInterfaceForCompare),
    listB.map(canonicalizeInterfaceForCompare)
  );
};

/**
 * Concurrency-safe, tenant-scoped DB applier for interface inventory reconciliation.
 *
 * Reads the current device filtered by org (and account when provided), merges the
 * reported interfaces against that fresh copy, skips the DB write if the merged array
 * is deep-equal to the stored array, and otherwise updates using optimistic concurrency
 * (matching _id, org, optional account, and the read __v with $inc __v). On a version
 * conflict, re-reads and re-merges up to maxRetries times.
 *
 * @param {Object} params
 * @param {Object} [params.deviceModel] Mongoose Device model (defaults to models/devices)
 * @param {*} params.deviceId Device _id
 * @param {*} params.org Tenant org id (required)
 * @param {*} [params.account] Tenant account id (included in filter when provided)
 * @param {Array} params.reportedInterfaces Reported interfaces from the agent
 * @param {Object} [params.options] Options forwarded to mergeInterfaceInventory
 * @param {number} [params.maxRetries=3] Bounded retry count on __v conflicts
 * @returns {Promise<{
 *   wrote: boolean,
 *   attempts: number,
 *   device: Object,
 *   prevDevice: Object,
 *   interfaces: Array,
 *   mergeResult: Object
 * }>}
 */
const applyInterfaceInventory = async ({
  deviceModel,
  deviceId,
  org,
  account,
  reportedInterfaces,
  options = {},
  maxRetries = 3
}) => {
  if (!deviceId) {
    throw new Error('deviceId is required for interface inventory reconciliation');
  }
  if (!org) {
    throw new Error('org is required for interface inventory reconciliation');
  }

  const model = deviceModel || require('../models/devices').devices;
  const baseFilter = { _id: deviceId, org };
  if (account !== undefined && account !== null && account !== '') {
    baseFilter.account = account;
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const currentDoc = await model.findOne(baseFilter);
    if (!currentDoc) {
      const err = new Error(`Device ${deviceId} not found for org ${org}`);
      err.code = 'DEVICE_NOT_FOUND';
      throw err;
    }

    const currentInterfaces = (currentDoc.interfaces || []).map(toPlainInterface);
    const mergeResult = mergeInterfaceInventory(currentInterfaces, reportedInterfaces, options);

    // Idempotent DB write: skip entirely when merged interfaces are unchanged
    if (areInterfaceListsEqual(currentInterfaces, mergeResult.interfaces)) {
      return {
        wrote: false,
        attempts: attempt + 1,
        device: currentDoc,
        prevDevice: currentDoc,
        interfaces: mergeResult.interfaces,
        mergeResult
      };
    }

    const updateFilter = {
      ...baseFilter,
      __v: typeof currentDoc.__v === 'number' ? currentDoc.__v : { $exists: false }
    };

    const updatedDoc = await model.findOneAndUpdate(
      updateFilter,
      {
        $set: { interfaces: mergeResult.interfaces },
        $inc: { __v: 1 }
      },
      { new: true, runValidators: true }
    );

    if (updatedDoc) {
      return {
        wrote: true,
        attempts: attempt + 1,
        device: updatedDoc,
        prevDevice: currentDoc,
        interfaces: mergeResult.interfaces,
        mergeResult
      };
    }
  }

  const conflictErr = new Error(
    `Concurrent modification conflict updating interfaces for device ${deviceId} after ${maxRetries + 1} attempts`
  );
  conflictErr.code = 'VERSION_CONFLICT';
  throw conflictErr;
};

module.exports = {
  isValidDevId,
  normalizeMac,
  isLinuxManagementWifi,
  dedupeReportedInterfaces,
  normalizeNewInterfaces,
  normalizeRegistrationInterfaces,
  mergeInterfaceInventory,
  areInterfaceListsEqual,
  applyInterfaceInventory
};
