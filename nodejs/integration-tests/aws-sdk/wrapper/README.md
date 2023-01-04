# Building the Node.js Public Layer from Source

This sample application is the same as the [public layer sample app](../../../sample-apps/aws-sdk) except it builds the Node.js SDK and Collector layers from source. To deploy this sample app, simply run:

```
terraform init
terraform apply
```

Then visit the API GateWay endpoint that's generated.

### List S3 buckets

GET {{api}}/buckets

### Put record into Dynamodb & SQS 
PUT {{api}}/docs
content-type: application/json

{
    "id": "1",
    "name": "item number 1"
}

### Trigger lambda with SQS
