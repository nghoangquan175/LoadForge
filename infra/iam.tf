# Instance role: lets the API read its own Auto Scaling group and metrics,
# and lets you open a shell with Session Manager (no SSH keys).

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "app" {
  name               = "${var.project}-ec2-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "app_read" {
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

  # App config (/loadforge/server, /loadforge/dashboard) and the GHCR token.
  statement {
    sid       = "ReadConfig"
    actions   = ["ssm:GetParameter", "ssm:GetParametersByPath"]
    resources = ["arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter/${var.project}/*"]
  }
}

resource "aws_iam_role_policy" "app_read" {
  name   = "${var.project}-read-scaling-data"
  role   = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.app_read.json
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "app" {
  name = "${var.project}-ec2-profile"
  role = aws_iam_role.app.name
}
