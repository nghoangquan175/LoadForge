# Dashboard instance: the dashboard (Next.js, :3100) and the Watcher
# (NestJS, :4100) in two containers. An instance of its own, so load tests
# on the Defenders never slow down the page you are watching them from.

# SG descriptions are immutable (a change replaces the group), hence the old wording.
resource "aws_security_group" "web" {
  name        = "${var.project}-web-sg"
  description = "LoadForge dashboard instances: port 3100 from the ALB only"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${var.project}-web-sg" }
}

resource "aws_vpc_security_group_ingress_rule" "web_from_alb" {
  security_group_id            = aws_security_group.web.id
  description                  = "Dashboard from the ALB"
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = 3100
  to_port                      = 3100
}

resource "aws_vpc_security_group_ingress_rule" "watcher_from_alb" {
  security_group_id            = aws_security_group.web.id
  description                  = "Watcher from the ALB"
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = local.watcher_port
  to_port                      = local.watcher_port
}

resource "aws_vpc_security_group_egress_rule" "web_all" {
  security_group_id = aws_security_group.web.id
  description       = "GHCR image pull and AWS APIs"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_web" {
  security_group_id            = aws_security_group.alb.id
  description                  = "Forward to dashboard instances"
  referenced_security_group_id = aws_security_group.web.id
  ip_protocol                  = "tcp"
  from_port                    = 3100
  to_port                      = 3100
}

resource "aws_vpc_security_group_egress_rule" "alb_to_watcher" {
  security_group_id            = aws_security_group.alb.id
  description                  = "Forward to the Watcher"
  referenced_security_group_id = aws_security_group.web.id
  ip_protocol                  = "tcp"
  from_port                    = local.watcher_port
  to_port                      = local.watcher_port
}

resource "aws_lb_target_group" "web" {
  name                 = "${var.project}-web-tg"
  port                 = 3100
  protocol             = "HTTP"
  vpc_id               = aws_vpc.main.id
  target_type          = "instance"
  deregistration_delay = 30

  # "/" redirects to /login without a session, so check the login page.
  health_check {
    path                = "/login"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

# Watcher: /monitor/* (alb.tf). Not behind the dashboard login, like /api/*.
resource "aws_lb_target_group" "watcher" {
  name                 = "${var.project}-watcher-tg"
  port                 = local.watcher_port
  protocol             = "HTTP"
  vpc_id               = aws_vpc.main.id
  target_type          = "instance"
  deregistration_delay = 30

  health_check {
    path                = "/monitor/health"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

# Login for the dashboard, stored in SSM (ssm.tf).
# Read it with: terraform output -raw dashboard_password
resource "random_password" "dashboard" {
  length  = 24
  special = false
}

resource "random_password" "auth_secret" {
  length  = 48
  special = false
}

resource "aws_instance" "web" {
  ami                         = data.aws_ami.al2023.id
  instance_type               = var.web_instance_type
  subnet_id                   = aws_subnet.public[0].id
  vpc_security_group_ids      = [aws_security_group.web.id]
  iam_instance_profile        = aws_iam_instance_profile.web.name
  user_data_replace_on_change = true

  # IMDSv2 only. Hop limit 2: the Watcher container is one network hop
  # further away and its AWS SDK needs the instance role credentials.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  user_data = templatefile("${path.module}/user-data.sh.tftpl", merge(local.user_data_vars, {
    role = "dashboard"
    containers = [
      {
        name        = "loadforge-dashboard"
        image_param = aws_ssm_parameter.image["dashboard"].name
        env_path    = "/${var.project}/dashboard/"
        instance_id = false
        ports       = [3100]
      },
      {
        name        = "loadforge-watcher"
        image_param = aws_ssm_parameter.image["watcher"].name
        env_path    = "/${var.project}/watcher/"
        instance_id = false
        ports       = [local.watcher_port]
      },
    ]
  }))

  # The instance reads its config at boot.
  depends_on = [
    aws_ssm_parameter.dashboard_user,
    aws_ssm_parameter.dashboard_password,
    aws_ssm_parameter.auth_secret,
    aws_ssm_parameter.watcher,
  ]

  tags = { Name = "${var.project}-web" }
}

resource "aws_lb_target_group_attachment" "web" {
  target_group_arn = aws_lb_target_group.web.arn
  target_id        = aws_instance.web.id
  port             = 3100
}

resource "aws_lb_target_group_attachment" "watcher" {
  target_group_arn = aws_lb_target_group.watcher.arn
  target_id        = aws_instance.web.id
  port             = local.watcher_port
}
