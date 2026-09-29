# ALB: open to the internet on 80 (redirects to HTTPS) and 443.
resource "aws_security_group" "alb" {
  name        = "${var.project}-alb-sg"
  description = "LoadForge ALB: HTTP/HTTPS from the internet"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${var.project}-alb-sg" }
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTP, redirected to HTTPS"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTPS"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "alb_to_app" {
  security_group_id            = aws_security_group.alb.id
  description                  = "Forward to app instances"
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 4000
  to_port                      = 4000
}

# App instances: API port from the ALB only. No SSH, use Session Manager.
resource "aws_security_group" "app" {
  name        = "${var.project}-app-sg"
  description = "LoadForge app instances: API port from the ALB only"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${var.project}-app-sg" }
}

resource "aws_vpc_security_group_ingress_rule" "app_from_alb" {
  security_group_id            = aws_security_group.app.id
  description                  = "API from the ALB"
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = 4000
  to_port                      = 4000
}

resource "aws_vpc_security_group_egress_rule" "app_all" {
  security_group_id = aws_security_group.app.id
  description       = "GHCR image pull and AWS APIs"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}
