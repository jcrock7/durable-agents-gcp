# Module: gke-autopilot
# A regional GKE Autopilot cluster with private nodes, Workload Identity (always on in Autopilot),
# the Gateway API, and the Secret Manager add-on. See docs/adr/0014-gke-autopilot-spot.md.

resource "google_container_cluster" "this" {
  project  = var.project_id
  name     = var.name
  location = var.region # Autopilot clusters are regional

  enable_autopilot = true

  network    = var.network
  subnetwork = var.subnetwork

  ip_allocation_policy {
    cluster_secondary_range_name  = var.pods_range_name
    services_secondary_range_name = var.services_range_name
  }

  # Nodes get no public IPs; the control plane keeps a public endpoint limited to authorized networks.
  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
  }

  master_authorized_networks_config {
    dynamic "cidr_blocks" {
      for_each = var.authorized_networks
      content {
        cidr_block   = cidr_blocks.value.cidr
        display_name = cidr_blocks.value.name
      }
    }
  }

  release_channel {
    channel = var.release_channel
  }

  gateway_api_config {
    channel = "CHANNEL_STANDARD"
  }

  secret_manager_config {
    enabled = true
  }

  # Metrics: system components only. Autopilot otherwise also collects the cAdvisor/kubelet/
  # kube-state packages, billed as Prometheus samples (about $0.02/hr on the first session, the
  # largest line item). Nothing here reads them: the portal uses Temporal, LiteLLM and the
  # Kubernetes API, and ADR-0008 uses Cloud Logging/Trace/Monitoring. Managed Prometheus itself
  # can't be turned off on Autopilot (GKE 1.25+); with no PodMonitoring resources it ingests nothing.
  monitoring_config {
    enable_components = ["SYSTEM_COMPONENTS"]
    managed_prometheus {
      enabled = true
    }
  }

  resource_labels = var.labels

  # This cluster is meant to be destroyed after every session.
  deletion_protection = false
}
