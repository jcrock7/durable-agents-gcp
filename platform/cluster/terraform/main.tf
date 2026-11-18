# Cluster layer: everything that costs money by the hour.
# Created with scripts/gke/up.sh before a session and destroyed with scripts/gke/down.sh after.

# Read the foundation layer's outputs (service accounts, namespace) from its state.
data "terraform_remote_state" "foundation" {
  backend = "gcs"
  config = {
    bucket = var.state_bucket
    prefix = "foundation"
  }
}

locals {
  foundation = data.terraform_remote_state.foundation.outputs
  labels = {
    purpose    = "durable-agents"
    lifecycle  = "ephemeral"
    managed-by = "terraform"
  }
}

module "network" {
  source     = "../../modules/network"
  project_id = var.project_id
  region     = var.region
  name       = "${var.cluster_name}-vpc"
}

module "gke" {
  source              = "../../modules/gke-autopilot"
  project_id          = var.project_id
  region              = var.region
  name                = var.cluster_name
  network             = module.network.network_id
  subnetwork          = module.network.subnet_id
  pods_range_name     = module.network.pods_range_name
  services_range_name = module.network.services_range_name
  authorized_networks = var.authorized_networks
  labels              = local.labels
}

# Let each Kubernetes service account act as its Google service account (Workload Identity).
resource "google_service_account_iam_member" "workload_identity" {
  for_each           = local.foundation.workload_service_accounts
  service_account_id = "projects/${var.project_id}/serviceAccounts/${each.value.email}"
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${module.gke.workload_pool}[${local.foundation.namespace}/${each.value.ksa}]"
}

# --- Public entry point -------------------------------------------------------
# A global IP for the GKE Gateway and a Google-managed certificate for it.
# Both are released on down.sh, so an idle project doesn't pay for a reserved IP.
# The certificate only becomes ACTIVE after the Gateway points at this IP; allow 15-60 minutes.

resource "google_compute_global_address" "gateway" {
  project = var.project_id
  name    = "${var.cluster_name}-gateway-ip"
}

locals {
  hostname = var.app_hostname != "" ? var.app_hostname : "${replace(google_compute_global_address.gateway.address, ".", "-")}.sslip.io"
}

resource "google_compute_managed_ssl_certificate" "gateway" {
  project = var.project_id
  name    = "${var.cluster_name}-cert"

  managed {
    domains = [local.hostname]
  }
}
