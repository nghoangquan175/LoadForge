# The Attacker: a single EC2 box in the DEFAULT VPC that runs the k6 load
# generator (apps/attacker) against the LoadForge system. Standalone, like
# infra/ci and infra/certificate, so `terraform destroy` on the main stack
# leaves it alone (and vice versa).
#
# It only ever hits the fixed ATTACK_TARGET below, and only this box's own
# control CIDR can reach its control port. Start/stop it with the control API;
# stop the instance between tests so it costs almost nothing.
#
#   cd infra/attacker && terraform apply
#   terraform output control_url / control_token

terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "aws_profile" {
  type    = string
  default = "loadforge"
}

variable "project" {
  type    = string
  default = "loadforge"
}

variable "instance_type" {
  description = "Load generator box. t3.small has more CPU/network headroom than micro for TLS."
  type        = string
  default     = "t3.small"
}

variable "attack_target" {
  description = "The ONLY URL the generator will hit. A control request can only pick rate and duration."
  type        = string
  default     = "https://loadforge.quannh.xyz/api/load/cpu?limit=300000"
}

variable "control_cidr" {
  description = "Who may reach the control port. Default: nobody (set to your.ip/32)."
  type        = string
  default     = "127.0.0.1/32"
}

variable "dashboard_cidr" {
  description = "The dashboard/Watcher box's egress IP (/32), so the Watcher can proxy control calls. Empty = none."
  type        = string
  default     = ""
}

variable "subnet_id" {
  description = <<-EOT
    Subnet for the box. Must have an internet route (0.0.0.0/0 -> IGW) so it can
    pull the image and reach the LoadForge ALB. Empty picks the first default
    subnet, but a default VPC can have a subnet on a custom route table without
    internet, so pin a known-good one here.
  EOT
  type        = string
  default     = ""
}

variable "control_port" {
  type    = number
  default = 4200
}

variable "max_rate" {
  type    = number
  default = 1000
}

variable "max_duration_sec" {
  type    = number
  default = 1800
}

variable "dashboard_origin" {
  description = "Browser origin allowed to drive the control API (the dashboard)."
  type        = string
  default     = "https://loadforge.quannh.xyz"
}

variable "ghcr_user" {
  type    = string
  default = "nghoangquan175"
}

variable "ghcr_token_param" {
  description = "SSM SecureString with a GitHub token (read:packages). Created by hand, shared with the main stack."
  type        = string
  default     = "/loadforge/ghcr-token"
}

variable "image" {
  description = "Attacker image, built and pushed by CI."
  type        = string
  default     = "ghcr.io/nghoangquan175/loadforge-attacker:latest"
}

provider "aws" {
  region  = var.region
  profile = var.aws_profile

  default_tags {
    tags = {
      Project   = var.project
      Component = "attacker"
      ManagedBy = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# describe-images, not the public SSM AMI parameter (the terraform user has no
# ssm:GetParameter on it), same as the main stack's compute.tf.
data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

locals {
  account_id = data.aws_caller_identity.current.account_id
  name       = "${var.project}-attacker"
}

# A token the caller must send on /control/*, so an open control CIDR is not
# enough on its own to drive the box.
resource "random_password" "control_token" {
  length  = 32
  special = false
}

resource "aws_security_group" "attacker" {
  name        = local.name
  description = "LoadForge attacker: control port from the control CIDR only, all egress"
  vpc_id      = data.aws_vpc.default.id
}

resource "aws_vpc_security_group_ingress_rule" "control" {
  security_group_id = aws_security_group.attacker.id
  description       = "Control + health API"
  cidr_ipv4         = var.control_cidr
  ip_protocol       = "tcp"
  from_port         = var.control_port
  to_port           = var.control_port
}

resource "aws_vpc_security_group_ingress_rule" "control_dashboard" {
  count             = var.dashboard_cidr == "" ? 0 : 1
  security_group_id = aws_security_group.attacker.id
  description       = "Control API from the dashboard/Watcher box"
  cidr_ipv4         = var.dashboard_cidr
  ip_protocol       = "tcp"
  from_port         = var.control_port
  to_port           = var.control_port
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.attacker.id
  description       = "Reach the LoadForge ALB, GHCR and AWS APIs"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

# Instance role: read the GHCR token to pull the image, and be reachable over
# SSM Session Manager for debugging (no SSH key, no inbound SSH).
data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "attacker" {
  name               = local.name
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

data "aws_iam_policy_document" "ghcr" {
  statement {
    sid       = "ReadGhcrToken"
    actions   = ["ssm:GetParameter"]
    resources = ["arn:aws:ssm:${var.region}:${local.account_id}:parameter${var.ghcr_token_param}"]
  }
}

resource "aws_iam_role_policy" "ghcr" {
  name   = "${local.name}-ghcr"
  role   = aws_iam_role.attacker.id
  policy = data.aws_iam_policy_document.ghcr.json
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.attacker.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "attacker" {
  name = local.name
  role = aws_iam_role.attacker.name
}

resource "aws_instance" "attacker" {
  ami                         = data.aws_ami.al2023.id
  instance_type               = var.instance_type
  subnet_id                   = var.subnet_id != "" ? var.subnet_id : data.aws_subnets.default.ids[0]
  vpc_security_group_ids      = [aws_security_group.attacker.id]
  iam_instance_profile        = aws_iam_instance_profile.attacker.name
  associate_public_ip_address = true
  user_data_replace_on_change = true

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  user_data = templatefile("${path.module}/user-data.sh.tftpl", {
    region           = var.region
    ghcr_user        = var.ghcr_user
    ghcr_token_param = var.ghcr_token_param
    image            = var.image
    control_port     = var.control_port
    attack_target    = var.attack_target
    max_rate         = var.max_rate
    max_duration_sec = var.max_duration_sec
    control_token    = random_password.control_token.result
    cors_origins     = var.dashboard_origin
  })

  tags = { Name = local.name }
}

output "public_ip" {
  value = aws_instance.attacker.public_ip
}

output "control_url" {
  value = "http://${aws_instance.attacker.public_ip}:${var.control_port}"
}

output "control_token" {
  value     = random_password.control_token.result
  sensitive = true
}

output "attack_target" {
  value = var.attack_target
}
