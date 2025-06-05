var fs = require("fs");
var nodePath = require("path");
var exec = require('child_process').exec;

//===================
//    FUNCTIONS
//===================

function readJson(path) {
    return JSON.parse(fs.readFileSync(path, "utf8"));
}

function writeJson(path, obj) {
    fs.writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function mkdirs(dirPath) {
    var splitted = dirPath.split("/");
    var path = "";
    for (var i = 0; i < splitted.length; i++) {
        path = nodePath.join(path, splitted[i] || "/");
        if (!fs.existsSync(path)) {
            fs.mkdirSync(path);
        }
    }
}

function copyFile(src, out) {
    if (!fs.existsSync(src)) {
        return;
    }
    var outDir = nodePath.dirname(out);
    if (!fs.existsSync(outDir)) {
        mkdirs(outDir);
    }
    fs.writeFileSync(out, fs.readFileSync(src));
}

function passFilter(filter, value) {
    return filter.endsWith("*") ? value.indexOf(filter.substring(0, filter.length - 1)) == 0 : filter == value;
}

function copyr(src, out, ext, ignore) {
    if (!fs.existsSync(src)) {
        return;
    }
    if (fs.statSync(src).isFile()) {
        if (!ext || src.endsWith(ext)) {
            copyFile(src, out);
        }
    }
    else {
        var files = fs.readdirSync(src);
        files.forEach(function(f) {
            var srcf = nodePath.join(src, f);
            var outf = nodePath.join(out, f);
            if (ignore && ignore.find(x => passFilter(x, srcf))) {
                return;
            }
            copyr(srcf, outf, ext, ignore);
        });
    }
}

function rmr(path) {
    if (!fs.existsSync(path)) {
        return;
    }
    var stats = fs.statSync(path);
    if (stats.isFile()) {
        fs.unlinkSync(path);
    }
    else {
        var files = fs.readdirSync(path);
        files.forEach(function(f) {
            rmr(path + "/" + f);
        });
        fs.rmdirSync(path);
    }
}

function pad2(num) {
    return num < 10 ? "0" + num : num;
}

function pad3(num) {
    return num < 10 ? "00" + num : (num < 100 ? "0" + num : num);
}

function getDateStr() {
    let date = new Date();
    return "" + date.getFullYear() +
        pad2(date.getMonth() + 1) +
        pad2(date.getDate()) +
        pad2(date.getHours()) +
        pad2(date.getMinutes()) +
        pad2(date.getSeconds()) +
        pad3(date.getMilliseconds());
}

function bash(command, options) {
    return new Promise(function(resolve, reject) {
        var exitCode = 0;
        var proc = exec(command, options || {}, function(err, stdout, stderr) {
            var result = {
                exitCode: exitCode,
                err: err,
                stdout: stdout,
                stderr: stderr
            };
            resolve(result);
        });
        proc.on('exit', function (code) {
            exitCode = code;
        });
    });
}

function getTypesPackageName(pkgName) {
    return "@types/" + (pkgName.startsWith("@") ? pkgName.substring(1).replace("/", "__") : pkgName);
}

function buildStep(state, config, typesDir) {
    var types = config.config;
    rmr(typesDir);
    copyr("./", "./" + typesDir, ".d.ts", ["node_modules", "node_modules_dev", "node_modules_links", "types", "types-*"].concat(types.ignore || []));
    if (fs.existsSync("./.npmrc")) {
        copyFile("./.npmrc", "./" + typesDir + "/.npmrc");
    }
    mkdirs(typesDir);
    
    var pkg = state.pkg;
    var mainTypes = state.typesGen;
    var configName = config.name;
    types.name = types.name || getTypesPackageName(pkg.name);
    types.version = types.version || mainTypes.version || pkg.version;
    types.typings = types.typings || pkg.typings;
    types.excludeDeps = types.excludeDeps || [];
    types.removeFiles = types.removeFiles || [];
    types.copyFiles = types.copyFiles || [];
    var pkgo = {
        name: types.name,
        version: types.version,
        dependencies: {}
    };
    if (state.pkg.types) {
        pkgo.typings = state.pkg.types;
    }
    if (state.pkg.typings) {
        pkgo.typings = state.pkg.typings;
    }
    if (types.typings) {
        pkgo.typings = types.typings;
    }
    if (types.main) {
        pkgo.main = types.main;
    }
    if (types.browser) {
        pkgo.browser = types.browser;
    }
    if (types.clearDependencies) {
        pkg.dependencies = {};
    }
    for (var name in pkg.dependencies) {
        var isTypesDep = name.startsWith("@types/");
        var typeName = isTypesDep ? name : getTypesPackageName(name);
        var libName = isTypesDep ? name.substring(7) : name;
        if (types.excludeDeps.indexOf(typeName) != -1 || types.excludeDeps.indexOf(libName) != -1) {
            console.log("Excluding " + name);
            continue;
        }
        if (isTypesDep) {
            pkgo.dependencies[typeName] = types.explicitDepVersion ? readJson("node_modules/" + typeName + "/package.json").version : pkg.dependencies[typeName];
        }
        else {
            if ((typeName in pkg.dependencies)) {
                //Skipped, already added by types dependency
            }
            else if ((typeName in pkg.devDependencies)) {
                pkgo.dependencies[typeName] = types.explicitDepVersion ? readJson("node_modules/" + typeName + "/package.json").version : pkg.devDependencies[typeName];
            }
            else {
                var packageJsonPath = "node_modules/" + name + "/package.json";

                if (fs.existsSync(packageJsonPath)) {
                    var depPkg = readJson(packageJsonPath);
                    if (depPkg.typings || depPkg.types || fs.existsSync("node_modules/" + name + "/index.d.ts")) {
                        console.log("Typing should be created from package " + name);
                        pkgo.dependencies[getTypesPackageName(name)] = types.explicitDepVersion ? depPkg.version : pkg.dependencies[name];
                    }
                    else {
                        console.log("WARNING Excluding " + name + " (package without typings)");
                    }
                }
                else {
                    pkgo.dependencies[getTypesPackageName(name)] = pkg.dependencies[name];
                    console.log("WARNING Dependency " + name + " not installed");
                }
            }
        }
    }
    for (var typeName in (types.includeDeps || {})) {
        var version = types.includeDeps[typeName];
        if (version) {
            pkgo.dependencies[typeName] = version == "$version" ? pkgo.version : version;
        }
        else if (types.explicitDepVersion) {
            pkgo.dependencies[typeName] = readJson("node_modules/" + typeName + "/package.json").version
        }
        else if ((typeName in pkg.dependencies)) {
            pkgo.dependencies[typeName] = pkg.dependencies[typeName];
        }
        else if ((typeName in pkg.devDependencies)) {
            pkgo.dependencies[typeName] = pkg.devDependencies[typeName];
        }
        else {
            console.log("WARNING Dependency " + typeName + " cannot be included");
        }
    }
    if (Object.keys(pkgo.dependencies).length == 0) {
        delete pkgo.dependencies;
    }
    writeJson(typesDir + "/package.json", pkgo);
    
    types.copyFiles.forEach(function(x) {
        var inPath,  outPath;
        if (typeof(x) == "string") {
            inPath = "./" + x;
            outPath = "./" + typesDir + "/" + x;
        }
        else {
            inPath = "./" + x[0];
            outPath = "./" + typesDir + "/" + x[1];
        }
        console.log("Coping from " + inPath + " to " + outPath);
        copyr(inPath, outPath);
    });
    
    types.removeFiles.forEach(function(x) {
        var path = "./" + typesDir + "/" + x;
        console.log("Removing " + path)
        rmr(path);
    });
}

function processConfig(state, config) {
    var typesDir = config.name ? "types-" + config.name : "types";
    console.log("types dir:", typesDir);
    
    return Promise.resolve().then(() => {
        if (state.flags.build == "y") {
            console.log("Building " + config.name);
            buildStep(state, config, typesDir);
        }
    })
    .then(() => {
        if (state.flags.publish == "y") {
            console.log("Publishing");
            return bash("npm publish --registry=https://npmregistry.privmx.com", {cwd: typesDir}).then(res => {
                console.log(res.stdout);
                console.log(res.stderr);
            });
        }
        if (state.flags.publish == "f") {
            console.log("Publishing with force");
            return bash("npm publish --force --registry=https://npmregistry.privmx.com", {cwd: typesDir}).then(res => {
                console.log(res.stdout);
                console.log(res.stderr);
            });
        }
    })
    .then(() => {
        if (state.flags.clean == "y") {
            console.log("Removing");
            rmr(typesDir);
        }
    });
}

function promiseForEach(array, func) {
    var i = 0;
    var pf = function() {
        if (i >= array.length) {
            return Promise.resolve();
        }
        var element = array[i];
        return Promise.resolve().then(() => {
            return func(element);
        })
        .then(() => {
            i++;
            return pf();
        });
    };
    return pf();
}

//===================
//      MAIN
//===================

if (process.argv.length > 7 || process.argv[2] == "help" || process.argv[2] == "--help") {
    console.log("Usage: types.sh build publish clean [config-name] [version-gen]");
    console.log("  build:       y/n determine whether types dir should be created");
    console.log("  publish:     f/y/n determine whether publish should be performed, if you use f option then forced publish will be used");
    console.log("  clean:       y/n determine whether types dir should be removed");
    console.log("  config-name: (default all) name of gen config, use 'all' to build all configs");
    console.log("  version-gen: (default yes) use 'no' to prevent new version gen");
    console.log("Examples:");
    console.log("  Build & Publish & Clean");
    console.log("    types.sh");
    console.log("  Build & Publish & Clean");
    console.log("    types.sh y y y");
    console.log("  Only build");
    console.log("    types.sh y n n");
    console.log("  Publish & Clean");
    console.log("    types.sh n y y");
    console.log("  Build & Publish & Clean 'web' config");
    console.log("    types.sh y y y web");
    console.log("  Build & Publish & Clean 'web' config without version gen");
    console.log("    types.sh y y y web no");
    return;
}

var build = process.argv[2] || "y";
var publish = process.argv[3] || "y";
var clean = process.argv[4] || "y"
var configName = process.argv[5] || "";
var genVer = process.argv[6] || "";

var state = {
    flags: {
        build: build,
        publish: publish,
        clean: clean,
        genVer: genVer
    }
};
state.pkg = readJson("package.json");
state.typesGen = state.pkg.typesGen || {};

if (state.typesGen.versionGen && state.flags.genVer != "no") {
    state.typesGen.version = state.pkg.version + "-" + getDateStr();
    writeJson("package.json", state.pkg)
}

var configs = [];
if (configName && configName != "all") {
    configs = [{name: configName, config: state.typesGen[configName] || {}}];
}
else {
    if (state.typesGen.configs) {
        configs = state.typesGen.configs.map(x => {
            return {name: x, config: state.typesGen[x] || {}};
        });
    }
    else {
        configs = [{name: "", config: state.typesGen}];
    }
}

promiseForEach(configs, config => processConfig(state, config));
