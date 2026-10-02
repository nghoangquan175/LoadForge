# Wildcard certificate from the separate infra/certificate stack.
data "terraform_remote_state" "certificate" {
  backend = "local"

  config = {
    path = "${path.module}/certificate/terraform.tfstate"
  }
}

locals {
  certificate_arn = data.terraform_remote_state.certificate.outputs.certificate_arn
}

resource "aws_lb" "main" {
  name               = "${var.project}-alb"
  load_balancer_type = "application"
  internal           = false
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  # Long enough to keep the SSE stream open between snapshots.
  idle_timeout = 120
}

# Defenders (NestJS API). The dashboard and Watcher target groups are in web.tf.
resource "aws_lb_target_group" "app" {
  name        = "${var.project}-tg"
  port        = 4000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "instance"

  # Short drain so scale-in is quick to watch.
  deregistration_delay = 30

  # Each request goes to the server with the fewest requests still in flight,
  # not round robin: a server that just started (zero in flight) takes most of
  # the new traffic until it is as busy as the others. Slow start stays off,
  # it would do the opposite (and AWS does not allow it with this algorithm).
  load_balancing_algorithm_type = "least_outstanding_requests"

  # Checked on the Node primary's own port (HEALTH_PORT), not the API:
  # the workers queue requests behind CPU-heavy ones, so a check sent there
  # times out when the server is only busy and the ASG would replace it.
  health_check {
    port                = tostring(local.health_port)
    path                = "/"
    matcher             = "200"
    interval            = 15
    timeout             = 10
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = local.certificate_arn

  # Everything that is not /api/* or /monitor/* goes to the dashboard.
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10

  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

resource "aws_lb_listener_rule" "watcher" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 20

  condition {
    path_pattern {
      values = ["/monitor/*"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.watcher.arn
  }
}
