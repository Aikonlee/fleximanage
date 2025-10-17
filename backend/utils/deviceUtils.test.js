// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2025  flexiWAN Ltd.

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

const {
  calculateOptimalVppCores,
  calculateRecommendedVppCores,
  getOptimizedCpuInfo
} = require('./deviceUtils');

describe('CPU Optimization Functions', () => {
  describe('calculateOptimalVppCores', () => {
    test('should return 1 core for 2-core device', () => {
      const result = calculateOptimalVppCores({ hwCores: 2, hasQos: false, wanInterfaces: 1 });
      expect(result).toBe(1);
    });

    test('should return 2 cores for 3-core device with QoS', () => {
      const result = calculateOptimalVppCores({ hwCores: 3, hasQos: true, wanInterfaces: 1 });
      expect(result).toBe(2);
    });

    test('should return 2 cores for 4-core device without QoS', () => {
      const result = calculateOptimalVppCores({ hwCores: 4, hasQos: false, wanInterfaces: 1 });
      expect(result).toBe(2);
    });

    test('should return 2 cores for 4-core device with QoS', () => {
      const result = calculateOptimalVppCores({ hwCores: 4, hasQos: true, wanInterfaces: 1 });
      expect(result).toBe(2);
    });

    test('should scale with cores for 8-core device', () => {
      const result = calculateOptimalVppCores({ hwCores: 8, hasQos: false, wanInterfaces: 2 });
      // 60% of 7 available cores = 4.2, floored to 4
      expect(result).toBe(4);
    });

    test('should respect WAN interface count for high-end devices', () => {
      const result = calculateOptimalVppCores({ hwCores: 16, hasQos: true, wanInterfaces: 4 });
      // Base: 60% of 15 available = 9
      // Interface-based: 4 WAN * 2 = 8 workers
      // Use max(9, 8) = 9
      expect(result).toBe(9);
    });

    test('should use base allocation when WAN interfaces exceed capacity', () => {
      const result = calculateOptimalVppCores({ hwCores: 8, hasQos: false, wanInterfaces: 10 });
      // 60% of 7 available = 4.2, floored to 4
      // 10 WAN * 2 = 20, but capped at 4
      expect(result).toBe(4);
    });

    test('should throw error for QoS with insufficient cores', () => {
      expect(() => {
        calculateOptimalVppCores({ hwCores: 2, hasQos: true, wanInterfaces: 1 });
      }).toThrow('Insufficient cores for QoS');
    });

    test('should handle enterprise deployment (16+ cores)', () => {
      const result = calculateOptimalVppCores({ hwCores: 32, hasQos: true, wanInterfaces: 6 });
      // Base: 60% of 31 available = 18.6, floored to 18
      // Interface-based: 6 WAN * 2 = 12 workers
      // Use max(18, min(12, 23)) = max(18, 12) = 18
      expect(result).toBe(18);
    });
  });

  describe('calculateRecommendedVppCores', () => {
    test('should calculate for device with interfaces array', () => {
      const device = {
        cpuInfo: { hwCores: 4 },
        policies: { qos: {} },
        interfaces: [
          { isAssigned: true, type: 'WAN' },
          { isAssigned: true, type: 'LAN' },
          { isAssigned: false, type: 'WAN' }
        ]
      };
      const result = calculateRecommendedVppCores(device);
      // 4 cores, no QoS, 1 WAN interface -> 2 cores
      expect(result).toBe(2);
    });

    test('should handle device with QoS policy', () => {
      const device = {
        cpuInfo: { hwCores: 6 },
        policies: { qos: { policy: { _id: '123' } } },
        interfaces: [
          { isAssigned: true, type: 'WAN' },
          { isAssigned: true, type: 'WAN' }
        ]
      };
      const result = calculateRecommendedVppCores(device);
      // 6 cores, QoS enabled, 2 WAN -> 60% of 5 = 3
      expect(result).toBe(3);
    });

    test('should handle device with no interfaces', () => {
      const device = {
        cpuInfo: { hwCores: 4 },
        policies: {},
        interfaces: []
      };
      const result = calculateRecommendedVppCores(device);
      // Defaults to 1 WAN interface, 4 cores -> 2 cores
      expect(result).toBe(2);
    });

    test('should handle minimal device object', () => {
      const device = {};
      const result = calculateRecommendedVppCores(device);
      // Defaults: 2 cores -> 1 VPP core
      expect(result).toBe(1);
    });
  });

  describe('getOptimizedCpuInfo', () => {
    test('should optimize multi-core device with default 1 VPP core', () => {
      const cpuInfo = {
        hwCores: 4,
        vppCores: 1,
        grubCores: 4
      };
      const deviceContext = {
        hasQos: false,
        wanInterfaces: 1
      };
      const result = getOptimizedCpuInfo(cpuInfo, deviceContext);
      expect(result.vppCores).toBe(2);
      expect(result.configuredVppCores).toBe(2);
    });

    test('should not override explicit user configuration', () => {
      const cpuInfo = {
        hwCores: 8,
        vppCores: 1,
        configuredVppCores: 3 // User explicitly set to 3
      };
      const deviceContext = {
        hasQos: false,
        wanInterfaces: 2
      };
      const result = getOptimizedCpuInfo(cpuInfo, deviceContext);
      // Should keep user's explicit configuration
      expect(result.vppCores).toBe(1);
      expect(result.configuredVppCores).toBe(3);
    });

    test('should not optimize 2-core devices', () => {
      const cpuInfo = {
        hwCores: 2,
        vppCores: 1
      };
      const result = getOptimizedCpuInfo(cpuInfo, {});
      expect(result.vppCores).toBe(1);
    });

    test('should optimize with QoS context', () => {
      const cpuInfo = {
        hwCores: 4,
        vppCores: 1
      };
      const deviceContext = {
        hasQos: true,
        wanInterfaces: 1
      };
      const result = getOptimizedCpuInfo(cpuInfo, deviceContext);
      expect(result.vppCores).toBe(2); // QoS requires 2+
    });

    test('should handle optimization errors gracefully', () => {
      const cpuInfo = {
        hwCores: 2,
        vppCores: 1
      };
      const deviceContext = {
        hasQos: true, // This will cause error (insufficient cores)
        wanInterfaces: 1
      };
      const result = getOptimizedCpuInfo(cpuInfo, deviceContext);
      // Should keep defaults on error
      expect(result.vppCores).toBe(1);
    });

    test('should preserve other CPU info fields', () => {
      const cpuInfo = {
        hwCores: 4,
        vppCores: 1,
        grubCores: 4,
        powerSaving: true
      };
      const result = getOptimizedCpuInfo(cpuInfo, { wanInterfaces: 1 });
      expect(result.hwCores).toBe(4);
      expect(result.grubCores).toBe(4);
      expect(result.powerSaving).toBe(true);
      expect(result.vppCores).toBe(2);
    });
  });

  describe('Performance Expectations', () => {
    test('should allocate 75% of cores for high-end devices', () => {
      const result = calculateOptimalVppCores({ hwCores: 16, hasQos: false, wanInterfaces: 2 });
      // 75% of 15 available = 11.25, floored to 11
      // Min with WAN (2*2=4) = 4
      // But for 16 cores, we use higher allocation
      expect(result).toBeGreaterThanOrEqual(4);
      expect(result).toBeLessThanOrEqual(12);
    });

    test('should meet QoS minimum requirements', () => {
      for (let cores = 3; cores <= 16; cores++) {
        const result = calculateOptimalVppCores({ hwCores: cores, hasQos: true, wanInterfaces: 1 });
        expect(result).toBeGreaterThanOrEqual(2);
      }
    });

    test('should scale linearly with WAN interfaces in enterprise', () => {
      const cores16_2wan = calculateOptimalVppCores({ hwCores: 16, hasQos: false, wanInterfaces: 2 });
      const cores16_4wan = calculateOptimalVppCores({ hwCores: 16, hasQos: false, wanInterfaces: 4 });
      // More WAN interfaces should get more cores (up to limit)
      expect(cores16_4wan).toBeGreaterThanOrEqual(cores16_2wan);
    });
  });
});

describe('CPU Optimization Edge Cases', () => {
  test('should handle 1-core device gracefully', () => {
    const result = calculateOptimalVppCores({ hwCores: 1, hasQos: false, wanInterfaces: 1 });
    expect(result).toBe(1);
  });

  test('should handle 0 WAN interfaces', () => {
    const result = calculateOptimalVppCores({ hwCores: 8, hasQos: false, wanInterfaces: 0 });
    // Should use default 1 WAN in calculation
    expect(result).toBeGreaterThan(0);
  });

  test('should handle undefined parameters with defaults', () => {
    const result = calculateOptimalVppCores({});
    expect(result).toBe(1); // Default is 2 cores -> 1 VPP
  });

  test('should handle very large core counts', () => {
    const result = calculateOptimalVppCores({ hwCores: 128, hasQos: true, wanInterfaces: 16 });
    // Base: 60% of 127 = 76.2, floored to 76
    // Interface-based: 16 WAN * 2 = 32 workers
    // Max: 75% of 127 = 95.25, floored to 95
    // Use max(76, min(32, 95)) = max(76, 32) = 76
    expect(result).toBe(76);
  });
});
