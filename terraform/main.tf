# ---------------------------------------------------------------------------
# APIs
# ---------------------------------------------------------------------------
# A fresh project has almost everything switched off. Enabling an API is free;
# we keep them enabled on destroy so a later `terraform apply` is not slowed
# down by re-enabling them.

resource "google_project_service" "services" {
  for_each = toset([
    "container.googleapis.com",
    "artifactregistry.googleapis.com",
    "compute.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "monitoring.googleapis.com",
    "sqladmin.googleapis.com",
    "servicenetworking.googleapis.com",
  ])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# ---------------------------------------------------------------------------
# Image registry
# ---------------------------------------------------------------------------

resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = var.repository_id
  format        = "DOCKER"
  description   = "AsyncForge web / worker / dispatcher images"

  # Old commits pile up fast when every push is tagged with a git SHA.
  # KEEP policies win over DELETE ones, so this reads as: bin anything older
  # than 30 days, except the 10 most recent versions of each image.
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }

  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      older_than = "2592000s" # 30 days
    }
  }

  depends_on = [google_project_service.services]
}

# ---------------------------------------------------------------------------
# GKE Autopilot
# ---------------------------------------------------------------------------
# Autopilot bills per Pod request rather than per node, so the cost of this
# cluster is driven entirely by the requests set in kubernetes/overlays/gcp.
# One Autopilot cluster per billing account is covered by the GKE free tier.

resource "google_container_cluster" "autopilot" {
  name             = var.cluster_name
  location         = var.region
  enable_autopilot = true

  # Flip to true once this is something you would be upset to lose.
  deletion_protection = false

  # Required for Autopilot: VPC-native networking with GKE-managed ranges.
  ip_allocation_policy {}

  release_channel {
    channel = "REGULAR"
  }

  depends_on = [google_project_service.services]
}

# Autopilot nodes run as the default Compute Engine service account. It needs
# to be able to pull from Artifact Registry.
data "google_compute_default_service_account" "default" {
  depends_on = [google_project_service.services]
}

resource "google_artifact_registry_repository_iam_member" "nodes_can_pull" {
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${data.google_compute_default_service_account.default.email}"
}

# ---------------------------------------------------------------------------
# Static IP for the web LoadBalancer
# ---------------------------------------------------------------------------
# Without a reservation the LoadBalancer gets an ephemeral address, which is
# released whenever the Service (or the whole cluster) is torn down — and any
# DNS record pointing at it goes stale. Reserving it means the teardown /
# recreate cycle keeps the same address, so app.asyncforge.me stays valid.
#
# kubernetes/overlays/gcp/patch-web-service.yaml pins spec.loadBalancerIP to
# this address so a recreated Service reclaims it.

resource "google_compute_address" "web" {
  name   = "asyncforge-web"
  region = var.region

  depends_on = [google_project_service.services]
}

# ---------------------------------------------------------------------------
# Keyless deploys from GitHub Actions (Workload Identity Federation)
# ---------------------------------------------------------------------------
# GitHub Actions gets a short-lived OIDC token from GitHub, trades it for a
# Google access token, and impersonates the deployer service account. No JSON
# key is ever created, downloaded, or stored in the repo.

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github-pool"
  display_name              = "GitHub Actions"

  depends_on = [google_project_service.services]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-provider"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
  }

  # Without this condition Google refuses to create the provider, and any
  # repo on GitHub could request a token.
  attribute_condition = "assertion.repository == '${var.github_repository}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "deployer" {
  account_id   = "asyncforge-deployer"
  display_name = "AsyncForge GitHub Actions deployer"
}

# Only workflows running in your repo may impersonate the deployer.
resource "google_service_account_iam_member" "deployer_wif" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

# Push images...
resource "google_artifact_registry_repository_iam_member" "deployer_can_push" {
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.deployer.email}"
}

# ...and talk to the cluster's Kubernetes API. container.developer covers
# get-credentials plus full read/write on workloads, but cannot change the
# cluster itself — that stays Terraform's job.
resource "google_project_iam_member" "deployer_gke" {
  project = var.project_id
  role    = "roles/container.developer"
  member  = "serviceAccount:${google_service_account.deployer.email}"
}
