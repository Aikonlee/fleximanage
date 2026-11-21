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

const { deviceStats } = require('../analytics/deviceStats');
const mongoose = require('mongoose');

let deviceStatsFullSchema;

beforeEach(() => {
  // eslint-disable-next-line new-cap
  deviceStatsFullSchema = new deviceStats({
    org: new mongoose.Types.ObjectId('4edd40c86762e0fb12000001'),
    device: new mongoose.Types.ObjectId('4edd40c86762e0fb12000003'),
    time: 1
  });
});

describe('Minimal required deviceStats schema', () => {
  it('Should be a valid deviceStats model if all required fields are present', () => {
    return deviceStatsFullSchema.validate().then(() => null, error => error).then((err) => {
      expect(err).toBe(null);
    });
  });

  it('Should be an invalid deviceStats model if org field is missing', () => {
    deviceStatsFullSchema.org = null;

    return deviceStatsFullSchema.validate().then(() => null, error => error).then((err) => {
      expect(err.message).toBe('deviceStats validation failed: org: Path `org` is required.');
    });
  });
});

describe('Token schema', () => {
  it('Should be a valid deviceStats model if all required fields are valid', () => {
    return deviceStatsFullSchema.validate().then(() => null, error => error).then((err) => {
      expect(err).toBe(null);
    });
  });

  it('Should be an invalid deviceStats model if org field is invalid', () => {
    deviceStatsFullSchema.org = 'invalid-org';

    return deviceStatsFullSchema.validate().then(() => null, error => error).then((err) => {
      expect(err.errors.org).toMatchObject({ name: 'CastError', kind: 'ObjectId', path: 'org', value: 'invalid-org' });
    });
  });
});
