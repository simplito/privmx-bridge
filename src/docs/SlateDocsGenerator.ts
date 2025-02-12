/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/*  eslint-disable no-console */
import * as path from "path";
import * as fs from "fs";
import * as types from "./docsGeneratorTypes";
import { Validator } from "adv-validator/out/Types";
import { ApiVersion } from "../api/Version";

export class SlateDocsGenerator {
    
    private slateDir: string;
    private jsonRpcErrorCodes?: types.JsonRpcErrorCodes;
    
    constructor() {
        this.slateDir = path.resolve(__dirname, "../../slatedocs");
    }
    
    createArrayFromMap<T>(map: {[name: string]: T}): T[] {
        const array: T[] = [];
        for (const key in map) {
            array.push(map[key]);
        }
        return array;
    }
    
    async generateMarkdownFromJson(jsonDocs: types.JsonDocs) {
        const forbiddenApis = ["MailApi", "ManagementApi", "NotificationApi", "ManagementDeveloperApi", "ManagementContextApi", "ManagementOrganizationApi", "ManagementSolutionApi", "ManagementInstanceApi", "LicenseApi"];
        const apisArray = this.createArrayFromMap(jsonDocs.apis).sort((a, b) => a.name.localeCompare(b.name));
        const files: string[] = [];
        this.jsonRpcErrorCodes = jsonDocs.jsonRpcErrors;
        await this.generatePreamble(files);
        console.log("Premable generated");
        for (const api of apisArray.filter(x => !forbiddenApis.includes(x.name))) {
            await this.generateMarkdownFromApi(files, api);
            console.log(`${api.name} docs generated`);
        }
        await this.generateNotificationSection(files, apisArray);
        
        await this.generateErrorCodesSection(files, jsonDocs.httpErrorCodes, jsonDocs.jsonRpcErrors, jsonDocs.errorsWithDescription);
        console.log("Error codes section generated");
        
        await this.generateDetailsSection(files);
        console.log("Details section generated");
        
        await this.generateAclGroupsSection(jsonDocs.aclGroups, files);
        console.log("ACL Section generated");
        
        await this.changeIncludesInIndex(files);
    }
    
    async generateDetailsSection(files: string[]) {
        const fileName = "Details";
        files.push(`_${fileName}.md`);
        const filePath = path.resolve(this.slateDir, `includes/_${fileName}.md`);
        await fs.promises.mkdir(path.dirname(filePath), {recursive: true});
        await fs.promises.writeFile(filePath, "# Details\n");
    }
    
    async generateAclGroupsSection(aclGroups: types.AclGroups, files: string[]) {
        const header = `
Function | parameters
-------- | -------`;
        
        const markdownAclGroups: string[] = ["# ACL Groups and functions"];
        for (const groupName in aclGroups.groups) {
            const groupFunctions = aclGroups.groups[groupName];
            markdownAclGroups.push(`\n### ${groupName}`);
            markdownAclGroups.push(header);
            for (const functionName in groupFunctions) {
                markdownAclGroups.push(`${functionName} | ${groupFunctions[functionName].join("</br>")}`);
            }
        }
        const fileName = "Acl";
        files.push(`_${fileName}.md`);
        const filePath = path.resolve(this.slateDir, `includes/_${fileName}.md`);
        await fs.promises.mkdir(path.dirname(filePath), {recursive: true});
        await fs.promises.writeFile(filePath, markdownAclGroups.join("\n"));
    }
    
    async generateNotificationSection(files: string[], apis: types.Api[]) {
        const fileName = "notifications";
        const filePath = path.resolve(this.slateDir, `includes/_${fileName}.md`);
        await fs.promises.mkdir(path.dirname(filePath), {recursive: true});
        const notificationApi = apis.find(api => api.name === "NotificationApi");
        if (!notificationApi) {
            return;
        }
        const notifyMethod = notificationApi.methods.notify;
        if (notifyMethod.parameters.model.type.kind !== "union") {
            return;
        }
        const notificationsModels = notifyMethod.parameters.model.type;
        const events: types.ObjectType[] = [];
        for (const type of notificationsModels.types) {
            if (type.kind !== "object") {
                return;
            }
            events.push(type.properties.event.type as types.ObjectType);
        }
        
        const notificationMarkdowns: string[] = [];
        for (const event of events) {
            notificationMarkdowns.push(this.generateAndCollectMarkdownForObjectType(0, event));
        }
        
        const result =
`# Notifications

# WebSocket Notifications

List of possible received notifications through websocket:
${notificationMarkdowns.join("")}
`;
        await fs.promises.writeFile(filePath, result);
        files.push(`_${fileName}.md`);
    }
    
    async changeIncludesInIndex(files: string[]) {
        const indexFile = path.resolve(this.slateDir, "includes/index.md.erb");
        await fs.promises.mkdir(path.dirname(indexFile), {recursive: true});
        const newContent = files.map(x => `<%= partial "includes/${x}" %>`).join("\n");
        await fs.promises.writeFile(indexFile, newContent);
    }
    
    async generateMarkdownFromApi(files: string[], api: types.Api) {
        const fileName = `${api.name}-`;
        files.push(`methods/_${fileName}.md`);
        const filePath = path.resolve(this.slateDir, `includes/methods/_${fileName}.md`);
        await fs.promises.mkdir(path.dirname(filePath), {recursive: true});
        await fs.promises.writeFile(filePath, `# ${api.name.slice(0, -3)}`);
        const methodsArray = this.createArrayFromMap(api.methods).sort((a, b) => a.name.localeCompare(b.name));
        for (const method of methodsArray) {
            await this.generateMarkdownFromApiMethod(files, api, method);
        }
    }
    
    generateUnionDescription(type: types.UnionType) {
        const namesAndValues = type.types.map(element => (element.kind === "literal") ? "\"" + element.value + "\"" : (element.kind === "object") ? element.name : "");
        return `one of the following: ${namesAndValues.join(", ")}\n`;
    }
    
    async generateMarkdownFromApiMethod(files: string[], api: types.Api, method: types.ApiMethod) {
        const methodParametersArray = this.createArrayFromMap(method.parameters);
        const parameters = (() => {
            if (methodParametersArray.length === 0) {
                return null;
            }
            if (methodParametersArray.length === 1 || (methodParametersArray.length === 2 || methodParametersArray[1].name === "challenge")) {
                const param = methodParametersArray[0];
                if (param.type.kind === "object" || param.type.kind === "union") {
                    return param.type;
                }
            }
            throw new Error(`Invalid method parameters for ${api.name}.${method.name}`);
        })();
        const fileName = `${api.name}-${method.name}`;
        files.push(`methods/${fileName}`);
        const filePath = path.resolve(this.slateDir, `includes/methods/_${fileName}.md`);
        await fs.promises.mkdir(path.dirname(filePath), {recursive: true});
        const parametersMarkdown = (parameters) ? this.generateAndCollectMarkdownForObjectType(0, parameters) : "No parameters";
        const responseMarkdown = this.generateAndCollectMarkdownForObjectType(0, this.getJsonRpcResponseObject(method.returns));
        const errorCodes = method.options.errorCodes || [];
        const scope = method.options.scope || [];
        const secondFactorRequired = method.options.secondFactorRequired || false;
        const result =
`## ${method.fullName}

${method.description || "_No description_"}
${(scope.length > 0) ? `### Requires scope: \`\`\`${scope.join(",")}\`\`\` ` : ""}
${(secondFactorRequired) ? "**Requires Two-Factor Authorization**" : ""}


### Parameters
${this.generateCodeExamplesForMethod(method)}
${this.generateCurlExampleForMethod(method)}
${this.generateMethodExampleResponse(method)}

${(methodParametersArray.length === 1 && methodParametersArray[0].type.kind === "union") ? this.generateUnionDescription(methodParametersArray[0].type) : ""}
${parametersMarkdown}

### Response

${responseMarkdown}

### Additional errors

${errorCodes.length > 0 ? `Error Code | Message |
---------- | ------- |
${errorCodes.map(x => (this.jsonRpcErrorCodes) ? `${this.jsonRpcErrorCodes[x].code} | ${this.jsonRpcErrorCodes[x].message}` : "").join("\n")}
` : "No additional errors"}

`;
        await fs.promises.writeFile(filePath, result);
    }
    generateCurlExampleForMethod(method: types.ApiMethod) {
        const commandExample = "```shell\n" + `${this.getCurlCommand(method)}` + "\n```";
        return commandExample;
    }
    
    generateCodeExamplesForMethod(method: types.ApiMethod) {
        const payload = JSON.stringify({jsonrpc: "2.0", id: 128, method: method.fullName, params: method.exampleParameters}, null, 4).split("\n").map(e => "    " + e).join("\n").trimStart();
        const codeExample =
"```javascript\n" +
`const response = await fetch("https://my-privmx-bridge-instance/api", {
    method: "POST",
    body: JSON.stringify(${payload}),
    headers: {
        "Content-type": "application/json"${(method.fullName.startsWith("manager/auth")) ? "" : ", \n\t\t\"Authorization\": \"Bearer TOKEN\""}
    }
});` + "\n```";
        return codeExample;
    }
    
    generateAndCollectMarkdownForObjectType(ident: number, object: types.ObjectType | types.UnionType) {
        const additionalTypesList: string[] = [];
        const objectString = this.generateMarkdownForObjectType(ident, object, additionalTypesList);
        return `${objectString ? objectString + " " : ""}${additionalTypesList.join("\n")}`;
    }
    
    generateMarkdownForObjectType(ident: number, object: types.ObjectType | types.UnionType, additionalTypesList: string[]): string {
        if (object.kind === "object") {
            const header = `
Parameter | Type | Enum | Description
--------- | ---- | ---- | -----------\n`;
            const props = this.createArrayFromMap(object.properties).map(x => this.generateMarkdownForProp(ident, x, additionalTypesList));
            return `${(ident === 0) ? header : ""}${props.join("\n")}`;
        }
        else if (object.kind === "union") {
            for (const element of object.types) {
                if (element.kind === "object") {
                    additionalTypesList.push(`### ${element.name}\n` + this.generateMarkdownForObjectType(0, element, additionalTypesList));
                }
                else if (element.kind === "literal") {
                    // do nothing
                }
                else {
                    throw new Error(`Unsupported type in union ${element.kind}`);
                }
            }
            return "";
        }
        throw new Error("Pass neither object or union");
    }
    
    generateMarkdownForProp(ident: number, prop: types.PropertyDeclaration, additionalTypesList: string[]) {
        if (prop.type.kind === "union") {
            prop.type.types.map(element => element.parent = prop.name);
        }
        const {type, enumStr, addition, description, validationInfo, hasAdditionalInfo} = this.produceTypeInfo(ident, prop.type, additionalTypesList);
        const propDescription = (prop.optional ? "*(optional)* " : "") + ((prop.description ? prop.description + (hasAdditionalInfo ? ", " + description : "") : description) || "");
        const md = `${this.generateIdent(ident)}${prop.name} | ${type} | ${enumStr ? enumStr : ""} | ${prop.type.kind === "nullable" ? "*(nullable)* " : ""}${propDescription}${validationInfo ? validationInfo : ""}${addition ? addition : ""}`;
        return (md.endsWith("\n")) ? md.slice(0, -1) : md;
    }
    
    produceTypeInfo(ident: number, type: types.Type, additionalTypesList: string[]): {type: any, enumStr?: string, addition?: any, description?: string, validationInfo?: string, hasAdditionalInfo?: boolean} {
        if (type.kind === "primitive") {
            return {type: type.type, validationInfo: type.validator ? this.generateValidatorInfoString(type.validator) : ""};
        }
        if (type.kind === "literal") {
            return {type: type.type, enumStr: type.value};
        }
        if (type.kind === "enum") {
            return {type: type.type, enumStr: type.values.map(x => x.toString()).join("<br>")};
        }
        if (type.kind === "nullable") {
            return this.produceTypeInfo(ident, type.type, additionalTypesList);
        }
        if (type.kind === "array") {
            const sub = type.type.kind === "nullable" ? type.type.type : type.type;
            if (sub.kind === "primitive") {
                return {type: `array of ${sub.type}`, validationInfo: (type.validator) ? this.generateValidatorInfoString(type.validator) : ""};
            }
            if (sub.kind === "literal") {
                return {type: `array of ${sub.type}`, validationInfo: (type.validator) ? this.generateValidatorInfoString(type.validator) : ""};
            }
            if (sub.kind === "enum") {
                return {type: "array of enum", enumStr: sub.values.map(x => x.toString()).join("<br>"), validationInfo: (type.validator) ? this.generateValidatorInfoString(type.validator) : ""};
            }
            if (sub.kind === "object") {
                return {type: "array of object", description: sub.description, addition: "\n" + this.generateMarkdownForObjectType(ident + 1, sub, additionalTypesList), validationInfo: (type.validator) ? this.generateValidatorInfoString(type.validator) : ""};
            }
            if (sub.kind === "union") {
                return {type: "array of object", description: this.generateUnionDescription(sub), addition: this.generateMarkdownForObjectType(ident + 1, sub, additionalTypesList), validationInfo: (type.validator) ? this.generateValidatorInfoString(type.validator) : ""};
            }
            throw new Error(`Unsupported array element type ${sub.kind}`);
        }
        if (type.kind === "object") {
            return {type: "object", description: type.description, addition: "\n" + this.generateMarkdownForObjectType(ident + 1, type, additionalTypesList)};
        }
        if (type.kind === "union") {
            return {type: "union", description: `${this.generateUnionDescription(type)}`, addition: this.generateMarkdownForObjectType(ident, type, additionalTypesList), hasAdditionalInfo: true};
        }
        if (type.kind === "typeDeclaration") {
            return {type: "generic"};
        }
        throw new Error(`Unsupported type ${(type as any).kind}`);
    }
    
    generateValidatorInfoString(validator: Validator) {
        if (validator.type === "int" || validator.type === "float" || validator.type === "strint") {
            return ` (in range: [${(validator.min || validator.min === 0) ? validator.min : "-∞" },${(validator.max || validator.max === 0) ? validator.max : "∞"}])`;
        }
        else if (validator.type === "string" || validator.type === "email" || validator.type === "buffer" || validator.type === "list") {
            return ` (length in [${(validator.minLength) ? validator.minLength : "0"},${(validator.maxLength) ? validator.maxLength : "∞"}])`;
        }
        return "";
    }
    
    generateIdent(width: number) {
        return Array.from(Array(width).keys()).map(() => "&nbsp;&nbsp;›&nbsp;&nbsp;").join("");
    }
    
    getJsonRpcResponseObject(response: types.ReturnedType): types.ObjectType {
        return {
            kind: "object",
            name: "",
            description: "",
            properties: {
                "id": {name: "id", description: "ID sent in the request", optional: false, type: {kind: "primitive", type: "number"}},
                "jsonrpc": {name: "jsonrpc", description: "The JSON-RPC version", optional: false, type: {kind: "literal", type: "string", value: "2.0"}},
                "result": {name: "result", description: response.description, optional: false, type: response.type},
            },
        };
    }
    
    getMethodInfoForCurl(method: types.ApiMethod) {
        const headerName = (method.fullName.startsWith("manager/auth")) ? "" : "Authorization";
        const value = (method.fullName.startsWith("manager/auth")) ? "" : "Bearer TOKEN";
        const endpoint = "/types";
        const params = method.exampleParameters;
        const payload = JSON.stringify({jsonrpc: "2.0", id: 128, method: method.fullName, params: params}, null, 4);
        return {endpoint, method, params, tokenValue: value, tokenHeader: headerName, payload};
    }
    
    getCurlCommand(method: types.ApiMethod) {
        const callInfo = this.getMethodInfoForCurl(method);
        const jsonRpcRequest = callInfo.payload.split("\n").map(e => "    " + e).join("\n").trimStart();
        const command = `curl -X POST \\\n    -H "Content-Type: application/json"${callInfo.tokenHeader ? ` -H "${callInfo.tokenHeader}: ${callInfo.tokenValue}"` : ""} \\\n    --data-binary '${jsonRpcRequest}' \\\n    https://my-privmx-bridge-instance${callInfo.endpoint}`;
        return command;
    }
    
    generateMethodExampleResponse(method: types.ApiMethod) {
        const exampleResposne = "> The command above returns JSON structured like this:\n\n" + "```json\n" + `${JSON.stringify({jsonrpc: "2.0", id: 128, result: method.exampleResult}, null, 4)}` + "\n```";
        return exampleResposne;
    }
    
    async generatePreamble(files: string[]) {
        const fileName = "preamble";
        files.push(`_${fileName}.md`);
        const filePath = path.resolve(this.slateDir, `includes/_${fileName}.md`);
        await fs.promises.mkdir(path.dirname(filePath), {recursive: true});
        const result =
`
# Methods
Note: Every API request can return any of the common errors, which are only specified in [Error Codes section](#common-errors) not to duplicate them in every method description.
`;
        await fs.promises.writeFile(filePath, result);
    }
    
    async generateErrorCodesSection(files: string[], httpErrorCodes: types.HttpErrorCode[], jsonRpcErrorCodes: types.JsonRpcErrorCodes, commonErorrs: types.ErrorWithDescription[]) {
        const fileName = "errorCodes";
        files.push(`_${fileName}.md`);
        const filePath = path.resolve(this.slateDir, `includes/_${fileName}.md`);
        await fs.promises.mkdir(path.dirname(filePath), {recursive: true});
        const result =
`# Errors

# HTTP error codes

Error Code | Message | Description
---------- | --------|-----------
${httpErrorCodes.map(error => `${error.errorCode} | ${error.message} | ${error.description}`).join("\n")}

# Common Errors
Every API request can return any of the common errors, so they are not specified in the method descriptions to avoid duplication.

Error Code | Message | Description |
---------- | ------- |-------------|
${commonErorrs.map(x => `${x.code} | ${x.message} | ${x.description}`).join("\n")}

# Other JSON-RPC error codes

Error Code | Message | Description
---------- | --------|-----------
${this.createArrayFromMap(jsonRpcErrorCodes).filter(x => (!commonErorrs.some(e => e.code === x.code))).map( x => `${x.code} | ${x.message} | ${x.description || ""}`).join("\n")}
`;
        await fs.promises.writeFile(filePath, result);
    }
    
    async setApiVersion() {
        const layoutPath = path.resolve(__dirname, "../../slatedocs/layouts/layout.erb");
        const layotuContent = await fs.promises.readFile(layoutPath, "utf8");
        const newLayotuContent = layotuContent.replace(/(<span id="api-version">)(.+?)(<\/span>)/gi, `$1 ${ApiVersion} $3`);
        await fs.promises.writeFile(layoutPath, newLayotuContent, "utf8");
    }
}
