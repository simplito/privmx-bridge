# PrivMX Bridge API
This documentation provides a comprehensive guidance for using PrivMX Bridge API.
[PrivMX Bridge](https://github.com/simplito/privmx-bridge) is a secure, zero-knowledge server for encrypted data storage and communication.
It allows users to communicate and exchange data in a fully encrypted environment, ensuring end-to-end encryption and protecting data privacy at every step.
Client software for PrivMX Bridge is [PrivMX Endpoint](https://github.com/simplito/privmx-endpoint), which handles the encryption.
Learn more about how PrivMX works with our [docs](https://docs.privmx.dev/).

# Introduction

We use the [JSON-rpc protocol](https://www.jsonrpc.org/specification) to call API methods.

Below is an example cURL command for querying the API to list Solutions:

<div class="center-column"></div>

```  c
curl -X POST -H "Content-Type: application/json" \
    -H "Authorization: one-of-our-authorization-methods" \
    --data-binary '{
        "jsonrpc": "2.0",
        "id": 0,
        "method": "solution/listSolutions",
        "params": {}
    }' \
    https://my-privmx-bridge-instance/api
```

# Authorization

### API Keys

You can access the API methods using API Keys. These keys have no time-to-live (TTL) but can be disabled or deleted. Each key is assigned a specific [scope](#api-scopes). You can create up to 10 API Keys by calling the method [manager/createApiKey](#manager-createapikey).

NOTICE: When you install PrivMX Bridge, you should receive your first API Key during the installation, and it should have full API access.

An API Key can be created without public key:

<div class="center-column"></div>

```c
curl -X POST -H "Content-Type: application/json" \
    -H "Authorization: one-of-our-authorization-methods" \
    --data-binary '{
        "jsonrpc": "2.0",
        "id": 0,
        "method": "manager/createApiKey",
        "params": {
            "name": "My ApiKey",
            "scope": ["apikey", "context", "solution"],
        }
    }' \
    https://my-privmx-bridge-instance/api
```

Or with an ED25519 PEM-encoded public key:

<div class="center-column"></div>

```c
curl -X POST -H "Content-Type: application/json" \
    -H "Authorization: one-of-our-authorization-methods" \
    --data-binary '{
        "jsonrpc": "2.0",
        "id": 0,
        "method": "manager/createApiKey",
        "params": {
            "name": "My ApiKey",
            "scope": ["apikey", "context", "solution"],
            "publicKey": "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEADsSTjY2wnm1iwWamIWwLTPVhtTIb8TVlI8tts3wkhkQ=\n-----END PUBLIC KEY-----",
        }
    }' \
    https://my-privmx-bridge-instance/api
```

You will receive an `id` and `secret` of API Key:

<div class="center-column"></div>

```c
{
    "jsonrpc":"2.0",
    "id":0,
    "result": {
        "id": "hysd62jsd7823nasd03",
        "secret": "759a1d8edba555badf1216b0f381b94950141"
    }
}
```

You can now authorize requests using your API Key in one of the following ways:

### Signatures

You can sign your request using your API Key.

First, prepare the data to be signed:

<div class="center-column"></div>

```js
apiKeyId = "6XMc4VMf3q54YNarSn9CWUn4htStNu1ry9ajamemdo23sS1y21";
requestPayload = '{"jsonrpc":"2.0","id":0,"method":"solution/listSolutions","params":{}}';
requestData = `POST\n/api\n${requestPayload}\n`; // UPPERCASE(HTTP_METHOD()) + "\n" + URI() + "\n" + RequestBody + "\n";
timestamp = 1702555410352;
nonce = "3xUee4EA0gr8dg==";
dataToSign = `${timestamp};${nonce};${requestData}`;
```

Next, generate a signature corresponding to your API Key credentials:

**HMAC signature**

<div class="center-column"></div>

```js
apiKeySecret = "CspXxVtTyE3sf6jB7z4CSjxoymuS2H67ZjNDfovTu3i8";
signature = BASE64(HMACSHA256(apiKeySecret, dataToSign).SUBARRAY(0, 20))
```

**ECC signature**, if you provided a `publicKey`:

<div class="center-column"></div>

```js
privateKey = "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIOBVFGaSFtfqbNvZWctFKg3k+I0T5YXRavpKAD9+BgCX\n-----END PRIVATE KEY-----";
signature = BASE64(SIGN(dataToSign, privateKey))
```

To sign a request, include the following in the `Authorization` header: 

<div class="center-column"></div>

```c
"pmx-hmac-sha256 ${apiKeyId};1;${timestamp};${nonce};${signature}"
```

<div class="center-column"></div>

```c
curl -X POST -H "Content-Type: application/json" \
    -H "Authorization: pmx-hmac-sha256 6XMc4VMf3q54YNarSn9CWUn4htStNu1ry9ajamemdo23sS1y21;1;1702555410352;3xUee4EA0gr8dg;JN5llLladWZ+1rGu6yrkbIQzme0=" \
    --data-binary '{
        "jsonrpc": "2.0",
        "id": 0,
        "method": "solution/listSolutions",
        "params": {}
    }' \
    https://my-privmx-bridge-instance/api
``` 

### API Key Credentials  

You can authorize the request by placing your API Key credentials in the `Authorization` header:

<div class="center-column"></div>

```js
basicAuthorization = BASE64(`${apiKeyId}:${apiKeySecret}`);
authorizationHeaderValue = `Basic ${basicAuthorization}`;
```

<div class="center-column"></div>

```c
curl -X POST -H "Content-Type: application/json" \
    -H "Authorization: Basic YWxpY2U6dGhlc2NlcmV0" \
    --data-binary '{
        "jsonrpc": "2.0",
        "id": 0,
        "method": "solution/listSolutions",
        "params": {}
    }' \
    https://my-privmx-bridge-instance/api
```
Note that you cannot use this authorization method if your API Key includes a public key. In such a case, only ECC signatures are available for this API Key.

### Access Tokens

Access Tokens have a TTL but can be refreshed using refresh tokens. You can generate them by calling [manager/auth](#manager-auth):

<div class="center-column"></div>

```c
curl -X POST \
    -H "Content-Type: application/json" \
    --data-binary '{
        "jsonrpc": "2.0",
        "id": 128,
        "method": "manager/auth",
        "params": {
            "scope": ["apikey", "solution"],
            "grantType": "api_key_credentials",
            "apiKeyId": "65ad8f6b2e4f4f1adb40bf68",
            "apiKeySecret": "5ZTUQ7VBxoqRKn3pEyPjHeavXHVw7JcJF3MvAV43yfsR"
        }
    }' \
    https://my-privmx-bridge-instance/api
```
You will receive an `access_token` and a `refresh_token`:

<div class="center-column"></div>

```c
{
    "jsonrpc": "2.0",
    "id": 128,
    "result": {
        "accessToken": "SXRzIGEgcmFuZG9tIHRleHQgZW5jb2RlZCBmb3IgdGhlIHRlc3RpbmcgcHVycG9zZSwgaWYgeW91IGRlY29kZWQgdGhpcyB0ZXh0LCB0cmVhdCBpcyBhcyBhIHNvcnQgb2YgZWFzdGVyIGVnZyA6KS4=",
        "accessTokenExpiry": 1726652150623,
        "refreshToken": "TG9yZW0gaXBzdW1Mb3JlbSBpcHN1bUxvcmVtIGlwc3VtTG9yZW0gaXBzdW1Mb3JlbSBpcHN1bUxvcmVtIGlwc3VtTG9yZW0gaXBzdW0=",
        "refreshTokenExpiry": 1726952150623,
        "tokenType": "Bearer",
        "scope": [
            "apiKey",
            "solution",
            "context"
        ]
    }
}
```

The Access Token can be used to authorize your request by placing it in the `Authorization` header:

<div class="center-column"></div>

```c
curl -X POST \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer SXRzIGEgcmFuZG9tIHRleHQgZW5jb2RlZCBmb3IgdGhlIHRlc3RpbmcgcHVycG9zZSwgaWYgeW91IGRlY29kZWQgdGhpcyB0ZXh0LCB0cmVhdCBpcyBhcyBhIHNvcnQgb2YgZWFzdGVyIGVnZyA6KS4=" \
    --data-binary '{
        "jsonrpc": "2.0",
        "id": 128,
        "method": "solution/listSolutions",
        "params": {}
    }' \
    https://my-privmx-bridge-instance/api
```

Access Tokens can be refreshed using refresh tokens by calling the [manager/auth](#auth-token) method:

<div class="center-column"></div>

```c
curl -X POST \
    -H "Content-Type: application/json" \
    --data-binary '{
        "jsonrpc": "2.0",
        "id": 128,
        "method": "manager/auth",
        "params": {
            "grantType": "refresh_token",
            "refreshToken": "TG9yZW0gaXBzdW1Mb3JlbSBpcHN1bUxvcmVtIGlwc3VtTG9yZW0gaXBzdW0=",
        }
    }' \
    https://my-privmx-bridge-instance/api   
```
In response, you will receive a new pair of tokens, and the old pair will be revoked.

### API Scopes

When requesting an Access Token, you can specify the scope, which defines the level of access granted. Here's a breakdown of the available scopes:

| Scope                      | Description |
|----------------------------|-------------|
| **session:NAME**            | Creates a new session with the provided name, generating tokens bound to that session. Access is granted for the session's lifetime. A user can have up to 16 sessions; when this limit is reached, the oldest session is removed. |
| **ipAddr:ADDR**             | Restricts the token to connections from a specific IPv4 address (ADDR). |
| **expiresIn:NUMBER**        | Access Token will expire after NUMBER of milliseconds. Max value is refresh token TTL. |
| **apiKey**                  | Restricts the token to manager api scope. |
| **solution**                | Restricts the token to solution api scope. |
| **context**                 | Restricts the token to context api scope. |
| **thread**                  | Restricts the token to thread api scope. |
| **store**                   | Restricts the token to store api scope. |
| **inbox**                   | Restricts the token to inbox api scope. |
| **stream**                  | Restricts the token to stream api scope. |
| **solution:SOLUTION_ID**    | Restricts the token to manage contexts only under given SOLUTION_ID. |
| **solution:***              | Restricts the token to manage all contexts. |
These scopes allow fine-grained control over what actions can be performed with the generated tokens, making it easier to manage permissions across different parts of the system.

# Metrics Documentation

### Overview
The application provides a `/metrics` endpoint that returns various metrics in a format compatible with Prometheus. The endpoint is protected by HTTP Basic Authorization for security.

### Metrics Endpoint

- **Endpoint:** `/metrics`
- **Access Control:** Requires HTTP Basic Authorization
- **Scrape Interval:** 1 minute (data older than 1 minute is discarded)
- **Bucket Clearing:** After each metric collection via the `/metrics` endpoint, the internal metrics bucket is cleared. This enables the endpoint to support scrape intervals shorter than 1 minute, if desired.

### Metrics Collected

The following metrics are available from the `/metrics` endpoint:

1. **privmx_bridge_error_gauge**
   - **Type:** Gauge
   - **Description:** Tracks the number of errors.
2. **privmx_bridge_cpu_execution_time_gauge**
   - **Type:** Gauge
   - **Description:** Measures the CPU time taken for executions.
3. **privmx_bridge_in_traffic_gauge**
   - **Type:** Gauge
   - **Description:** Records incoming traffic volume in bytes.
4. **privmx_bridge_out_traffic_gauge**
   - **Type:** Gauge
   - **Description:** Records outgoing traffic volume in bytes.
5. **privmx_bridge_request_gauge**
   - **Type:** Gauge
   - **Description:** Counts the number of requests.

Each of these metrics is exposed with the `# TYPE <metric_name> gauge` format.
