# Placeholder Terraform root module. Not a complete IaC setup - fill in per
# your cloud (AWS/GCP/Azure) once you've picked one. Suggested resources:
#   - EKS/GKE/AKS cluster + node group sized for the app + Bull workers
#   - RDS/Cloud SQL Postgres+PostGIS instance (or self-managed if you need
#     TimescaleDB, which isn't available as a managed RDS engine)
#   - ElastiCache/Memorystore Redis
#   - S3/GCS bucket for report exports and vehicle images
#   - Route53/Cloud DNS + ACM/Google-managed cert for the ingress hostname
terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}
