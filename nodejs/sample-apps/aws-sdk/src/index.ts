import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from 'aws-lambda';

// import AWS from 'aws-sdk';
//import fetch from 'node-fetch';
import { InvokeCommand, LambdaClient, LogType } from "@aws-sdk/client-lambda";

// const s3 = new AWS.S3();
// var docClient = new AWS.DynamoDB.DocumentClient();
// var params = {
//   TableName: "test",
//   Item: {
//     "id": "1",
//     "hello": "hey"
//   }
// };

const client = new LambdaClient({});
const command = new InvokeCommand({
  FunctionName: "hello-nodejs-rafal",
  Payload: new Uint8Array(0),
  LogType: LogType.Tail,
});

exports.handler = async (event: APIGatewayProxyEvent, context: Context) => {
  console.info('Serving lambda request.');
  console.log(`Event: ${JSON.stringify(event, null, 2)}`);
  console.log(`Context: ${JSON.stringify(context, null, 2)}`);

  // docClient.put(params, function (err, data) {
  //   if (err) {
  //     console.error("Unable to put", JSON.stringify(err, null, 2));
  //   } else {
  //     console.log("put succeeded:");
  //   }
  // });

  // //const responseOne = await fetch('https://google.com/123');
  // //console.log(await responseOne.json())
  // const result = await s3.listBuckets().promise();

  const rawResult = await client.send(command);
  const result = Buffer.from(rawResult.Payload || "").toString();

  const response: APIGatewayProxyResult = {
    statusCode: 200,
    body: `Hello lambda2: ${result}`,
  };
  return response;
};
