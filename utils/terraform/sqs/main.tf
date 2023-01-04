resource "aws_sqs_queue" "lambda_sqs" {
  name    = var.name
}

resource "aws_lambda_event_source_mapping" "sqs_event_source_mapping" {
  event_source_arn = aws_sqs_queue.lambda_sqs.arn
  function_name    = var.lambda_function_name
}
