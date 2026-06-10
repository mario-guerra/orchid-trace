terraform {
  required_version = ">= 1.0.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.gcp_project
  region  = var.gcp_region
  zone    = var.gcp_zone
}

variable "gcp_project" {
  type        = string
  description = "The Google Cloud Project ID."
}

variable "gcp_region" {
  type        = string
  default     = "us-central1"
  description = "The GCP region to deploy resources."
}

variable "gcp_zone" {
  type        = string
  default     = "us-central1-a"
  description = "The GCP zone to deploy resources."
}

variable "machine_type" {
  type        = string
  default     = "e2-micro" # 2 vCPU (shared), 1 GB RAM (~$7/month)
  description = "The VM machine type."
}

variable "orchid_api_key" {
  type        = string
  sensitive   = true
  description = "The secure API key for the proxy container authentication."
}

# 1. VPC Network
resource "google_compute_network" "vpc" {
  name                    = "orchid-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "subnet" {
  name          = "orchid-subnet"
  ip_cidr_range = "10.0.1.0/24"
  region        = var.gcp_region
  network       = google_compute_network.vpc.id
}

# 2. Firewall Rules opening ports 4320 & 4321
resource "google_compute_firewall" "firewall" {
  name    = "orchid-firewall"
  network = google_compute_network.vpc.name

  allow {
    protocol = "tcp"
    ports    = ["22", "4320", "4321"]
  }

  source_ranges = ["0.0.0.0/0"] # Restrict to client & developer IPs in production
}

# 3. Compute Instance
resource "google_compute_instance" "vm" {
  name         = "orchid-proxy-server"
  machine_type = var.machine_type
  zone         = var.gcp_zone

  boot_disk {
    initialize_params {
      image = "ubuntu-os-cloud/ubuntu-2204-lts"
      size  = 15 # Give standard boot disk slightly more room since DB is stored here
    }
  }

  network_interface {
    network    = google_compute_network.vpc.id
    subnetwork = google_compute_subnetwork.subnet.id
    access_config {
      # Empty block allocates a public external IP
    }
  }

  # Injects API key and custom Cloud-Init script
  metadata = {
    user-data = templatefile("${path.module}/cloud-init.yaml", {
      ORCHID_API_KEY = var.orchid_api_key
      GCP_PROJECT    = var.gcp_project
    })
  }

  service_account {
    scopes = ["cloud-platform"]
  }
}

# Retrieve project metadata to get the project number
data "google_project" "project" {}

# Grant default Compute Engine service account read access to GCR (Cloud Storage backend)
resource "google_project_iam_member" "gcr_reader" {
  project = var.gcp_project
  role    = "roles/storage.objectViewer"
  member  = "serviceAccount:${data.google_project.project.number}-compute@developer.gserviceaccount.com"
}

# Grant default Compute Engine service account read access to Artifact Registry
resource "google_project_iam_member" "artifact_registry_reader" {
  project = var.gcp_project
  role    = "roles/artifactregistry.reader"
  member  = "serviceAccount:${data.google_project.project.number}-compute@developer.gserviceaccount.com"
}

output "public_ip" {
  value       = google_compute_instance.vm.network_interface[0].access_config[0].nat_ip
  description = "The public IP address of the deployed GCP instance."
}
