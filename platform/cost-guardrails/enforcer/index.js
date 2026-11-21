// Budget enforcer: Cloud Run function (gen2) triggered by Pub/Sub.
// Receives Cloud Billing budget notifications and hourly cluster-TTL ticks, then:
//   1. deletes GKE clusters when actual spend reaches STOP_CLUSTERS_AT of the budget,
//   2. deletes GKE clusters older than CLUSTER_MAX_HOURS,
//   3. disables billing on the project when actual spend reaches DISABLE_BILLING_AT (hard cap),
//   4. once no cluster is left, deletes GKE Gateway load balancer parts (gkegw1-*) the cluster left behind.
// In ENFORCEMENT_MODE=dry_run it only logs what it would do.
import functions from '@google-cloud/functions-framework';
import { CloudBillingClient } from '@google-cloud/billing';
import { ClusterManagerClient } from '@google-cloud/container';
import compute from '@google-cloud/compute';
import { decide, loadConfig, parsePayload, planLbSweep, GATEWAY_PREFIX } from './decide.js';

const config = loadConfig(process.env);
const billing = new CloudBillingClient();
const container = new ClusterManagerClient();

// Global load balancer parts, one client per kind, in no particular order (planLbSweep orders them).
const lbClients = {
  forwardingRule: { client: new compute.GlobalForwardingRulesClient(), key: 'forwardingRule' },
  targetHttpsProxy: { client: new compute.TargetHttpsProxiesClient(), key: 'targetHttpsProxy' },
  targetHttpProxy: { client: new compute.TargetHttpProxiesClient(), key: 'targetHttpProxy' },
  urlMap: { client: new compute.UrlMapsClient(), key: 'urlMap' },
  backendService: { client: new compute.BackendServicesClient(), key: 'backendService' },
  healthCheck: { client: new compute.HealthChecksClient(), key: 'healthCheck' },
};

async function listLbResources(projectId) {
  const lists = await Promise.all(
    Object.entries(lbClients).map(async ([kind, { client }]) => {
      const [items] = await client.list({ project: projectId, filter: `name eq ${GATEWAY_PREFIX}.*` });
      return (items ?? []).map((r) => ({ kind, name: r.name }));
    }),
  );
  return lists.flat();
}

// Deletes in the planned order and waits for each, since the next kind is in use until the previous one
// is gone. Failures are logged and skipped: the next hourly run retries whatever is left.
async function deleteLbResources(projectId, resources) {
  for (const r of resources) {
    const { client, key } = lbClients[r.kind];
    try {
      const [op] = await client.delete({ project: projectId, [key]: r.name });
      await op.promise();
      log('WARNING', 'Deleted orphaned load balancer part', { kind: r.kind, name: r.name });
    } catch (err) {
      log('ERROR', 'Failed to delete load balancer part', { kind: r.kind, name: r.name, error: err.message });
    }
  }
}

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

  const [clusters, billingEnabled, lbResources] = await Promise.all([
    listClusters(config.projectId),
    isBillingEnabled(config.projectId),
    config.sweepOrphanLbs ? listLbResources(config.projectId) : [],
  ]);
  const plan = decide({ message, clusters, billingEnabled, now: new Date(), config });
  const sweep = planLbSweep({ clusters, resources: lbResources, config });
  plan.reasons.push(...sweep.reasons);

  const summary = {
    mode: config.mode,
    kind: message.kind,
    spendRatio: plan.ratio,
    costAmount: message.costAmount,
    budgetAmount: message.budgetAmount,
    clustersFound: clusters.length,
    deleteClusters: plan.deleteClusters.map((c) => `${c.location}/${c.name}`),
    disableBilling: plan.disableBilling,
    deleteLbResources: sweep.deleteLbResources.map((r) => `${r.kind}/${r.name}`),
    reasons: plan.reasons,
  };
  const acting = plan.deleteClusters.length > 0 || plan.disableBilling || sweep.deleteLbResources.length > 0;
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

  if (sweep.deleteLbResources.length > 0) await deleteLbResources(config.projectId, sweep.deleteLbResources);

  // Last resort. Disabling billing stops every paid service in the project, including this function.
  if (plan.disableBilling) {
    await billing.updateProjectBillingInfo({
      name: `projects/${config.projectId}`,
      projectBillingInfo: { billingAccountName: '' },
    });
    log('CRITICAL', 'Billing disabled on project', { project: config.projectId });
  }
});
