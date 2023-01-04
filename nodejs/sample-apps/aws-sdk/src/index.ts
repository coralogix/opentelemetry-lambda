import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from 'aws-lambda';

import AWS from 'aws-sdk';

const s3 = new AWS.S3();
const sqs = new AWS.SQS();
const dynamodb = new AWS.DynamoDB.DocumentClient();

exports.handler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  console.log(`Event: ${JSON.stringify(event)}`);
  console.log(`Context: ${JSON.stringify(context)}`);

  const routeEvent = `${event.httpMethod} ${event.path}`

  const headers = {
    "Content-Type": "application/json"
  }

  let response: APIGatewayProxyResult = { statusCode: 200, body: '', headers };
  try {
    const dynamodbTableName = process.env.DYNAMODB_TABLE_NAME as string
    const sqsUrl = process.env.SQS_URL as string
    switch (routeEvent) {
      case "GET /buckets":
        const result = await s3.listBuckets().promise();
        response  = {
          statusCode: 200,
          body: `Hello lambda - found ${result.Buckets?.length || 0} buckets`,
          headers
        };
        break;
      case "PUT /docs":
        let agpRequest = JSON.parse(event.body as string)
        await dynamodb.put({
          TableName: dynamodbTableName,
          Item: {
            id: agpRequest.id,
            name: agpRequest.name,
            stage: "processing"
          }
        }).promise(); 
        await sqs.sendMessage({
          MessageBody: JSON.stringify({ id: agpRequest.id }),
          QueueUrl: sqsUrl,
        }).promise(); 
        response  = {
          statusCode: 201,
          body: `Put doc ${agpRequest.id}`,
          headers
        };
        break;
      default:
        throw new Error(`Unsupported route: "${routeEvent}"`)
    }
  } catch (err: any) {
    response = {
      statusCode: 400,
      body: JSON.stringify(err.message),
      headers
    };
  }
  return response;
};
