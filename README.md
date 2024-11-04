# PrivMX Bridge

PrivMX Bridge is a secure, zero-knowledge server for encrypted data storage and communication.
It allows users to communicate and exchange data in a fully encrypted environment, ensuring end-to-end encryption and protecting data privacy at every step.
Client software for PrivMX Bridge is [PrivMX Endpoint](https://github.com/simplito/privmx-endpoint), which handles the encryption.
Learn more about how PrivMX works with our [docs](https://docs.privmx.dev/).

**NOTE:** If you only want to run PrivMX Bridge without developing it, go to the [PrivMX Bridge Docker](https://github.com/simplito/privmx-bridge-docker) project.

## Prerequisites

### Mongo

PrivMX Bridge requires a connection to MongoDB with a replica set enabled. If you don't have one, you can set it up using the script below (Docker-based):

```
./scripts/mongo.sh
```

### Nodejs

The project is written in TypeScript, so it requires a Node.js environment to run (version 22).

## Run

Install dependencies, compile the code, and run it:

```
npm install
npm run compile
npm start
```

## Develop

First, run the compilation in watch mode (it will recompile the project whenever any changes are made):

```
npm run watch
```

Then, in a separate console, run the server (it will restart whenever any changes are made):

```
npm start
```

## Documentation

### Build Documentation

To build the documentation, run:

```
./scripts/build-docs.sh
```

### Visit Documentation

If your server runs on port 3000, the documentation will be available at [http://localhost:3000/docs](http://localhost:3000/docs).

### Develop Documentation

PrivMX uses [Slate](https://github.com/slatedocs/slate) for the Bridge documentation. First, run it in watch mode:

```
./scripts/develop-docs.sh
```

Navigate to [http://127.0.0.1:4567](http://127.0.0.1:4567). Whenever you make any changes, run the script below to generate markdowns for Slate and then refresh the page:

```
npm run gen-docs
```

## Testing

Unit test:

```
npm t
```

E2E test:

```
npm run e2e-tests
```

## Build Docker Image

It will produce a Docker image with the `privmx-bridge` tag:

```
./scripts/build-docker.sh
```

## Configuration Options

The table below outlines the primary configuration options available for this application. Each option can be set using environment variables to override default values. You can use this as a reference to customize server behavior and optimize resource usage. 

| Option                           | Environment Variable               | Default Value                          | Description |
|----------------------------------|------------------------------------|----------------------------------------|-------------|
| server.port                      | PRIVMX_PORT                        | 3000                                   | Server's port |
| server.hostname                  | PRIVMX_HOSTNAME                    | "0.0.0.0"                              | The interface on which server will listen |
| server.workers                   | PRIVMX_WORKERS                     | Number of cpu cores (threads)          | Number of threads that will process requests |
| server.ssl.enabled               | PRIVMX_SSL_ENABLED                 | false                                  | Enables SSL for the server |
| server.ssl.port                  | PRIVMX_SSL_PORT                    | 3443                                   | SSL port number |
| server.ssl.privKeyPath           | PRIVMX_SSL_PRIV_KEY_PATH           | "privkey.pem"                          | Path to SSL private key file |
| db.mongo.url                     | PRIVMX_MONGO_URL                   | "mongodb://localhost:27017/"           | MongoDB connection URL |
| db.storageProviderName           | PRIVMX_STORAGE_PROVIDER_NAME       | "fs"                                   | Name of the storage provider |
| metrics.enabled                  | PRIVMX_METRICS_ENABLED             | false                                  | Enables metrics |
| metrics.username                 | PRIVMX_METRICS_USER                | "admin"                                | Username for metrics endpoint |
| metrics.password                 | PRIVMX_METRICS_PASSWORD            | "password"                             | Password for metrics endpoint |
| request.chunkSize                | PRIVMX_REQUEST_CHUNK_SIZE          | 5242880 (5MiB)                         | Request chunk size in bytes |
| loggerEscapeNewLine              | PRIVMX_LOGGER_ESCAPE_NEW_LINE      | true                                   | Escapes newlines in logs |
| apiRateLimit.enabled             | PMX_LIMITER_ENABLED                | false                                  | Enables API rate limiter |
| apiRateLimit.initialCredit       | PMX_LIMITER_INITIAL_CREDIT         | 1000                                   | Initial credit for client IP address |
| apiRateLimit.maxCredit           | PMX_LIMITER_MAX_CREDIT             | 1200                                   | Maximum credit for client IP address |
| apiRateLimit.creditAddon         | PMX_LIMITER_CREDIT_ADDON           | 100                                    | Credits added per interval for client |
| apiRateLimit.addonInterval       | PMX_LIMITER_CREDIT_ADDON_INTERVAL  | 1000                                   | Interval (ms) for credit addition |
| apiRateLimit.requestCost         | PMX_LIMITER_REQUEST_COST           | 10                                     | Cost of a single request in credits |
| apiRateLimit.inactiveTime        | PMX_LIMITER_INACTIVE_TIME          | 120000                                 | Inactive time (ms) before client is removed |
| apiRateLimit.whitelist           | PMX_LIMITER_WHITELIST              | []                                     | List of IPs exempt from rate limiting |

Default config file path in project is ```<PROJECT_MAIN_DIRECTORY>/conf/config.json```. Directory conf has to be created first.

example of config file:
```json
{
    "apiRateLimit": {
        "enabled": true
    }
}
```

The configuration values specified in the configuration file take precedence over those set through environment variables. If a value is defined in both the configuration file and an environment variable, the configuration file value will be used.

## License

PrivMX Free License
