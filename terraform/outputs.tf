output "cluster_name" {
  description = "Pass this to `gcloud container clusters get-credentials`."
  value       = google_container_cluster.autopilot.name
}

output "cluster_location" {
  value = google_container_cluster.autopilot.location
}

output "image_repository" {
  description = "Prefix for every image. Images are pushed as <this>/web:<sha>, /worker:<sha>, /dispatcher:<sha>."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

output "workload_identity_provider" {
  description = "GitHub Actions secret GCP_WORKLOAD_IDENTITY_PROVIDER."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "deployer_service_account" {
  description = "GitHub Actions secret GCP_SERVICE_ACCOUNT."
  value       = google_service_account.deployer.email
}

output "github_actions_setup" {
  description = "Everything you need to paste into GitHub, in one place."
  value       = <<-EOT

    Repository variables (Settings > Secrets and variables > Actions > Variables):
      GCP_PROJECT_ID    = ${var.project_id}
      GCP_REGION        = ${var.region}
      GKE_CLUSTER       = ${google_container_cluster.autopilot.name}
      AR_REPOSITORY     = ${google_artifact_registry_repository.images.repository_id}

    Repository secrets (same page, Secrets tab):
      GCP_WORKLOAD_IDENTITY_PROVIDER = ${google_iam_workload_identity_pool_provider.github.name}
      GCP_SERVICE_ACCOUNT            = ${google_service_account.deployer.email}
      DATABASE_URL                   = <your Neon connection string>
      RABBITMQ_URL                   = <your CloudAMQP amqps:// URL>
      GEMINI_API_KEY                 = <your Gemini key>
  EOT
}

output "web_static_ip" {
  description = "Point app.asyncforge.me at this. Pinned in patch-web-service.yaml."
  value       = google_compute_address.web.address
}

output "database_private_ip" {
  description = "Private IP of the Cloud SQL instance. Reachable only from the VPC."
  value       = google_sql_database_instance.postgres.private_ip_address
}

output "database_url" {
  description = <<-EOT
    Set this as the DATABASE_URL GitHub secret. connection_limit keeps three
    services' Prisma pools inside the instance's 60 connections.
  EOT
  value       = "postgresql://asyncforge:${random_password.db.result}@${google_sql_database_instance.postgres.private_ip_address}:5432/asyncforge?connection_limit=5"
  sensitive   = true
}
