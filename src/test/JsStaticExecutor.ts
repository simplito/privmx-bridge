/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/*  eslint-disable no-console */
/*  eslint-disable max-classes-per-file */
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";

const LOG_LEVEL = 0;
const methodToFind: RegExp|null = null; // /^DescriptorApi\.descriptorUpdate$/;

function debugLog(...args: unknown[]) {
    if (LOG_LEVEL >= 2) {
        console.log(...args);
    }
}
function warnLog(...args: unknown[]) {
    if (LOG_LEVEL >= 1) {
        console.log("\x1b[46m", ...args, "\x1b[0m");
    }
}
function errorLog(...args: unknown[]) {
    if (LOG_LEVEL >= 0) {
        console.log("\x1b[41m", ...args, "\x1b[0m");
    }
}

export class TsProject {
    
    readonly baseDir: string;
    readonly program: ts.Program;
    readonly typeChecker: ts.TypeChecker;
    
    constructor() {
        this.baseDir = path.resolve(__dirname, "../../");
        const tsConfig = JSON.parse(fs.readFileSync(path.resolve(this.baseDir, "tsconfig.json"), "utf8")) as {compilerOptions: ts.CompilerOptions};
        const initFileName = path.resolve(this.baseDir, "src/init/init.ts");
        
        this.program = ts.createProgram([initFileName], tsConfig.compilerOptions);
        this.typeChecker = this.program.getTypeChecker();
    }
}

export class ApiMethodFinder {
    
    static find(project: TsProject, onApiMethod: (method: ts.MethodDeclaration) => void) {
        const apiDir = path.resolve(project.baseDir, "src/api/apis");
        const apiFiles = project.program.getSourceFiles().filter(sourceFile => sourceFile.fileName.startsWith(apiDir) && !sourceFile.fileName.endsWith("BaseApi.ts"));
        
        for (const apiFile of apiFiles) {
            ApiMethodFinder.processFile(apiFile, onApiMethod);
        }
    }
    
    private static processFile(apiFile: ts.SourceFile, onApiMethod: (method: ts.MethodDeclaration) => void) {
        debugLog(`Processing ${apiFile.fileName}`);
        for (const statement of apiFile.statements) {
            if (ts.isClassDeclaration(statement)) {
                debugLog("Class found", statement.name?.escapedText);
                const methods = ApiMethodFinder.findApiMethods(statement);
                for (const method of methods) {
                    if (!methodToFind || methodToFind.test(Helper.getMethodName(method))) {
                        onApiMethod(method);
                    }
                }
            }
        }
    }
    
    private static findApiMethods(classDec: ts.ClassDeclaration) {
        return classDec.members.filter((member): member is ts.MethodDeclaration => {
            if (!ts.isMethodDeclaration(member)) {
                return false;
            }
            const decorators = ts.getDecorators(member);
            if (!decorators) {
                return false;
            }
            return decorators.some(x => ts.isIdentifier(x.expression) && (x.expression.escapedText as string) === "ApiMethod");
        });
    }
}

export class Helper {
    
    static getIdent(length: number) {
        let str = "";
        for (let i = 0; i < length; i++) {
            str += "  ";
        }
        return str;
    }
    
    static getMethodName(method: ts.MethodDeclaration) {
        const methodName = Helper.getName(method.name);
        if (ts.isClassDeclaration(method.parent)) {
            const className = method.parent.name?.escapedText || "";
            return `${className}.${methodName}`;
        }
        return `<unknown>.${methodName}`;
    }
    
    static getMethodNameFromInterface(method: ts.MethodSignature|ts.PropertySignature) {
        const methodName = Helper.getName(method.name);
        if (ts.isInterfaceDeclaration(method.parent)) {
            const interfaceName = method.parent.name.escapedText as string;
            return `${interfaceName}.${methodName}`;
        }
        return `<unknown>.${methodName}`;
    }
    
    static getName(x: ts.Node) {
        return ts.isIdentifier(x) ? x.escapedText as string : "<unknown>";
    }
    
    static identifiersMatch(a: ts.BindingName, b: ts.BindingName) {
        if (!ts.isIdentifier(a) || !ts.isIdentifier(b)) {
            return false;
        }
        return a.escapedText === b.escapedText;
    }
}

export interface ArrowFunction {
    executor: JsStaticExecutor;
    value: ts.ArrowFunction;
}

export class CallStack {
    
    constructor(
        public stack: (ts.MethodDeclaration|Record<string, unknown>)[],
        public variables: {varName: ts.BindingName, value: ArrowFunction}[],
        public transaction: boolean,
    ) {
    }
    
    static create() {
        return new CallStack([], [], false);
    }
    
    copy() {
        return new CallStack([...this.stack], [...this.variables], this.transaction);
    }
    
    addVariable(varName: ts.BindingName, value: ArrowFunction) {
        this.variables.push({varName, value});
    }
    
    resolveIdentifier(identifier: ts.BindingName): ArrowFunction|void {
        for (let i = this.variables.length - 1; i >= 0; i--) {
            const v = this.variables[i];
            if (Helper.identifiersMatch(v.varName, identifier)) {
                return v.value;
            }
        }
    }
}

let withTransactionCounter = 0;
let nestedTransactionsCounter = 0;

export class JsStaticExecutor {
    
    constructor(public project: TsProject, public callStack: CallStack) {
    }
    
    static analyzeMethod(project: TsProject, method: ts.MethodDeclaration) {
        withTransactionCounter = 0;
        nestedTransactionsCounter = 0;
        debugLog(`${Helper.getIdent(0)}${Helper.getMethodName(method)} {`);
        const executor = new JsStaticExecutor(project, CallStack.create());
        executor.executeStatement(method.body);
        debugLog(`${Helper.getIdent(0)}} (transactions=${withTransactionCounter}, nestedTransactionsCounter=${nestedTransactionsCounter})`);
        if (withTransactionCounter > 1) {
        // if (nestedTransactionsCounter >= 1) {
            errorLog("@@========================== TRANSACTION VIOLATION " + Helper.getMethodName(method) + " transactions=" + withTransactionCounter + " nested_transactions=" + nestedTransactionsCounter);
        }
    }
    
    newBlock() {
        return new JsStaticExecutor(this.project, this.callStack.copy());
    }
    
    newCall(variables: {varName: ts.BindingName, value: ArrowFunction}[], dec?: ts.MethodDeclaration|Record<string, unknown>) {
        const callStack = this.callStack.copy();
        for (const v of variables) {
            callStack.addVariable(v.varName, v.value);
        }
        if (dec) {
            callStack.stack.push(dec);
        }
        return new JsStaticExecutor(this.project, callStack);
    }
    
    executeStatement(statement?: ts.Statement) {
        if (!statement) {
            return;
        }
        else if (ts.isExpressionStatement(statement)) {
            this.executeExpression(statement.expression);
        }
        else if (ts.isReturnStatement(statement)) {
            this.executeExpression(statement.expression);
        }
        else if (ts.isVariableStatement(statement)) {
            for (const dec of statement.declarationList.declarations) {
                if (dec.initializer) {
                    if (ts.isArrowFunction(dec.initializer)) {
                        warnLog("ARROW FUNCTION in VariableStatement");
                        this.callStack.addVariable(dec.name, {executor: this, value: dec.initializer});
                    }
                    else {
                        this.executeExpression(dec.initializer);
                    }
                }
            }
        }
        else if (ts.isBlock(statement)) {
            const block = this.newBlock();
            for (const st of statement.statements) {
                block.executeStatement(st);
            }
        }
        else if (ts.isIfStatement(statement)) {
            this.executeExpression(statement.expression);
            this.newBlock().executeStatement(statement.thenStatement);
            if (statement.elseStatement) {
                this.newBlock().executeStatement(statement.elseStatement);
            }
        }
        else if (ts.isThrowStatement(statement)) {
            this.executeExpression(statement.expression);
        }
        else if (ts.isForStatement(statement)) {
            const block = this.newBlock();
            if (statement.initializer) {
                if (ts.isVariableDeclarationList(statement.initializer)) {
                    for (const dec of statement.initializer.declarations) {
                        block.executeExpression(dec.initializer);
                    }
                }
                else {
                    block.executeExpression(statement.initializer);
                }
            }
            if (statement.condition) {
                block.executeExpression(statement.condition);
            }
            block.executeExpression(statement.incrementor);
            block.executeStatement(statement.statement);
        }
        else if (ts.isForInStatement(statement)) {
            this.executeExpression(statement.expression);
            this.newBlock().executeStatement(statement.statement);
        }
        else if (ts.isForOfStatement(statement)) {
            this.executeExpression(statement.expression);
            this.newBlock().executeStatement(statement.statement);
        }
        else if (ts.isWhileStatement(statement)) {
            this.executeExpression(statement.expression);
            this.newBlock().executeStatement(statement.statement);
        }
        else if (ts.isDoStatement(statement)) {
            this.executeExpression(statement.expression);
            this.newBlock().executeStatement(statement.statement);
        }
        else if (ts.isTryStatement(statement)) {
            this.newBlock().executeStatement(statement.tryBlock);
            if (statement.catchClause) {
                this.newBlock().executeStatement(statement.catchClause.block);
            }
            if (statement.finallyBlock) {
                this.newBlock().executeStatement(statement.finallyBlock);
            }
        }
        else if (ts.isSwitchStatement(statement)) {
            this.executeExpression(statement.expression);
            for (const c of statement.caseBlock.clauses) {
                if (ts.isCaseClause(c)) {
                    this.executeExpression(c.expression);
                }
                for (const st of c.statements) {
                    this.executeStatement(st);
                }
            }
        }
        else if (
            ts.isContinueStatement(statement) ||
            ts.isBreakStatement(statement)
        ) {
            // do nothing
        }
        else {
            warnLog("UNKNOWN STATEMENT", statement.kind);
        }
    }
    
    executeArrow(arrow: ArrowFunction, args: (void|ArrowFunction)[]) {
        debugLog(`${Helper.getIdent(this.callStack.stack.length + 1)}=> {`);
        const variables: {varName: ts.BindingName, value: ArrowFunction}[] = [];
        arrow.value.parameters.forEach((x, i) => {
            const a = args[i];
            if (a) {
                variables.push({varName: x.name, value: a});
            }
        });
        const newCall = this.newCall([], {});
        newCall.callStack.variables = [...arrow.executor.callStack.variables, ...variables];
        if (ts.isBlock(arrow.value.body)) {
            newCall.executeStatement(arrow.value.body);
        }
        else {
            newCall.executeExpression(arrow.value.body);
        }
        debugLog(`${Helper.getIdent(this.callStack.stack.length + 1)}}`);
    }
    
    executeExpression(expression?: ts.Expression): ArrowFunction|void {
        if (!expression) {
            return;
        }
        else if (ts.isCallExpression(expression)) {
            const args = expression.arguments.map(x => this.executeExpression(x));
            const exp = this.executeExpression(expression.expression);
            if (exp) {
                this.executeArrow(exp, args);
            }
            else {
                // We have something else
                const symbol = this.project.typeChecker.getSymbolAtLocation(expression.expression);
                if (!symbol || !symbol.declarations || symbol.declarations.length === 0) {
                    warnLog("WARNING no symbol on call expression");
                    return;
                }
                const dec = symbol.declarations[0];
                if (ts.isMethodDeclaration(dec)) {
                    const methodName = Helper.getMethodName(dec);
                    if (
                        methodName.startsWith("SessionService.") ||
                        methodName.startsWith("Logger.") ||
                        methodName.startsWith("MongoObjectRepository.") ||
                        methodName.startsWith("DeviceInfo.") ||
                        methodName.startsWith("DateUtils.") ||
                        methodName.startsWith("Callbacks.") ||
                        methodName.startsWith("Crypto.") ||
                        methodName.startsWith("JobService.") ||
                        methodName.startsWith("WebSocketManager.") ||
                        methodName.startsWith("ScriptExecutor.") ||
                        methodName.startsWith("PrivmxPocketNotificationService.send") ||
                        methodName.startsWith("ChangeService.onChange") ||
                        methodName.startsWith("PrivMXServiceDiscoverySession.discover") ||
                        methodName.startsWith("SinkMessageRepository.resolveQuery") ||
                        methodName.startsWith("PrivmxClientEx.callCore")
                    ) {
                        debugLog(`${Helper.getIdent(this.callStack.stack.length + 1)}${methodName} {`);
                        const newCall = this.newCall([], {});
                        args.forEach(x => x && newCall.executeArrow(x, []));
                        debugLog(`${Helper.getIdent(this.callStack.stack.length + 1)}}`);
                        return;
                    }
                    const circular = this.callStack.stack.filter(x => x === dec);
                    if (circular.length > 10) {
                        warnLog(`Circular ${methodName}`);
                        // args.forEach(x => x && this.executeArrow(x, []));
                    }
                    else {
                        const variables: {varName: ts.BindingName, value: ArrowFunction}[] = [];
                        dec.parameters.forEach((x, i) => {
                            const a = args[i];
                            if (a) {
                                variables.push({varName: x.name, value: a});
                            }
                        });
                        debugLog(`${Helper.getIdent(this.callStack.stack.length + 1)}${methodName} {`);
                        this.newCall(variables, dec).executeStatement(dec.body);
                        debugLog(`${Helper.getIdent(this.callStack.stack.length + 1)}}`);
                    }
                }
                else if (ts.isParameter(dec) || ts.isVariableDeclaration(dec)) {
                    const arrow = this.callStack.resolveIdentifier(dec.name);
                    if (arrow) {
                        this.executeArrow(arrow, args);
                    }
                    else {
                        debugLog(`${Helper.getIdent(this.callStack.stack.length + 1)}(variable)${Helper.getName(dec.name)} {`);
                        const newCall = this.newCall([], {});
                        args.forEach(x => x && newCall.executeArrow(x, []));
                        debugLog(`${Helper.getIdent(this.callStack.stack.length + 1)}}`);
                    }
                }
                else if (ts.isMethodSignature(dec) || ts.isPropertySignature(dec)) {
                    const methodName = Helper.getMethodNameFromInterface(dec);
                    const isTransaction = methodName === "ClientSession.withTransaction";
                    let createTransaction = false;
                    if (isTransaction) {
                        withTransactionCounter++;
                        createTransaction = isTransaction && !this.callStack.transaction;
                        if (createTransaction) {
                            this.callStack.transaction = true;
                            debugLog("===TRANSACTION");
                        }
                        else {
                            debugLog("===NESTED TRANSACTION");
                            nestedTransactionsCounter++;
                        }
                    }
                    debugLog(`${Helper.getIdent(this.callStack.stack.length + 1)}${methodName} {`);
                    const newCall = this.newCall([], {});
                    args.forEach(x => x && newCall.executeArrow(x, []));
                    debugLog(`${Helper.getIdent(this.callStack.stack.length + 1)}}`);
                    if (isTransaction) {
                        if (createTransaction) {
                            this.callStack.transaction = false;
                            debugLog("===END OF TRANSACTION");
                        }
                        else {
                            debugLog("===END OF NESTED TRANSACTION");
                        }
                    }
                }
                else {
                    const decName = "name" in dec ? Helper.getName(dec.name as ts.Node) : "<unknown>";
                    debugLog(`${Helper.getIdent(this.callStack.stack.length + 1)}(${dec.kind})${decName} {`);
                    const newCall = this.newCall([], {});
                    args.forEach(x => x && newCall.executeArrow(x, []));
                    debugLog(`${Helper.getIdent(this.callStack.stack.length + 1)}}`);
                }
            }
        }
        else if (ts.isAwaitExpression(expression)) {
            return this.executeExpression(expression.expression);
        }
        else if (ts.isConditionalExpression(expression)) {
            this.executeExpression(expression.condition);
            this.executeExpression(expression.whenTrue);
            this.executeExpression(expression.whenFalse);
        }
        else if (ts.isBinaryExpression(expression)) {
            this.executeExpression(expression.left);
            this.executeExpression(expression.right);
        }
        else if (ts.isPrefixUnaryExpression(expression)) {
            this.executeExpression(expression.operand);
        }
        else if (ts.isPostfixUnaryExpression(expression)) {
            this.executeExpression(expression.operand);
        }
        else if (ts.isArrowFunction(expression)) {
            return {executor: this, value: expression};
        }
        else if (ts.isArrayLiteralExpression(expression)) {
            for (const x of expression.elements) {
                this.executeExpression(x);
            }
        }
        else if (ts.isNewExpression(expression)) {
            this.executeExpression(expression.expression);
            for (const x of expression.arguments || []) {
                if (ts.isArrowFunction(x)) {
                    if (ts.isIdentifier(expression.expression) && (expression.expression.escapedText as string) === "Promise") {
                        this.executeArrow({executor: this, value: x}, []);
                    }
                    else {
                        warnLog("ARROW FUNCTION in NewExpression", expression.getText());
                    }
                }
                else {
                    this.executeExpression(x);
                }
            }
        }
        else if (ts.isObjectLiteralExpression(expression)) {
            for (const x of expression.properties) {
                if (ts.isPropertyAssignment(x)) {
                    if (ts.isArrowFunction(x.initializer)) {
                        warnLog("ARROW FUNCTION in ObjectLiteralExpression");
                    }
                    else {
                        this.executeExpression(x.initializer);
                    }
                }
                else if (ts.isShorthandPropertyAssignment(x)) {
                    // nothing
                }
                else if (ts.isSpreadAssignment(x)) {
                    this.executeExpression(x.expression);
                }
                else if (ts.isMethodDeclaration(x)) {
                    // nothing
                }
            }
        }
        else if (ts.isTypeAssertionExpression(expression) || ts.isAsExpression(expression)) {
            return this.executeExpression(expression.expression);
        }
        else if (ts.isParenthesizedExpression(expression)) {
            return this.executeExpression(expression.expression);
        }
        else if (ts.isDeleteExpression(expression)) {
            this.executeExpression(expression.expression);
        }
        else if (ts.isVoidExpression(expression)) {
            this.executeExpression(expression.expression);
        }
        else if (ts.isTypeOfExpression(expression)) {
            this.executeExpression(expression.expression);
        }
        else if (ts.isSpreadElement(expression)) {
            this.executeExpression(expression.expression);
        }
        else if (ts.isPropertyAccessExpression(expression)) {
            this.executeExpression(expression.expression);
        }
        else if (ts.isElementAccessExpression(expression)) {
            this.executeExpression(expression.expression);
        }
        else if (ts.isTemplateExpression(expression)) {
            for (const x of expression.templateSpans) {
                this.executeExpression(x.expression);
            }
        }
        else if (ts.isIdentifier(expression)) {
            return this.callStack.resolveIdentifier(expression);
        }
        else if (
            expression.kind === ts.SyntaxKind.NullKeyword ||
            expression.kind === ts.SyntaxKind.UndefinedKeyword ||
            expression.kind === ts.SyntaxKind.TrueKeyword ||
            expression.kind === ts.SyntaxKind.FalseKeyword ||
            expression.kind === ts.SyntaxKind.ThisKeyword ||
            ts.isLiteralExpression(expression)
        ) {
            return;
        }
        else {
            warnLog("UNKNOWN EXPRESSION", expression.kind);
        }
    }
}

const project = new TsProject();
ApiMethodFinder.find(project, method => JsStaticExecutor.analyzeMethod(project, method));
