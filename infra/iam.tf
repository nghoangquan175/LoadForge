# Instance roles, one per kind of instance:
#   app (Defenders): publish their own request metrics
#   web (dashboard + Watcher): read the Auto Scaling group and its metrics
# Both read their config from SSM and allow a Session Manager shell (no SSH keys).

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

data "aws_caller_identity" "current" {}

# App config (/loadforge/<app>/*), image tags and the GHCR token.
data "aws_iam_policy_document" "read_config" {
  statement {
    sid       = "ReadConfig"
    actions   = ["ssm:GetParameter", "ssm:GetParametersByPath"]
    resources = ["arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter/${var.project}/*"]
  }
}

# --- Defenders ---

resource "aws_iam_role" "app" {
  name               = "${var.project}-ec2-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

data "aws_iam_policy_document" "app" {
  source_policy_documents = [data.aws_iam_policy_document.read_config.json]

  # Each Defender reports its own requests, latency and 5xx
  # (RequestStatsService), only into the LoadForge namespace.
  statement {
    sid       = "PublishRequestMetrics"
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = ["LoadForge"]
    }
  }
}

resource "aws_iam_role_policy" "app_read" {
  name   = "${var.project}-defender"
  role   = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.app.json
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "app" {
  name = "${var.project}-ec2-profile"
  role = aws_iam_role.app.name
}

# --- Dashboard instance (dashboard + Watcher) ---

resource "aws_iam_role" "web" {
  name               = "${var.project}-web-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

data "aws_iam_policy_document" "web" {
  source_policy_documents = [data.aws_iam_policy_document.read_config.json]

  # The Watcher reads the group, its instances and CloudWatch metrics.
  statement {
    sid = "ReadScalingData"
    actions = [
      "autoscaling:DescribeAutoScalingGroups",
      "autoscaling:DescribeScalingActivities",
      "autoscaling:DescribePolicies",
      "ec2:DescribeInstances",
      "cloudwatch:GetMetricData",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "web" {
  name   = "${var.project}-watcher"
  role   = aws_iam_role.web.id
  policy = data.aws_iam_policy_document.web.json
}

resource "aws_iam_role_policy_attachment" "web_ssm" {
  role       = aws_iam_role.web.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "web" {
  name = "${var.project}-web-profile"
  role = aws_iam_role.web.name
}
