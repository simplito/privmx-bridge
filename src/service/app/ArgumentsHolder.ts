import * as path from "path";

export interface ArgumentsValues {
    configPath: string;
    acTokenDirPath: string;
}

export class ArgumentsHolder {
    
    static readonly ACDIR_PREFIX = "--acdir=";
    
    constructor(
        public values: ArgumentsValues
    ) {
    }
    
    static create(argv: string[]) {
        const configPath = argv.length < 3 || !argv[2] ? path.resolve(__dirname, "../../../conf/config.json") : argv[2];
        const acTokenArgv = argv.find(x => x.startsWith(ArgumentsHolder.ACDIR_PREFIX));
        const acTokenDirPath = path.resolve(acTokenArgv ? acTokenArgv.substr(ArgumentsHolder.ACDIR_PREFIX.length) : ".");
        return new ArgumentsHolder({
            configPath: configPath,
            acTokenDirPath: acTokenDirPath
        });
    }
    
    static createFromProcessArgv() {
        return this.create(process.argv);
    }
}