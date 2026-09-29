# App config lives in SSM Parameter Store, one parameter per env var:
#   /loadforge/server/<KEY>     read by the API instances
#   /loadforge/dashboard/<KEY>  read by the dashboard instance
# Instances turn their path into an env file at boot (user-data.sh.tftpl),
# so a changed value needs an instance restart or refresh to apply.

locals {
  server_env = {
    DATA_SOURCE    = "aws"
    AWS_REGION     = var.region
    ASG_NAME       = local.asg_name
    ALB_ARN_SUFFIX = aws_lb.main.arn_suffix
    TARGET_CPU     = tostring(var.target_cpu)
    CORS_ORIGINS   = join(",", var.dashboard_origins)
  }
}

resource "aws_ssm_parameter" "server" {
  for_each = local.server_env

  name  = "/${var.project}/server/${each.key}"
  type  = "String"
  value = each.value
}

resource "aws_ssm_parameter" "dashboard_user" {
  name  = "/${var.project}/dashboard/DASHBOARD_USER"
  type  = "String"
  value = var.dashboard_user
}

# Generated here, so also stored in Terraform state: fine for a lab.
resource "aws_ssm_parameter" "dashboard_password" {
  name  = "/${var.project}/dashboard/DASHBOARD_PASSWORD"
  type  = "SecureString"
  value = random_password.dashboard.result
}

resource "aws_ssm_parameter" "auth_secret" {
  name  = "/${var.project}/dashboard/AUTH_SECRET"
  type  = "SecureString"
  value = random_password.auth_secret.result
}
