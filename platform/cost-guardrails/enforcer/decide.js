// Pure decision logic for the budget enforcer. No GCP calls here, so it can be unit-tested.

const MODES = ['dry_run', 'enforce'];

export function loadConfig(env) {
  const num = (key, fallback) => {
    const raw = env[key];
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${key} must be a non-negative number, got "${raw}"`);
    return n;
  };

  const projectId = env.PROJECT_ID;
  if (!projectId) throw new Error('PROJECT_ID is required');

  const mode = env.ENFORCEMENT_MODE || 'dry_run';
  if (!MODES.includes(mode)) throw new Error(`ENFORCEMENT_MODE must be one of ${MODES.join(', ')}, got "${mode}"`);

  return {
    projectId,
    mode,
    // Fractions of the monthly budget (1.0 = 100%). 0 disables that action.
    stopClustersAt: num('STOP_CLUSTERS_AT', 1.0),
    disableBillingAt: num('DISABLE_BILLING_AT', 1.2),
    // Delete any GKE cluster older than this many hours. 0 disables the check.
    clusterMaxHours: num('CLUSTER_MAX_HOURS', 8),
  };
}

// Turns a Pub/Sub message payload into a typed message.
// Budget notifications carry costAmount/budgetAmount; the scheduler sends {"kind":"cluster-ttl"}.
export function parsePayload(payload) {
  if (payload && typeof payload.costAmount === 'number' && typeof payload.budgetAmount === 'number') {
    return {
      kind: 'budget',
      costAmount: payload.costAmount,
      budgetAmount: payload.budgetAmount,
      budgetName: payload.budgetDisplayName ?? '',
      alertThresholdExceeded: payload.alertThresholdExceeded ?? null,
      forecastThresholdExceeded: payload.forecastThresholdExceeded ?? null,
    };
  }
  if (payload && payload.kind === 'cluster-ttl') return { kind: 'cluster-ttl' };
  return { kind: 'unknown' };
}

const clusterKey = (c) => `${c.location}/${c.name}`;

export function decide({ message, clusters, billingEnabled, now, config }) {
  const reasons = [];
  const toDelete = new Map();
  let disableBilling = false;
  let ratio = null;

  const live = clusters.filter((c) => c.status !== 'STOPPING');

  if (message.kind === 'budget') {
    ratio = message.budgetAmount > 0 ? message.costAmount / message.budgetAmount : 0;
    const pct = `${(ratio * 100).toFixed(1)}%`;

    if (config.stopClustersAt > 0 && ratio >= config.stopClustersAt && live.length > 0) {
      live.forEach((c) => toDelete.set(clusterKey(c), c));
      reasons.push(`actual spend is ${pct} of budget (stop threshold ${config.stopClustersAt * 100}%): delete clusters`);
    }
    if (config.disableBillingAt > 0 && ratio >= config.disableBillingAt && billingEnabled) {
      disableBilling = true;
      reasons.push(`actual spend is ${pct} of budget (hard cap ${config.disableBillingAt * 100}%): disable billing`);
    }
  }

  // Cluster time-to-live runs on every message, so a forgotten cluster is caught by the hourly scheduler
  // and by every budget notification.
  if (config.clusterMaxHours > 0) {
    for (const c of live) {
      const created = Date.parse(c.createTime);
      if (Number.isNaN(created)) continue;
      const ageHours = (now.getTime() - created) / 3_600_000;
      if (ageHours > config.clusterMaxHours && !toDelete.has(clusterKey(c))) {
        toDelete.set(clusterKey(c), c);
        reasons.push(`cluster ${clusterKey(c)} is ${ageHours.toFixed(1)}h old (limit ${config.clusterMaxHours}h): delete`);
      }
    }
  }

  return { ratio, deleteClusters: [...toDelete.values()], disableBilling, reasons };
}
