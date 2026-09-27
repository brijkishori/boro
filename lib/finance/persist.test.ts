import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readAlertConfig, readBenchmark, readScenario, readStressRates } from './persist';

test('missing personal inputs stay empty on the server', () => {
  assert.equal(readBenchmark(), null);
  assert.equal(readScenario(), null);
  assert.deepEqual(readAlertConfig(), { warningBufferBps: 100, criticalBufferBps: 0 });
  assert.ok(readStressRates().length > 0);
});
