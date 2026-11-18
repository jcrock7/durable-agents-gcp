import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, loadConfig, parsePayload } from './decide.js';

const config = { projectId: 'p', mode: 'dry_run', stopClustersAt: 1.0, disableBillingAt: 1.2, clusterMaxHours: 8 };
const now = new Date('2026-11-17T12:00:00Z');
const young = { name: 'agents-demo', location: 'us-central1', status: 'RUNNING', createTime: '2026-11-17T10:00:00Z' };
const old = { name: 'forgotten', location: 'us-central1', status: 'RUNNING', createTime: '2026-11-16T12:00:00Z' };
const budget = (costAmount, budgetAmount = 25) => ({ kind: 'budget', costAmount, budgetAmount });

test('under budget with a young cluster: no action', () => {
  const plan = decide({ message: budget(10), clusters: [young], billingEnabled: true, now, config });
  assert.equal(plan.deleteClusters.length, 0);
  assert.equal(plan.disableBilling, false);
  assert.equal(plan.ratio, 0.4);
});

test('at 100% actual spend: delete clusters, keep billing', () => {
  const plan = decide({ message: budget(25), clusters: [young], billingEnabled: true, now, config });
  assert.deepEqual(plan.deleteClusters.map((c) => c.name), ['agents-demo']);
  assert.equal(plan.disableBilling, false);
});

test('at 120% actual spend: delete clusters and disable billing', () => {
  const plan = decide({ message: budget(30), clusters: [young], billingEnabled: true, now, config });
  assert.equal(plan.deleteClusters.length, 1);
  assert.equal(plan.disableBilling, true);
});

test('billing already disabled is not disabled again', () => {
  const plan = decide({ message: budget(40), clusters: [], billingEnabled: false, now, config });
  assert.equal(plan.disableBilling, false);
});

test('clusters already stopping are skipped', () => {
  const plan = decide({ message: budget(30), clusters: [{ ...young, status: 'STOPPING' }], billingEnabled: true, now, config });
  assert.equal(plan.deleteClusters.length, 0);
});

test('cluster older than the TTL is deleted on a scheduler message', () => {
  const plan = decide({ message: { kind: 'cluster-ttl' }, clusters: [young, old], billingEnabled: true, now, config });
  assert.deepEqual(plan.deleteClusters.map((c) => c.name), ['forgotten']);
});

test('a cluster is listed once even when both rules match', () => {
  const plan = decide({ message: budget(25), clusters: [old], billingEnabled: true, now, config });
  assert.equal(plan.deleteClusters.length, 1);
});

test('thresholds set to 0 turn actions off', () => {
  const off = { ...config, stopClustersAt: 0, disableBillingAt: 0, clusterMaxHours: 0 };
  const plan = decide({ message: budget(100), clusters: [old], billingEnabled: true, now, config: off });
  assert.equal(plan.deleteClusters.length, 0);
  assert.equal(plan.disableBilling, false);
});

test('a zero budget amount never divides by zero', () => {
  const plan = decide({ message: budget(5, 0), clusters: [], billingEnabled: true, now, config });
  assert.equal(plan.ratio, 0);
});

test('parsePayload recognises budget, ttl and unknown messages', () => {
  assert.equal(parsePayload({ costAmount: 1, budgetAmount: 25, budgetDisplayName: 'b' }).kind, 'budget');
  assert.equal(parsePayload({ kind: 'cluster-ttl' }).kind, 'cluster-ttl');
  assert.equal(parsePayload({ hello: 'world' }).kind, 'unknown');
  assert.equal(parsePayload(null).kind, 'unknown');
});

test('loadConfig applies defaults and rejects bad values', () => {
  const c = loadConfig({ PROJECT_ID: 'p' });
  assert.equal(c.mode, 'dry_run');
  assert.equal(c.stopClustersAt, 1.0);
  assert.equal(c.disableBillingAt, 1.2);
  assert.throws(() => loadConfig({}), /PROJECT_ID/);
  assert.throws(() => loadConfig({ PROJECT_ID: 'p', ENFORCEMENT_MODE: 'yolo' }), /ENFORCEMENT_MODE/);
  assert.throws(() => loadConfig({ PROJECT_ID: 'p', STOP_CLUSTERS_AT: 'abc' }), /STOP_CLUSTERS_AT/);
});
