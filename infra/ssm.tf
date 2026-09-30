# App config lives in SSM Parameter Store, one parameter per env var:
#   /loadforge/server/<KEY>     read by the API instances
#   /loadforge/dashboard/<KEY>  read by the dashboard instance
# plus which image to run:
#   /loadforge/deploy/<app>-image
# Instances read them in /usr/local/bin/loadforge-deploy (user-data.sh.tftpl),
# so a changed value needs a redeploy (CI) or instance refresh to apply.

# Terraform only seeds these; CI sets them to the image it just pushed.
resource "aws_ssm_parameter" "image" {
  for_each = {
    server    = var.server_image
    dashboard = var.dashboard_image
  }

  name  = "/${var.project}/deploy/${each.key}-image"
  type  = "String"
  value = each.value

  lifecycle {
    ignore_changes = [value]
  }
}

locals {
  server_env = {
    DATA_SOURCE    = "aws"
    AWS_REGION     = var.region
    ASG_NAME       = local.asg_name
    ALB_ARN_SUFFIX = aws_lb.main.arn_suffix
    TARGET_CPU     = tostring(var.target_cpu)
    CORS_ORIGINS   = join(",", var.dashboard_origins)
    # Per-server request metrics for the dashboard's server view.
    PUBLISH_METRICS = "true"
    # One Node worker per vCPU, so a server can really reach 100% CPU
    # and the 60% target can trigger scale-out.
    WEB_CONCURRENCY = "auto"
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
