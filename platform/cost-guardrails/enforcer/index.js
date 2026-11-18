// Budget enforcer: Cloud Run function (gen2) triggered by Pub/Sub.
// Receives Cloud Billing budget notifications and hourly cluster-TTL ticks, then:
//   1. deletes GKE clusters when actual spend reaches STOP_CLUSTERS_AT of the budget,
//   2. deletes GKE clusters older than CLUSTER_MAX_HOURS,
//   3. disables billing on the project when actual spend reaches DISABLE_BILLING_AT (hard cap).
// In ENFORCEMENT_MODE=dry_run it only logs what it would do.
import functions from '@google-cloud/functions-framework';
import { CloudBillingClient } from '@google-cloud/billing';
import { ClusterManagerClient } from '@google-cloud/container';
import { decide, loadConfig, parsePayload } from './decide.js';

const config = loadConfig(process.env);
const billing = new CloudBillingClient();
const container = new ClusterManagerClient();

// Structured logs: Cloud Logging parses JSON written to stdout.
const log = (severity, message, fields = {}) =>
  console.log(JSON.stringify({ severity, message, component: 'budget-enforcer', ...fields }));

function readPayload(cloudEvent) {
  const data = cloudEvent?.data?.message?.data;
  if (!data) return null;
  try {
    return JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

async function listClusters(projectId) {
  const [res] = await container.listClusters({ parent: `projects/${projectId}/locations/-` });
  return (res.clusters ?? []).map((c) => ({
    name: c.name,
    location: c.location,
    status: String(c.status),
    createTime: c.createTime,
  }));
}

async function isBillingEnabled(projectId) {
  const [info] = await billing.getProjectBillingInfo({ name: `projects/${projectId}` });
  return Boolean(info.billingEnabled);
}

functions.cloudEvent('enforceBudget', async (cloudEvent) => {
  const message = parsePayload(readPayload(cloudEvent));
  if (message.kind === 'unknown') {
    log('WARNING', 'Ignoring message with unrecognised payload');
    return;
  }

  const [clusters, billingEnabled] = await Promise.all([
    listClusters(config.projectId),
    isBillingEnabled(config.projectId),
  ]);
  const plan = decide({ message, clusters, billingEnabled, now: new Date(), config });

  const summary = {
    mode: config.mode,
    kind: message.kind,
    spendRatio: plan.ratio,
    costAmount: message.costAmount,
    budgetAmount: message.budgetAmount,
    clustersFound: clusters.length,
    deleteClusters: plan.deleteClusters.map((c) => `${c.location}/${c.name}`),
    disableBilling: plan.disableBilling,
    reasons: plan.reasons,
  };
  const acting = plan.deleteClusters.length > 0 || plan.disableBilling;
  log(acting ? 'NOTICE' : 'INFO', acting ? 'Budget guardrail triggered' : 'Within limits', summary);

  if (!acting) return;
  if (config.mode !== 'enforce') {
    log('NOTICE', 'Dry run: no changes made. Set ENFORCEMENT_MODE=enforce to act.', summary);
    return;
  }

  for (const c of plan.deleteClusters) {
    const name = `projects/${config.projectId}/locations/${c.location}/clusters/${c.name}`;
    try {
      await container.deleteCluster({ name });
      log('WARNING', 'Deleting GKE cluster', { cluster: name });
    } catch (err) {
      log('ERROR', 'Failed to delete GKE cluster', { cluster: name, error: err.message });
    }
  }

  // Last resort. Disabling billing stops every paid service in the project, including this function.
  if (plan.disableBilling) {
    await billing.updateProjectBillingInfo({
      name: `projects/${config.projectId}`,
      projectBillingInfo: { billingAccountName: '' },
    });
    log('CRITICAL', 'Billing disabled on project', { project: config.projectId });
  }
});
