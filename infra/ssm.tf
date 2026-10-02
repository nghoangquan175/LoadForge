# App config lives in SSM Parameter Store, one parameter per env var:
#   /loadforge/defender/<KEY>   read by the Defender (API) instances
#   /loadforge/watcher/<KEY>    read by the Watcher on the dashboard instance
#   /loadforge/dashboard/<KEY>  read by the dashboard on the dashboard instance
# plus which image to run:
#   /loadforge/deploy/<app>-image
# Instances read them in /usr/local/bin/loadforge-deploy (user-data.sh.tftpl),
# so a changed value needs a redeploy (CI) or instance refresh to apply.

# Terraform only seeds these; CI sets them to the image it just pushed.
resource "aws_ssm_parameter" "image" {
  for_each = {
    defender  = var.defender_image
    watcher   = var.watcher_image
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
  defender_env = {
    AWS_REGION   = var.region
    CORS_ORIGINS = join(",", var.dashboard_origins)
    # Per-server request metrics for the dashboard's server view.
    PUBLISH_METRICS = "true"
    # One Node worker per vCPU, so a server can really reach 100% CPU
    # and the 60% target can trigger scale-out.
    WEB_CONCURRENCY = "auto"
    # Health check served by the Node primary, see alb.tf.
    HEALTH_PORT = tostring(local.health_port)
    # The primary publishes CPU every 10 s for the danger alarm, see compute.tf.
    ASG_NAME = local.asg_name
  }

  watcher_env = {
    DATA_SOURCE    = "aws"
    AWS_REGION     = var.region
    ASG_NAME       = local.asg_name
    ALB_ARN_SUFFIX = aws_lb.main.arn_suffix
    TARGET_CPU     = tostring(var.target_cpu)
    CORS_ORIGINS   = join(",", var.dashboard_origins)
    # Each Defender's /live, on its health port (security.tf).
    DEFENDER_LIVE_PORT = tostring(local.health_port)
  }
}

resource "aws_ssm_parameter" "defender" {
  for_each = local.defender_env

  name  = "/${var.project}/defender/${each.key}"
  type  = "String"
  value = each.value
}

resource "aws_ssm_parameter" "watcher" {
  for_each = local.watcher_env

  name  = "/${var.project}/watcher/${each.key}"
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
