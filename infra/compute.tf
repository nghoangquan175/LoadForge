locals {
  # Fixed name so the instances can be told which group to watch
  # before the group exists.
  asg_name = "${var.project}-asg"

  # Answered by the Node primary of each Defender (apps/defender/src/main.ts).
  health_port = 4001

  # The Watcher on the dashboard instance (apps/watcher).
  watcher_port = 4100

  # Inputs every user-data.sh.tftpl render needs; each instance adds its containers.
  user_data_vars = {
    region           = var.region
    ghcr_user        = var.ghcr_user
    ghcr_token_param = var.ghcr_token_param
    # True on an AMI that ships Docker: skips installing it at boot.
    docker_preinstalled = false
  }
}

# Defenders: AL2023 with Docker already installed, so a new server skips
# `dnf install docker` and is ready sooner. The dashboard keeps plain AL2023.
data "aws_ami" "al2023_ecs" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-ecs-hvm-*-x86_64"]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

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

resource "aws_launch_template" "app" {
  name_prefix            = "${var.project}-"
  image_id               = data.aws_ami.al2023_ecs.id
  instance_type          = var.instance_type
  vpc_security_group_ids = [aws_security_group.app.id]
  update_default_version = true

  iam_instance_profile {
    arn = aws_iam_instance_profile.app.arn
  }

  # 1-minute CloudWatch metrics instead of 5.
  monitoring {
    enabled = true
  }

  # IMDSv2 only. Hop limit 2: the container is one network hop further
  # away and the AWS SDK inside it needs the instance role credentials.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  user_data = base64encode(templatefile("${path.module}/user-data.sh.tftpl", merge(local.user_data_vars, {
    role                = "defender"
    docker_preinstalled = true
    containers = [{
      name        = "loadforge-defender"
      image_param = aws_ssm_parameter.image["defender"].name
      env_path    = "/${var.project}/defender/"
      instance_id = true
      ports       = [4000, local.health_port]
    }]
  })))

  # Instances read their config at boot.
  depends_on = [aws_ssm_parameter.defender]

  tag_specifications {
    resource_type = "instance"
    tags          = { Name = "${var.project}-app" }
  }
}

resource "aws_autoscaling_group" "app" {
  name                = local.asg_name
  min_size            = var.asg_min
  max_size            = var.asg_max
  desired_capacity    = var.asg_desired
  vpc_zone_identifier = aws_subnet.public[*].id
  target_group_arns   = [aws_lb_target_group.app.arn]

  # Replace instances the ALB marks unhealthy, not only dead ones.
  health_check_type = "ELB"
  # Boot pulls the image and starts the app: about a minute.
  health_check_grace_period = 180
  default_instance_warmup   = 120

  launch_template {
    id      = aws_launch_template.app.id
    version = aws_launch_template.app.latest_version
  }

  instance_refresh {
    strategy = "Rolling"
    preferences {
      # Launch new servers first, stop old ones after: no downtime.
      min_healthy_percentage = 100
      max_healthy_percentage = 200
    }
  }

  enabled_metrics = [
    "GroupDesiredCapacity",
    "GroupInServiceInstances",
    "GroupPendingInstances",
    "GroupTerminatingInstances",
  ]

  tag {
    key                 = "Name"
    value               = "${var.project}-app"
    propagate_at_launch = true
  }

  lifecycle {
    # The scaling policy owns desired capacity after creation.
    ignore_changes = [desired_capacity]
  }
}

resource "aws_autoscaling_policy" "cpu" {
  name                   = "${var.project}-cpu-target"
  autoscaling_group_name = aws_autoscaling_group.app.name
  policy_type            = "TargetTrackingScaling"

  target_tracking_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ASGAverageCPUUtilization"
    }
    target_value = var.target_cpu
  }
}

# Danger level. Target tracking above needs 3 one-minute points over 60%,
# too slow when a burst pins a server near 100%. Each Defender publishes CPU
# every 10 s (apps/defender/src/cpu-metrics); above 90% for 30 s adds 2
# servers at once. When both policies fire, the ASG takes the bigger one.
resource "aws_autoscaling_policy" "cpu_danger" {
  name                   = "${var.project}-cpu-danger"
  autoscaling_group_name = aws_autoscaling_group.app.name
  policy_type            = "StepScaling"
  adjustment_type        = "ChangeInCapacity"

  # Servers still warming up count as added, so the alarm staying on
  # does not add 2 more every 10 s (default_instance_warmup above).
  step_adjustment {
    metric_interval_lower_bound = 0
    scaling_adjustment          = var.danger_scale_out
  }
}

resource "aws_cloudwatch_metric_alarm" "cpu_danger" {
  alarm_name        = "${var.project}-cpu-danger"
  alarm_description = "Group CPU above ${var.danger_cpu}% for 30 s: add ${var.danger_scale_out} Defenders"

  namespace   = "LoadForge"
  metric_name = "CPUUtilization"
  dimensions  = { AutoScalingGroupName = local.asg_name }
  statistic   = "Average"

  period              = 10
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  threshold           = var.danger_cpu
  comparison_operator = "GreaterThanThreshold"
  # No points while no server publishes: that is not danger.
  treat_missing_data = "notBreaching"

  alarm_actions = [aws_autoscaling_policy.cpu_danger.arn]
}
