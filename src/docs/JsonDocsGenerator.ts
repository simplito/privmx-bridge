/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/*  eslint-disable no-console */
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import { ERROR_CODES } from "../api/AppException";
import * as ApiRegistry from "../test/api/Registry";
import { ApiFunc, ApiResult } from "../test/api/Utils";
import * as types from "./docsGeneratorTypes";
import { Validator } from "adv-validator/out/Types";
import { Utils } from "../utils/Utils";

const LOG_LEVEL = 2;

function debugLog(...args: unknown[]) {
    if (LOG_LEVEL >= 2) {
        console.log(...args);
    }
}

export class JsonDocsGenerator {
    
    readonly baseDir: string;
    readonly program: ts.Program;
    readonly typeChecker: ts.TypeChecker;
    readonly forbiddenApis = ["IStreamApi"];
    
    constructor() {
        this.baseDir = path.resolve(__dirname, "../../");
        const tsConfig = JSON.parse(fs.readFileSync(path.resolve(this.baseDir, "tsconfig.json"), "utf8")) as {compilerOptions: ts.CompilerOptions};
        const tsOptions = ts.convertCompilerOptionsFromJson(tsConfig, "");
        const initFileName = path.resolve(this.baseDir, "src/index.ts");
        
        this.program = ts.createProgram([initFileName], tsOptions.options);
        this.typeChecker = this.program.getTypeChecker();
    }
    
    getDocsFromProject(): types.JsonDocs {
        const result = {
            errorsWithDescription: this.getErrorsWithDescription(),
            apis: this.findApis(),
            httpErrorCodes: this.getHttpErrorCodes(),
            jsonRpcErrors: ERROR_CODES,
            aclGroups: this.loadAclGroups(),
        };
        return result;
    }
    
    private loadAclGroups() {
        const content = fs.readFileSync(path.resolve(__dirname, "../../src/docs/acl.json"));
        return JSON.parse(content.toString()) as types.AclGroups;
    }
    
    private findApis() {
        const result: {[name: string]: types.Api} = {};
        const apiDir = path.resolve(this.baseDir, "src/api/plain");
        const apiFiles = this.program.getSourceFiles().filter(sourceFile => sourceFile.fileName.startsWith(apiDir));
        for (const apiFile of apiFiles) {
            this.findApi(apiFile, api => result[api.name] = api);
        }
        return result;
    }
    
    private findApi(apiFile: ts.SourceFile, onApi: (api: types.Api) => void) {
        debugLog(`Processing ${apiFile.fileName}`);
        for (const statement of apiFile.statements) {
            if (ts.isModuleDeclaration(statement)) {
                for (const st of (statement.body as ts.ModuleBlock)?.statements || []) {
                    this.findApiInStatement(st, onApi);
                }
            }
            else {
                this.findApiInStatement(statement, onApi);
            }
        }
    }
    
    private findApiInStatement(statement: ts.Statement, onApi: (api: types.Api) => void) {
        if (!ts.isInterfaceDeclaration(statement)) {
            return;
        }
        const interfaceName = statement.name.escapedText.toString();
        if (!this.isApiInterfaceName(interfaceName) || this.forbiddenApis.includes(interfaceName)) {
            return;
        }
        debugLog("Interface found", interfaceName);
        const api: types.Api = {
            name: interfaceName.slice(1),
            prefix: interfaceName[1].toLocaleLowerCase() + interfaceName.slice(2, interfaceName.length - 3),
            methods: {},
        };
        const apiInfoFunc = (ApiRegistry as {[name: string]: ApiFunc})[api.name];
        if (!apiInfoFunc) {
            console.log(`Cannot find api info for ${api.name}`);
            return;
        }
        const apiInfo = apiInfoFunc();
        for (const member of statement.members) {
            const method = this.tryReadMethod(api.prefix, api.name, apiInfo, member);
            if (method) {
                api.methods[method.name] = method;
            }
        }
        onApi(api);
    }
    
    private validateAndEnrichTypeInfo(parameter: ts.ParameterDeclaration, validator: Validator) {
        const propertyTypes = parameter.type ? this.readType(parameter.type) : {kind: "primitive", type: "unknown"} as types.PrimitiveType;
        if (propertyTypes.kind === "object") {
            const propertyTypeKeys = Object.keys(propertyTypes.properties);
            propertyTypeKeys.forEach(key => {
                propertyTypes.properties[key].type.validator = this.checkAndGetValidator(validator, propertyTypes.properties[key]);
            });
        }
        else if (propertyTypes.kind === "union") {
            for (const propertyType of propertyTypes.types) {
                if (propertyType.kind === "object") {
                    const propertyTypeKeys = Object.keys(propertyType.properties);
                    propertyTypeKeys.forEach(key => {
                        propertyType.properties[key].type.validator = this.checkAndGetValidator(validator, propertyType.properties[key]);
                    });
                }
                else {
                    propertyType.validator = validator;
                }
            }
        }
        else {
            propertyTypes.validator = validator;
        }
        return propertyTypes;
    }
    
    private checkAndGetValidator(validator: Validator, property: types.PropertyDeclaration) {
        const typesMap = {
            "int": "number",
            "float": "number",
            "enum": "enum",
            "string": "string",
            "strint": "string",
            "email": "string",
            "null": "null",
            "any": "any",
            "buffer": "buffer",
            "const": "literal",
            "list": "array",
            "map": "object",
            "custom": "object",
            "object": "object",
            "union": "union",
            "bool": "boolean",
            "oneOf": "array",
        };
        if (validator.type === "object") {
            if (validator.spec[property.name] && (typesMap[validator.spec[property.name].type] ===  property.type.kind || ((property.type.kind == "literal" || property.type.kind == "primitive") ? typesMap[validator.spec[property.name].type] == property.type.type : false))) {
                return validator.spec[property.name];
            }
        }
        else if (validator.type === "oneOf") {
            for (const spec of validator.specs) {
                if (spec.type === "object" && spec.spec[property.name]) {
                    if (typesMap[spec.spec[property.name].type] ===  property.type.kind || ((property.type.kind == "literal" || property.type.kind == "primitive") ? typesMap[spec.spec[property.name].type] == property.type.type : false)) {
                        return spec.spec[property.name];
                    }
                }
                else if (typesMap[spec.type] ===  property.type.kind || ((property.type.kind == "literal" || property.type.kind == "primitive") ? typesMap[spec.type] == property.type.type : false)) {
                    return spec;
                }
                
            }
        }
        return undefined;
    }
    
    private tryReadMethod(prefix: string, apiName: string, apiInfo: ApiResult, member: ts.TypeElement): types.ApiMethod|null {
        if (!ts.isMethodSignature(member) || !member.type) {
            return null;
        }
        const returnType = this.tryExtractTypeFromPromise(member.type);
        if (!returnType) {
            return null;
        }
        const comment = this.tryReadComment(member);
        const methodName = member.name.getText();
        const methodInfo = apiInfo.entries.find(x => x.method === methodName);
        const validator = Utils.try(() => apiInfo.validator.getValidator(methodName));
        if (validator.success === false) {
            // throw validator.error;
            console.log(`Cannot find validator for ${apiName}.${methodName}`);
            return null;
        }
        if (validator.result.type !== "object" && validator.result.type !== "oneOf") {
            throw new Error("Validator is not an object");
        }
        if (!methodInfo) {
            // throw new Error(`Cannot find coresponding method in registry ${apiName}.${methodName}`);
            console.log(`Cannot find coresponding method in registry ${apiName}.${methodName}`);
            return null;
        }
        const method: types.ApiMethod = {
            name: methodName,
            fullName: `${prefix}/${methodName}`,
            description: comment?.description || "",
            parameters: {},
            exampleParameters: methodInfo.params,
            exampleResult: methodInfo.result,
            returns: {
                description: comment?.returns || "",
                type: this.readType(returnType),
            },
            options: methodInfo.options,
        };
        member.parameters.map(x => {
            const paramName = x.name.getText();
            const paramComment = comment?.params.find(y => y.name === paramName)?.desc || "";
            const propertyTypes = this.validateAndEnrichTypeInfo(x, validator.result);
            method.parameters[paramName] = this.readMethodParameter(x, paramComment, propertyTypes);
        });
        return method;
    }
    
    private tryReadComment(node: ts.Node) {
        const comments = ts.getLeadingCommentRanges(node.getSourceFile().getFullText(), node.getFullStart());
        if (!comments) {
            return null;
        }
        for (const comment of comments) {
            const commentText = node.getSourceFile().getFullText().slice(comment.pos, comment.end);
            const parsed = this.parseComment(commentText);
            if (parsed) {
                return parsed;
            }
        }
        return null;
    }
    
    private tryExtractTypeFromPromise(type: ts.TypeNode) {
        return ts.isTypeReferenceNode(type) && type.typeName.getText() === "Promise" && type.typeArguments && type.typeArguments.length === 1 ? type.typeArguments[0] : null;
    }
    
    private readMethodParameter(param: ts.ParameterDeclaration, description: string, type: types.Type) {
        const res: types.PropertyDeclaration = {
            name: param.name.getText(),
            description: description,
            optional: !!param.questionToken,
            type: type,
        };
        return res;
    }
    
    private readType(type: ts.TypeNode): types.Type {
        if (ts.isTypeReferenceNode(type)) {
            if (ts.isIdentifier(type.typeName) && typeof type.typeName.escapedText === "string") {
                if ((type.typeName.escapedText as string) === "Query") {
                    return {kind: "object", name: "Query", description: "query", properties: {}};
                }
            }
            const theType = this.typeChecker.getTypeFromTypeNode(type);
            return this.readTheType(theType);
        }
        if (type.kind === ts.SyntaxKind.StringKeyword) {
            return {kind: "primitive", type: "string"};
        }
        if (type.kind === ts.SyntaxKind.BooleanKeyword) {
            return {kind: "primitive", type: "boolean"};
        }
        if (type.kind === ts.SyntaxKind.NumberKeyword) {
            return {kind: "primitive", type: "number"};
        }
        if (type.kind === ts.SyntaxKind.AnyKeyword) {
            return {kind: "primitive", type: "unknown"};
        }
        if (type.kind === ts.SyntaxKind.UndefinedKeyword) {
            return {kind: "primitive", type: "unknown"};
        }
        if (ts.isLiteralTypeNode(type)) {
            if (type.literal.kind === ts.SyntaxKind.NullKeyword) {
                return {kind: "literal", type: "null", value: null};
            }
            if (type.literal.kind === ts.SyntaxKind.TrueKeyword) {
                return {kind: "literal", type: "boolean", value: true};
            }
            if (type.literal.kind === ts.SyntaxKind.FalseKeyword) {
                return {kind: "literal", type: "boolean", value: false};
            }
            return {kind: "literal", type: "string", value: type.literal.getText()};
        }
        if (ts.isArrayTypeNode(type)) {
            return {kind: "array", type: this.readType(type.elementType)};
        }
        if (ts.isUnionTypeNode(type)) {
            return this.processUnionType({kind: "union", types: type.types.map(x => this.readType(x))});
        }
        if (ts.isTypeLiteralNode(type)) {
            const properties: {[name: string]: types.PropertyDeclaration} = {};
            type.members.map(x => {
                if (ts.isPropertySignature(x)) {
                    if (!x.type) {
                        throw new Error(`Missing type in property signature ${x.getSourceFile().fileName} - ${x.getText()}`);
                    }
                    const comment = this.tryReadComment(x);
                    const res: types.PropertyDeclaration = {
                        name: x.name?.getText() || "",
                        optional: !!x.questionToken,
                        description: comment?.description || "",
                        type: this.readType(x.type),
                    };
                    properties[res.name] = res;
                    return;
                }
                if (ts.isIndexSignatureDeclaration(x)) {
                    const comment = this.tryReadComment(x);
                    const res: types.PropertyDeclaration = {
                        name: x.parameters[0].name.getText(),
                        map: x.parameters[0].type ? this.readType(x.parameters[0].type) : undefined,
                        optional: !!x.questionToken,
                        description: comment?.description || "",
                        type: this.readType(x.type),
                    };
                    properties[res.name] = res;
                    return;
                }
                throw new Error(`Unsupported member type ${x.kind} in type literal node`);
            });
            return {kind: "object", name: "", description: "", properties: properties};
        }
        throw new Error(`Unsupported type ${type.kind}`);
    }
    
    private notExpandableTypes = ["ContextPolicy", "ContainerPolicy", "ContainerWithoutItemPolicy"];
    
    private readTheType(theType: ts.Type): types.Type {
        if (theType.flags === ts.TypeFlags.Boolean) {
            return {kind: "primitive", type: "boolean"};
        }
        if (theType.flags === ts.TypeFlags.Number) {
            return {kind: "primitive", type: "number"};
        }
        if (theType.flags === ts.TypeFlags.String) {
            return {kind: "primitive", type: "string"};
        }
        if (theType.isNumberLiteral()) {
            return {kind: "literal", type: "number", value: theType.value};
        }
        if (theType.isStringLiteral()) {
            return {kind: "literal", type: "string", value: theType.value};
        }
        if (theType.isIntersection()) {
            return this.readTheType(theType.types[0]);
        }
        if (theType.isUnion()) {
            const declarartion = theType.aliasSymbol?.declarations?.[0];
            if (declarartion) {
                const propComment = this.tryReadComment(declarartion);
                if (propComment && propComment.doctype) {
                    return {kind: "primitive", type: propComment.doctype as types.PrimitiveType["type"]};
                }
            }
            return this.processUnionType({kind: "union", types: theType.types.map(x => this.readTheType(x))});
        }
        if (theType.flags === ts.TypeFlags.Object) {
            if (this.notExpandableTypes.includes(theType.symbol?.name)) {
                return {kind: "object", name: theType.symbol?.name || "", description: theType.symbol?.name || "", properties: {}};
            }
            const properties: {[name: string]: types.PropertyDeclaration} = {};
            for (const prop of theType.getProperties()) {
                if (!prop.declarations || prop.declarations.length !== 1) {
                    continue;
                }
                const declaration = prop.declarations[0];
                if (!ts.isPropertySignature(declaration) || !declaration.type) {
                    continue;
                }
                const propComment = this.tryReadComment(declaration);
                properties[declaration.name.getText()] = {
                    name: declaration.name.getText(),
                    description: propComment?.description || "",
                    optional: !!declaration.questionToken,
                    type: this.readType(declaration.type),
                };
            }
            return {kind: "object", name: theType.symbol?.name || "", description: "", properties: properties};
        }
        if (theType.flags === ts.TypeFlags.TypeParameter) {
            return {kind: "typeDeclaration"};
        }
        throw new Error(`Unsupported The type ${theType.flags}`);
    }
    
    private processUnionType(union: types.UnionType): types.Type {
        if (union.types.length === 0) {
            throw new Error("Invalid union");
        }
        if (union.types.length === 1) {
            return union.types[0];
        }
        if (union.types.length === 2) {
            const nullIndex = union.types.findIndex(x => x.kind === "literal" && x.type === "null");
            if (nullIndex != -1) {
                const baseType = union.types[nullIndex === 0 ? 1 : 0];
                return {kind: "nullable", type: baseType};
            }
        }
        const first = union.types[0];
        if (first.kind === "literal" && first.type !== "null" && union.types.every(x => x.kind === "literal" && x.type === first.type)) {
            return {kind: "enum", type: first.type, values: union.types.map(x => x.kind === "literal" ? x.value : null)};
        }
        return union;
    }
    
    private parseComment(comment: string) {
        if (!comment.startsWith("/**") || !comment.endsWith("*/")) {
            return null;
        }
        const lines = comment.slice(3, comment.length - 2).split("\n").map(x => x.trim()).map(x => x.startsWith("*") ? x.slice(1).trim() : x).filter(x => x);
        const description = lines.filter(x => !x.startsWith("@")).join("\n");
        const params = lines.filter(x => x.startsWith("@param ")).map(x => x.slice(7)).map(x => {
            const spaceIndex = x.indexOf(" ");
            return {name: x.slice(0, spaceIndex), desc: x.slice(spaceIndex + 1)};
        });
        const returns = lines.find(x => x.startsWith("@returns "))?.slice(9);
        const doctype = lines.find(x => x.startsWith("@doctype "))?.slice(9);
        return {description, params, returns, doctype};
    }
    
    private isApiInterfaceName(interfaceName: string) {
        return interfaceName.startsWith("I") && interfaceName.endsWith("Api");
    }
    
    private getErrorsWithDescription() {
        return [
            {name: "ACCESS_DENIED", description: "You don't have access to requested resource."},
            {name: "UNAUTHORIZED", description: "Your credentials are invalid."},
            {name: "INSUFFICIENT_SCOPE", description: "You don't have enough rights to requested resource."},
            {name: "METHOD_NOT_FOUND", description: "Given method does not exis."},
            {name: "INVALID_PARAMS", description: "Given parameters are invalid. The data property of error object contains detailed description what is wrong."},
            {name: "INTERNAL_ERROR", description: "We had a problem with our server."},
            {name: "PARSE_ERROR", description: "You sent us invalid json."},
            {name: "INVALID_REQUEST", description: "You sent us invalid json rpc request."},
            {name: "ONLY_POST_METHOD_ALLOWED", description: "You do not use HTTP POST method."},
        ].map(x => ({...x, ...ERROR_CODES[x.name]}));
    }
    
    private getHttpErrorCodes(): types.HttpErrorCode[] {
        return [
            {
                errorCode: "404",
                message: "Not Found",
                description: "Given url is invalid.",
            },
            {
                errorCode: "429",
                message: "Too Many Requests",
                description: "You're making too many request.",
            },
            {
                errorCode: "500",
                message: "Internal Server Error",
                description: "We had a problem with our server. Try again later.",
            },
            {
                errorCode: "503",
                message: "Service Unavailable",
                description: "We're temporarily offline for maintenance. Please try again later.",
            },
        ];
    }
}
