import {
  APIGatewayProxyResult,
  Context,
} from 'aws-lambda';

import AWS from 'aws-sdk';
//import fetch from 'node-fetch';

const sqs = new AWS.SQS();

exports.handler = async (event: any, context: Context) => {
  console.info('Serving lambda request.');
  console.log(`Event: ${JSON.stringify(event, null, 2)}`);
  console.log(`Context: ${JSON.stringify(context, null, 2)}`);

  const sqsUrl = process.env.SQS_URL as string
  await sqs.sendMessage({
    MessageBody: JSON.stringify({ aaa: "aaa" }),
    QueueUrl: sqsUrl,
  }).promise(); 

  const response: APIGatewayProxyResult = {
    statusCode: 200,
    body: `Hello lambda`,
  };
  return response;
};
