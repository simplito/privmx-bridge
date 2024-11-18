/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable no-console */

import { ConnectionError } from "../../utils/HttpClient";
import { HttpClient2 } from "../../utils/HttpClient2";
import { RequestSignature } from "../../utils/RequestSignature";
import { Utils } from "../../utils/Utils";
import * as util from "util";
import * as types from "../../types";

function extractArgs() {
    const options: string[] = [];
    const restParams: string[] = [];
    for (const arg of process.argv.slice(2)) {
        if (arg.startsWith("-")) {
            options.push(arg);
        }
        else {
            restParams.push(arg);
        }
    }
    if (restParams.length !== 2) {
        return "Invalid number of parameters";
    }
    const res = {
        method: restParams[0],
        params: restParams[1],
        rawString: false,
        checkJsonRpcSuccess: true,
        jsonFormat: ".",
        apiKeyId: null as string|null,
        apiKeySecret: null as string|null,
        apiUrl: null as string|null,
        auth: null as string|null,
    };
    for (const option of options) {
        if (option === "-r") {
            res.rawString = true;
        }
        else if (option === "-e") {
            res.checkJsonRpcSuccess = true;
        }
        else if (option === "-ne") {
            res.checkJsonRpcSuccess = false;
        }
        else if (option.startsWith("--json=")) {
            res.jsonFormat = option.slice("--json=".length);
            if (!res.jsonFormat.startsWith(".")) {
                return "Invalid json format";
            }
        }
        else if (option.startsWith("--apikeyid=")) {
            res.apiKeyId = option.slice("--apikeyid=".length);
        }
        else if (option.startsWith("--apikeysecret=")) {
            res.apiKeySecret = option.slice("--apikeysecret=".length);
        }
        else if (option.startsWith("--apiurl=")) {
            res.apiUrl = option.slice("--apiurl=".length);
        }
        else if (option.startsWith("--auth=")) {
            res.auth = option.slice("--auth=".length);
        }
        else {
            return "Unknown option " + option;
        }
    }
    return res;
}

function consoleErr(str: string) {
    process.stderr.write(str + "\n");
}
    
function isJsonRpcSuccessfullResponse(jRpc: any): boolean {
    return typeof(jRpc) == "object" && jRpc != null && jRpc.jsonrpc == "2.0" && "result" in jRpc;
}

async function go() {
    const args = extractArgs();
    if (typeof(args) === "string") {
        consoleErr(args);
        consoleErr("Usage:");
        consoleErr("  ./cli.sh <method> <params> [options]");
        consoleErr("Options:");
        consoleErr("  --apikeyid=        API Key Id, alternatively you can pass it through API_KEY_ID environment variable");
        consoleErr("  --apikeysecret=    API Key Secret, alternatively you can pass it through API_KEY_SECRET environment variable");
        consoleErr("  --apiurl=          API Url, if not passed the url will be http://localhost:{env.PRIVMX_PORT|3000}/api");
        consoleErr("  --json=            Pass the path to the property from the server response that you want to print. The default is '.'. The format is similar to the jq tool, for example, '.result'.");
        consoleErr("  --auth=basic|hmac  Make request using choosen authorization method");
        consoleErr("  -r                 Remove the surrounding quotes. This works only when you print a string.");
        consoleErr("  -ne                Does not end with error when the server does not return a successful JSON-RPC result.");
        consoleErr("API methods:");
        consoleErr("  manager/auth {grantType: refresh_token, refreshToken: string}");
        consoleErr("  manager/auth {grantType: api_key_credentials, apiKeyId: string, apiKeySecret: string, scope: string[]}");
        consoleErr("");
        consoleErr("  manager/createApiKey {name: string, scope: string[]}");
        consoleErr("  manager/getApiKey {id: string}");
        consoleErr("  manager/listApiKeys {}");
        consoleErr("  manager/updateApiKey {id: string, name?: string, scope?: string[], enabled?: boolean}");
        consoleErr("  manager/deleteApiKey {id: string}");
        consoleErr("");
        consoleErr("  solution/getSolution {id: string}");
        consoleErr("  solution/listSolutions {}");
        consoleErr("  solution/createSolution {name: string}");
        consoleErr("  solution/updateSolution {id: string, name: string}");
        consoleErr("  solution/deleteSolution {id: string}");
        consoleErr("");
        consoleErr("  context/getContext {contextId: string}");
        consoleErr("  context/listContexts {skip: number, limit: number, sortOrder: asc|desc}");
        consoleErr("  listContextsOfSolution {solutionId: string, skip: number, limit: number, sortOrder: asc|desc}");
        consoleErr("  context/createContext {solution: string, name: string, description: string, scope: private|public}");
        consoleErr("  context/updateContext {contextId: string, name?: string, description?: string, scope?: private|public}");
        consoleErr("  context/deleteContext {contextId: string}");
        consoleErr("  context/addSolutionToContext {contextId: string, solutionId: string}");
        consoleErr("  context/removeSolutionFromContext {contextId: string, solutionId: string}");
        consoleErr("  context/addUserToContext {contextId: string, userId: string, userPubKey: string, acl?: string}");
        consoleErr("  context/removeUserFromContext {contextId: string, userId: string}");
        consoleErr("  context/removeUserFromContextByPubKey {contextId: string, userPubKey: string}");
        consoleErr("  context/getUserFromContext {contextId: string, userId: string}");
        consoleErr("  context/getUserFromContextByPubKey {contextId: string, pubKey: string}");
        consoleErr("  context/listUsersFromContext {contextId: string, skip: number, limit: number, sortOrder: asc|desc}");
        consoleErr("  context/setUserAcl {contextId: string userId: string, acl: string}");
        process.exit(1);
    }
    if (!args.apiKeyId) {
        args.apiKeyId = process.env.API_KEY_ID || null;
        if (!args.apiKeyId) {
            consoleErr("API Key Id is not provided. Pass it through --apikeyid= option or by API_KEY_ID environment variable");
            process.exit(1);
        }
    }
    if (!args.apiKeySecret) {
        args.apiKeySecret = process.env.API_KEY_SECRET || null;
        if (!args.apiKeySecret) {
            consoleErr("API Key Secret is not provided. Pass it through --apikeysecret= option or by API_KEY_SECRET environment variable");
            process.exit(1);
        }
    }
    if (!args.apiUrl) {
        args.apiUrl = `http://localhost:${process.env.PRIVMX_PORT ? process.env.PRIVMX_PORT : 3000}/api`;
    }
    if (!args.auth) {
        args.auth = "hmac";
    }
    const urlObj = new URL(args.apiUrl);
    const body = Buffer.from(`{"jsonrpc": "2.0", "id": 1, "method": "${args.method}", "params": ${args.params}}`, "utf8");
    const authorization = (() => {
        if (args.auth === "basic") {
            return `Basic ${Buffer.from(`${args.apiKeyId}:${args.apiKeySecret}`, "utf8").toString("base64")}`;
        }
        if (args.auth === "hmac") {
            return `${RequestSignature.PMX_HMAC_SHA256} ${RequestSignature.signHmacToHeader(RequestSignature.addNonceAndTimestamp({
                apiKeyId: args.apiKeyId as types.auth.ApiKeyId,
                apiKeySecret: args.apiKeySecret as types.auth.ApiKeySecret,
                httpMethod: "POST",
                urlPath: urlObj.pathname,
                requestBody: body,
            }))}`;
        }
        consoleErr(`Unsupported authorization method '${args.auth}'`);
        process.exit(1);
    })();
    const res = await HttpClient2.post(args.apiUrl, {
        "Content-Type": "application/json",
        "Authorization": authorization,
    }, body);
    const response = res.toString("utf8");
    if (args.jsonFormat) {
        const json = Utils.try(() => JSON.parse(response));
        if (json.success === false) {
            consoleErr(response);
            throw new Error("Response is not a JSON");
        }
        const parts = args.jsonFormat === "." ? [] : args.jsonFormat.slice(1).split(".");
        let current = json.result;
        for (const part of parts) {
            if (current) {
                current = current[part];
            }
        }
        console.log(args.rawString && typeof(current) === "string" ? current : JSON.stringify(current, null, 2));
        process.exit(args.checkJsonRpcSuccess && !isJsonRpcSuccessfullResponse(json.result) ? 1 : 0);
    }
    else {
        console.log(response);
    }
}

go().catch(e => {
    if (e instanceof ConnectionError) {
        consoleErr("ConnectionError: " + util.format(e.data));
    }
    else {
        consoleErr("Error: " + util.format(e));
    }
    process.exit(1);
});
