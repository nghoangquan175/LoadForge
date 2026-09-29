locals {
  # Fixed name so the instances can be told which group to watch
  # before the group exists.
  asg_name = "${var.project}-asg"

  # Inputs every user-data.sh.tftpl render needs; each app adds its own.
  user_data_vars = {
    region           = var.region
    ghcr_user        = var.ghcr_user
    ghcr_token_param = var.ghcr_token_param
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
  image_id               = data.aws_ami.al2023.id
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
    app         = "server"
    port        = 4000
    image_param = aws_ssm_parameter.image["server"].name
    env_path    = "/${var.project}/server/"
  })))

  # Instances read their config at boot.
  depends_on = [aws_ssm_parameter.server]

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
  # Boot installs Docker and pulls the image: about a minute.
  health_check_grace_period = 180
  default_instance_warmup   = 120

  launch_template {
    id      = aws_launch_template.app.id
    version = aws_launch_template.app.latest_version
  }

  instance_refresh {
    strategy = "Rolling"
    preferences {
      min_healthy_percentage = 50
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
