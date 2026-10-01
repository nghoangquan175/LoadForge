output "app_url" {
  description = "Dashboard URL once the CNAME is in place. Defenders under /api, Watcher under /monitor."
  value       = "https://${var.domain_name}"
}

output "alb_dns_name" {
  description = "Point a CNAME for domain_name at this."
  value       = aws_lb.main.dns_name
}

output "dns_record" {
  description = "Record to add at your DNS provider."
  value       = "CNAME  ${split(".", var.domain_name)[0]}  ->  ${aws_lb.main.dns_name}"
}

output "certificate_arn" {
  value = local.certificate_arn
}

output "asg_name" {
  value = aws_autoscaling_group.app.name
}

output "alb_arn_suffix" {
  description = "ALB_ARN_SUFFIX for a local Watcher reading this stack."
  value       = aws_lb.main.arn_suffix
}

output "dashboard_env" {
  description = "To point a local dashboard at this stack: apps/dashboard/.env.local"
  value       = "NEXT_PUBLIC_API_URL=https://${var.domain_name}\nNEXT_PUBLIC_WATCHER_URL=https://${var.domain_name}"
}

output "dashboard_user" {
  value = var.dashboard_user
}

output "dashboard_password" {
  description = "terraform output -raw dashboard_password"
  value       = random_password.dashboard.result
  sensitive   = true
}
