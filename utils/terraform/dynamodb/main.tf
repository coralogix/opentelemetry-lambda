resource "aws_dynamodb_table" "lambda_dynamodb" {
  name           = var.name
  billing_mode   = "PROVISIONED"
  read_capacity  = 10
  write_capacity = 5
  hash_key       = "id"

  attribute {
    name = "id"
    type = "S"
  }
}
