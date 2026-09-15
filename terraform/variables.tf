variable "project_id" {
  description = "GCP project ID that holds the cluster and the image registry."
  type        = string
}

variable "region" {
  description = "Region for the Autopilot cluster and Artifact Registry. Autopilot clusters are always regional."
  type        = string
  default     = "asia-south1"
}

variable "cluster_name" {
  description = "Name of the GKE Autopilot cluster."
  type        = string
  default     = "asyncforge"
}

variable "repository_id" {
  description = "Artifact Registry repository that holds the web/worker/dispatcher images."
  type        = string
  default     = "asyncforge"
}

variable "github_repository" {
  description = "GitHub repo allowed to deploy, as \"owner/name\". Only this repo can mint tokens for the deployer service account."
  type        = string
}
