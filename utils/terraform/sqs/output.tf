output "sqs_id" {
  value = aws_sqs_queue.lambda_sqs.id
}

output "sqs_arn" {
  value = aws_sqs_queue.lambda_sqs.arn
}
