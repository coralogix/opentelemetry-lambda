# OpenTelemetry Lambda NodeJS

Layer for running NodeJS applications on AWS Lambda with OpenTelemetry. Adding the layer and pointing to it with
the `AWS_LAMBDA_EXEC_WRAPPER` environment variable will initialize OpenTelemetry, enabling tracing with no code change.

To use, add the layer to your function configuration and then set `AWS_LAMBDA_EXEC_WRAPPER` to `/opt/otel-handler`.

[AWS SDK v2 instrumentation](https://github.com/aspecto-io/opentelemetry-ext-js/tree/master/packages/instrumentation-aws-sdk) is also
included and loaded automatically if you use the AWS SDK v2.

## Building

### Requirements

You will need to provide the path to 3 forked dependencies through environment
variables for the libraries below:

- opentelemetry-js: `OPENTELEMETRY_JS_PATH`.
- opentelemetry-js-contrib: `OPENTELEMETRY_JS_CONTRIB_PATH`.
- import-in-the-middle: `IITM_PATH`.

Note that these paths are very important, because they are will impact the
relative paths in some `package.json` files in ways that could potentially
break CI scripts.

To avoid this issue we recommend setting them like so:

```sh
export OPENTELEMETRY_JS_CONTRIB_PATH=./opentelemetry-js-contrib-cx
export OPENTELEMETRY_JS_PATH=./opentelemetry-js
export IITM_PATH=./import-in-the-middle
```

This project's `.gitignore` is already configured with these folders
to ensure your git index stays clean.

### The layer

To build the layer and sample applications run the command below from
the root of the application:

```sh
./dev/build-nodejs.sh
```

This is a thin wrapper over `./ci-scripts/build_nodejs_layer.sh` that
will clone the forked dependencies if the paths indicated by the
previously mentioned environment variables are empty, then use
that script to download all dependencies and compile all code.
The layer zip file will be present at `./packages/layer/build/layer.zip`.

## Sample applications

Sample applications are provided to show usage of the above layer.

- Application using AWS SDK - shows using the wrapper with an application using AWS SDK without code change.
  - [Using layer built from source](./integration-tests/aws-sdk)
  - [WIP] [Using OTel Public Layer](./sample-apps/aws-sdk)
