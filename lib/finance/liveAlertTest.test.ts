import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('../../app/api/alerts/test/route.ts', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../../components/AlertSettings.tsx', import.meta.url), 'utf8');

test('user-facing test alerts do not use sample alert fixtures', () => {
  assert.equal(route.includes('sampleAlertByKind'), false);
  assert.equal(route.includes('sampleAlertEmails'), false);
  assert.equal(route.includes('sampleFacts'), false);
});

test('live test route requires strict fresh rate loading', () => {
  assert.match(route, /getRates\(\{\s*bypassCache:\s*true,\s*strict:\s*true,?\s*\}\)/s);
});

test('live test route reads current on-chain positions', () => {
  assert.match(route, /readPosition\(venue, address\)/);
  assert.match(route, /NO_OPEN_LOAN/);
});

test('refinance remains qualification-gated and never manufactures an opportunity', () => {
  assert.match(route, /evaluateLiveRefinanceOpportunity/);
  assert.match(route, /NO_QUALIFIED_REFINANCE_OPPORTUNITY/);
});

test('weekly and monthly tests use the tracked ledger rather than sample accounting data', () => {
  assert.match(route, /sanitizeDocument\(await storeJson\(auditStoreKey\(address\)\)\)\.events/);
  assert.match(route, /summarizeEpisodePeriod/);
  assert.match(route, /digestLines/);
});

test('settings UI labels these as live-data tests', () => {
  assert.match(settings, /Live-data email tests/);
  assert.match(settings, /Send all live tests/);
  assert.match(settings, /current on-chain position and fresh market data/);
});
