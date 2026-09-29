# Long-lived wildcard certificate, kept apart from the app stack so
# `terraform destroy` on the app never deletes it.
# DNS is outside AWS: add the validation CNAME from the output by hand.

terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

variable "region" {
  description = "Same region as the ALB that uses the certificate."
  type        = string
  default     = "us-east-1"
}

variable "aws_profile" {
  type    = string
  default = "loadforge"
}

variable "root_domain" {
  type    = string
  default = "quannh.xyz"
}

provider "aws" {
  region  = var.region
  profile = var.aws_profile

  default_tags {
    tags = {
      Project   = "loadforge"
      ManagedBy = "terraform"
    }
  }
}

resource "aws_acm_certificate" "wildcard" {
  # Wildcard only: the root domain already has its own certificate.
  domain_name       = "*.${var.root_domain}"
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

output "certificate_arn" {
  value = aws_acm_certificate.wildcard.arn
}

output "validation_records" {
  description = "Add these CNAME records at your DNS provider."
  value = distinct([
    for o in aws_acm_certificate.wildcard.domain_validation_options : {
      type  = o.resource_record_type
      name  = o.resource_record_name
      value = o.resource_record_value
    }
  ])
}
