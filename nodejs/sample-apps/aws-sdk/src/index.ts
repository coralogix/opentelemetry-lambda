import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from 'aws-lambda';

import AWS from 'aws-sdk';
//import fetch from 'node-fetch';

const s3 = new AWS.S3();
var docClient = new AWS.DynamoDB.DocumentClient();
var params = {
  TableName: "test",
  Item: {
    "id": "1",
    "hello": "hey"
  }
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
exports.handler = async (_event: APIGatewayProxyEvent, _context: Context) => {
  console.info('Serving lambda request.');

  docClient.put(params, function (err, data) {
    if (err) {
      console.error("Unable to put", JSON.stringify(err, null, 2));
    } else {
      console.log("put succeeded:");
    }
  });

  //const responseOne = await fetch('https://google.com/123');
  //console.log(await responseOne.json())
  const result = await s3.listBuckets().promise();

  const response: APIGatewayProxyResult = {
    statusCode: 200,
    body: `Hello lambda - found ${result.Buckets?.length || 0} buckets`,
  };
  return response;
};
