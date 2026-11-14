// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2021  flexiWAN Ltd.

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

// Module for deviceQueues Unit Test
process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379/15';
process.env.KUE_PREFIX = 'legacy-test-' + process.pid + '-' + Date.now();
var configs = require('../../configs')();
var deviceQueues = require('../deviceQueue')(configs.get('kuePrefix'), configs.get('redisUrl'));
const logger = require('../../logging/logging')({ module: module.filename, type: 'unit-test' });

describe('Initialization', () => {
  afterAll(async () => {
    // Kue shutdown does not clear the interval installed by watchStuckJobs.
    clearInterval(deviceQueues.queue.stuck_job_watch);
    await new Promise((resolve, reject) => {
      deviceQueues.queue.shutdown(5000, error => error ? reject(error) : resolve());
    });
    const client = require('redis').createClient(configs.get('redisUrl'));
    const call = (method, ...args) => new Promise((resolve, reject) => {
      client[method](...args, (error, result) => error ? reject(error) : resolve(result));
    });
    try {
      let cursor = '0';
      do {
        const [next, keys] = await call('scan', cursor, 'MATCH', process.env.KUE_PREFIX + ':*', 'COUNT', 100);
        cursor = next;
        if (keys.length) await call('del', keys);
      } while (cursor !== '0');
    } finally { await call('quit'); }
  });

  test('Starting queue, adding and processing a job, remove on complete', async () => {
    let complete;
    const completion = new Promise(resolve => { complete = resolve; });
    let err;
    try {
      await deviceQueues.startQueue('AAA', async (rjob) => {
        logger.verbose('Processing job ID=' + rjob.id + ', data=' + JSON.stringify(rjob.data));
        expect(job.data).toEqual({
          message: { testdata: 'AAA1' },
          response: { resp: 'RRR1' },
          metadata: {
            target: 'AAA',
            username: 'unknown',
            org: 'unknown',
            init: false,
            jobUpdated: false
          }
        });
        expect(rjob.id).toBe(job.id);
        return true;
      });
    } catch (e) {
      err = e;
    }
    expect(err).toEqual(undefined);
    const job = await deviceQueues.addJob('AAA', null, null, { testdata: 'AAA1' }, { resp: 'RRR1' },
      { priority: 'normal', attempts: 1, removeOnComplete: true },
      (jobid, res) => {
        logger.verbose('Job completed, res=' + JSON.stringify(res));
        expect(res).toEqual({ resp: 'RRR1' });
        complete();
      });
    logger.verbose('Job ID = ' + job.id);
    await completion;
  });

  test('Starting queue, adding and processing a job, keep on complete', async () => {
    let complete;
    const completion = new Promise(resolve => { complete = resolve; });
    let err;
    try {
      await deviceQueues.startQueue('BBB', async (rjob) => {
        logger.verbose('Processing job ID=' + rjob.id + ', data=' + JSON.stringify(rjob.data));
        expect(job.data).toEqual({
          message: { testdata: 'BBB1' },
          response: 1,
          metadata: {
            target: 'BBB',
            username: 'user1',
            org: '4edd40c86762e0fb12000001',
            init: false,
            jobUpdated: false
          }
        });
        expect(rjob.id).toBe(job.id);
        return true;
      });
    } catch (e) {
      err = e;
    }
    expect(err).toEqual(undefined);
    const job = await deviceQueues.addJob(
      'BBB',
      'user1',
      '4edd40c86762e0fb12000001',
      { testdata: 'BBB1' },
      1,
      { priority: 'normal', attempts: 1, removeOnComplete: false },
      (jobid, res) => {
        logger.verbose('Job completed, res=' + JSON.stringify(res));
        expect(res).toBe(1);
        complete();
      }
    );
    logger.verbose('Job ID = ' + job.id);
    await completion;
  });

  test('Checking completed jobs', async () => {
    let complete;
    const completion = new Promise(resolve => { complete = resolve; });
    const c = await deviceQueues.getCount('complete');
    expect(c).toBe(1);
    await deviceQueues.iterateJobs('complete', (rjob) => {
      expect(rjob.data.message.testdata).toBe('BBB1');
    });
    complete();
    await completion;
  });

  test('Check completed by org', async () => {
    let complete;
    const completion = new Promise(resolve => { complete = resolve; });
    await deviceQueues.iterateJobsByOrg('4edd40c86762e0fb12000001', 'complete', (rjob) => {
      expect(rjob.data.message.testdata).toBe('BBB1');
    });
    complete();
    await completion;
  });

  test('Add two more jobs to Org', async () => {
    let complete;
    const completion = new Promise(resolve => { complete = resolve; });
    let err;
    try {
      await deviceQueues.startQueue('DDD', async (rjob) => {
        logger.verbose('Processing job ID=' + rjob.id + ', data=' + JSON.stringify(rjob.data));
        return true;
      });
    } catch (e) {
      err = e;
    }
    expect(err).toEqual(undefined);
    const job1 = await deviceQueues.addJob(
      'DDD',
      'user1',
      '4edd40c86762e0fb12000001',
      { testdata: 'DDD1' },
      1,
      { priority: 'normal', attempts: 1, removeOnComplete: false },
      (jobid, res) => {
        logger.verbose('Job completed, res=' + JSON.stringify(res));
        expect(res).toBe(1);
      }
    );
    const job2 = await deviceQueues.addJob(
      'DDD',
      'user1',
      '4edd40c86762e0fb12000001',
      { testdata: 'DDD2' },
      1,
      { priority: 'normal', attempts: 1, removeOnComplete: false },
      (jobid, res) => {
        logger.verbose('Job completed, res=' + JSON.stringify(res));
        expect(res).toBe(1);
        complete();
      }
    );
    logger.verbose('Job IDs = ' + [job1.id, job2.id]);
    await completion;
  });

  test('Checking completed jobs2', async () => {
    let complete;
    const completion = new Promise(resolve => { complete = resolve; });
    const testDataList = ['BBB1', 'DDD1', 'DDD2'];
    const testDataResult = [];
    const c = await deviceQueues.getCount('complete');
    expect(c).toBe(3);
    await deviceQueues.iterateJobs('complete', (rjob) => {
      testDataResult.push(rjob.data.message.testdata);
    });
    expect(testDataResult).toStrictEqual(testDataList);
    complete();
    await completion;
  });

  test('Checking completed jobs2, desc order', async () => {
    let complete;
    const completion = new Promise(resolve => { complete = resolve; });
    const testDataList = ['BBB1', 'DDD1', 'DDD2'];
    const testDataResult = [];
    const c = await deviceQueues.getCount('complete');
    expect(c).toBe(3);
    await deviceQueues.iterateJobs('complete', (rjob) => {
      testDataResult.push(rjob.data.message.testdata);
      return true;
    }, null, 0, -1, 'desc', -1);
    expect(testDataResult).toStrictEqual(testDataList.reverse());
    complete();
    await completion;
  });

  test('Checking completed jobs2, limit', async () => {
    let complete;
    const completion = new Promise(resolve => { complete = resolve; });
    const testDataList = ['BBB1', 'DDD1'];
    const testDataResult = [];
    const c = await deviceQueues.getCount('complete');
    expect(c).toBe(3);
    await deviceQueues.iterateJobs('complete', (rjob) => {
      testDataResult.push(rjob.data.message.testdata);
      return true;
    }, null, 0, -1, 'asc', 2);
    expect(testDataResult).toStrictEqual(testDataList);
    complete();
    await completion;
  });

  test('Check completed by org, skip, limit', async () => {
    let complete;
    const completion = new Promise(resolve => { complete = resolve; });
    const testDataList = ['BBB1', 'DDD1', 'DDD2'];
    let testDataResult = [];
    await deviceQueues.iterateJobsByOrg('4edd40c86762e0fb12000001', 'complete', (rjob) => {
      testDataResult.push(rjob.data.message.testdata);
      return true;
    }, 0, -1, 'desc', 1, 2);
    expect(testDataResult).toStrictEqual(testDataList.slice(0, 2).reverse());
    testDataResult = [];
    await deviceQueues.iterateJobsByOrg('4edd40c86762e0fb12000001', 'complete', (rjob) => {
      testDataResult.push(rjob.data.message.testdata);
      return true;
    }, 0, -1, 'desc', 0, 2);
    expect(testDataResult).toStrictEqual(testDataList.slice(-2).reverse());
    complete();
    await completion;
  });
  test('Check completed by org, device filter', async () => {
    let complete;
    const completion = new Promise(resolve => { complete = resolve; });
    const testDataList = ['BBB1', 'DDD1', 'DDD2'];
    let testDataResult = [];
    await deviceQueues.iterateJobsByOrg('4edd40c86762e0fb12000001', 'complete', (rjob) => {
      testDataResult.push(rjob.data.message.testdata);
      return true;
    }, 0, -1, 'desc', 0, -1, [{ key: 'type', op: '==', val: 'BBB' }]);
    expect(testDataResult).toStrictEqual(testDataList.slice(0, 1).reverse());
    testDataResult = [];
    await deviceQueues.iterateJobsByOrg('4edd40c86762e0fb12000001', 'complete', (rjob) => {
      testDataResult.push(rjob.data.message.testdata);
      return true;
    }, 0, -1, 'desc', 0, -1, [{ key: 'type', op: '==', val: 'DDD' }]);
    expect(testDataResult).toStrictEqual(testDataList.slice(-2).reverse());
    complete();
    await completion;
  });

  test('Get last job', async () => {
    let complete;
    const completion = new Promise(resolve => { complete = resolve; });
    let lastJob;
    lastJob = await deviceQueues.getLastJob('BBB');
    expect(lastJob.data.message.testdata).toBe('BBB1');
    lastJob = await deviceQueues.getLastJob('DDD');
    expect(lastJob.data.message.testdata).toBe('DDD2');
    complete();
    await completion;
  });
  test('Removing completed jobs', async () => {
    await deviceQueues.removeJobs('complete', 0);
    const c = await deviceQueues.getCount('complete');
    expect(c).toBe(0);
  });

  test('Pause / Resume', async () => {
    let complete;
    const completion = new Promise(resolve => { complete = resolve; });
    let err;
    try {
      await deviceQueues.startQueue('CCC', async (rjob) => {
        logger.verbose('Processing job ID=' + rjob.id + ', data=' + JSON.stringify(rjob.data));
        expect(job.data).toEqual({
          message: { testdata: 'CCC1' },
          response: true,
          metadata: {
            target: 'CCC',
            username: 'user2',
            org: '4edd40c86762e0fb12000002',
            init: false,
            jobUpdated: false
          }
        });
        expect(rjob.id).toBe(job.id);
        return true;
      });
    } catch (e) {
      err = e;
    }
    expect(err).toEqual(undefined);
    deviceQueues.pauseQueue('CCC');
    const job = await deviceQueues.addJob(
      'CCC',
      'user2',
      '4edd40c86762e0fb12000002',
      { testdata: 'CCC1' },
      true,
      { priority: 'normal', attempts: 1, removeOnComplete: true },
      (jobid, res) => {
        logger.verbose('Job completed, res=' + JSON.stringify(res));
        expect(res).toBe(true);
        complete();
      }
    );
    logger.verbose('Job ID = ' + job.id);
    let c = await deviceQueues.getCount('inactive');
    expect(c).toBe(1);
    c = await deviceQueues.getOPendingJobsCount('CCC');
    expect(c).toBe(1);
    c = await deviceQueues.getOPendingJobsCount('DDD');
    expect(c).toBe(0);
    deviceQueues.resumeQueue('CCC');
    await completion;
  });
});
