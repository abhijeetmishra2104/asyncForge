# ---------------------------------------------------------------------------
# PostgreSQL, in the same region as the cluster
# ---------------------------------------------------------------------------
# The database used to be Neon in us-east-1 while the cluster runs in
# asia-south1, so every query crossed the planet: 263ms measured from a pod.
# Accepting one task makes six round trips, which put the 202 response at
# ~1,580ms. In asia-south1 a round trip is ~1-3ms.
#
# The instance has no public address. It is reachable over private services
# access from the VPC the cluster runs in, and from nowhere else.

resource "google_compute_global_address" "sql_private_range" {
  name          = "asyncforge-sql-range"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = "projects/${var.project_id}/global/networks/default"

  depends_on = [google_project_service.services]
}

resource "google_service_networking_connection" "sql_private_vpc" {
  network                 = "projects/${var.project_id}/global/networks/default"
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.sql_private_range.name]
}

resource "random_password" "db" {
  length = 32
  # The password is embedded in a URL, so keep it to characters that need no
  # percent-encoding.
  special = false
}

resource "google_sql_database_instance" "postgres" {
  name             = "asyncforge-pg"
  database_version = "POSTGRES_16"
  region           = var.region

  # Flip to true once this holds data you would be upset to lose.
  deletion_protection = false

  settings {
    # New Postgres instances default to Enterprise Plus, which only accepts the
    # db-perf-optimized tiers — far more machine than this needs.
    edition = "ENTERPRISE"

    # Shared-core, the cheapest Cloud SQL tier: ~$10/month with the disk. The
    # workload is a handful of tiny queries per job; latency comes from the
    # network, not the CPU.
    tier              = "db-f1-micro"
    availability_type = "ZONAL"
    disk_size         = 10
    disk_type         = "PD_SSD"
    disk_autoresize   = true

    ip_configuration {
      ipv4_enabled    = false
      private_network = "projects/${var.project_id}/global/networks/default"
    }

    backup_configuration {
      enabled    = true
      start_time = "18:30" # 00:00 IST
    }

    # A shared-core instance defaults to very few connections. Each service
    # also pins its own pool size in the connection string.
    database_flags {
      name  = "max_connections"
      value = "60"
    }
  }

  depends_on = [google_service_networking_connection.sql_private_vpc]
}

resource "google_sql_database" "asyncforge" {
  name     = "asyncforge"
  instance = google_sql_database_instance.postgres.name
}

resource "google_sql_user" "asyncforge" {
  name     = "asyncforge"
  instance = google_sql_database_instance.postgres.name
  password = random_password.db.result
}
