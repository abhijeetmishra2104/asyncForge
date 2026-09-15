terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # State lives on your laptop by default. To share it (or run Terraform from
  # CI later), create a bucket and uncomment this block:
  #
  #   gsutil mb -l asia-south1 gs://asyncforge-tfstate-<something-unique>
  #
  # backend "gcs" {
  #   bucket = "asyncforge-tfstate-<something-unique>"
  #   prefix = "gke"
  # }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
