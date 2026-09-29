# Dashboard (Next.js): one instance of its own, so load tests on the API
# never slow down the page you are watching them from.

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
  iam_instance_profile        = aws_iam_instance_profile.app.name
  user_data_replace_on_change = true

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  user_data = templatefile("${path.module}/user-data.sh.tftpl", merge(local.user_data_vars, {
    app        = "dashboard"
    image      = var.dashboard_image
    port       = 3100
    param_path = "/${var.project}/dashboard/"
  }))

  # The instance reads its config at boot.
  depends_on = [
    aws_ssm_parameter.dashboard_user,
    aws_ssm_parameter.dashboard_password,
    aws_ssm_parameter.auth_secret,
  ]

  tags = { Name = "${var.project}-web" }
}

resource "aws_lb_target_group_attachment" "web" {
  target_group_arn = aws_lb_target_group.web.arn
  target_id        = aws_instance.web.id
  port             = 3100
}
