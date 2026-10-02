variable "region" {
  description = "Must be the region of the ACM certificate."
  type        = string
  default     = "us-east-1"
}

variable "aws_profile" {
  description = "AWS CLI profile Terraform uses."
  type        = string
  default     = "loadforge"
}

variable "project" {
  description = "Name prefix for every resource. IAM permissions are scoped to it."
  type        = string
  default     = "loadforge"
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "domain_name" {
  description = "Public hostname for the API. Point a CNAME at the ALB."
  type        = string
  default     = "loadforge.quannh.xyz"
}

variable "defender_image" {
  description = "First Defender (API) image. After that CI sets /loadforge/deploy/defender-image."
  type        = string
  default     = "ghcr.io/nghoangquan175/loadforge-defender:latest"
}

variable "watcher_image" {
  description = "First Watcher image. After that CI sets /loadforge/deploy/watcher-image."
  type        = string
  default     = "ghcr.io/nghoangquan175/loadforge-watcher:latest"
}

variable "dashboard_image" {
  description = "First dashboard image. After that CI sets /loadforge/deploy/dashboard-image."
  type        = string
  default     = "ghcr.io/nghoangquan175/loadforge-dashboard:latest"
}

variable "ghcr_user" {
  description = "GitHub user that owns the GHCR token."
  type        = string
  default     = "nghoangquan175"
}

variable "ghcr_token_param" {
  description = "SSM SecureString with a GitHub classic token (read:packages only). Created by hand, never by Terraform."
  type        = string
  default     = "/loadforge/ghcr-token"
}

variable "instance_type" {
  description = "API servers."
  type        = string
  default     = "t3.micro"
}

variable "web_instance_type" {
  description = "Dashboard server."
  type        = string
  default     = "t3.micro"
}

variable "asg_min" {
  type    = number
  default = 1
}

variable "asg_desired" {
  type    = number
  default = 2
}

variable "asg_max" {
  type    = number
  default = 6
}

variable "target_cpu" {
  description = "Average CPU % the target tracking policy keeps the group at."
  type        = number
  default     = 60
}

variable "danger_cpu" {
  description = "Average CPU % that, held for 30 s, triggers the danger scale-out."
  type        = number
  default     = 90
}

variable "danger_scale_out" {
  description = "Defenders the danger alarm adds at once."
  type        = number
  default     = 2
}

variable "dashboard_user" {
  description = "Dashboard login user. The password is generated, see outputs."
  type        = string
  default     = "admin"
}

variable "dashboard_origins" {
  description = "Origins allowed to call the Defenders and the Watcher from a browser (CORS)."
  type        = list(string)
  default     = ["http://localhost:3100"]
}

variable "attacker_control_url" {
  description = "Attacker control API base, from infra/attacker output control_url. Empty disables the Load test box."
  type        = string
  default     = ""
}

variable "attacker_control_token" {
  description = "Attacker control token, from infra/attacker output control_token."
  type        = string
  default     = ""
  sensitive   = true
}
