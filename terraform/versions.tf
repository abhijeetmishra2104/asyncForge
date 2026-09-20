terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State lives in GCS, not on a laptop. It holds the Cloud SQL password and is
  # the only record of what this project owns, so losing it means losing the
  # ability to manage any of it. The bucket has object versioning on, which
  # keeps every previous state as a recoverable generation.
  backend "gcs" {
    bucket = "asyncforge-tfstate-9ff918"
    prefix = "gke"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
