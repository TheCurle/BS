/****************************************
 * Gemwire BS                           *
 *  Chroma Subsystem #12                *
 *                                      *
 * Javascript PoC implementation        *
 ****************************************
 * The Build System
 * 
 * See README.md for details on the operation and usage of the system.
 * 
 * Short version:
 *  - Language plugins go in plugins/<extension>.js
 *    |- Plugins provide functions called extension<ext> and step<name>.
 *       |- eg. c.js contains extensionC and extensionH, and stepCompile, stepAssemble, stepLink.
 *  - Buildscript goes in /build.json
 *    |- buildscript contains metadata about the project, and instructions on how to build it.
 *    |- the "source" block contains the source sets to compile, using named aliases.
 *    |- the "build" block contains the names of steps, parameters and order to execute them in.
 *    |  |- these steps invoke the functions in the plugin files, based on the extension of the file being compiled.
 *    |- custom plugins are allowed to provide bespoke functionality
 * 
 ****************************************/

const buildscript = require("../build.json");
const fs = require("fs");
const path = require("path");

function main() {
    let extensionsUsed = [];
    let modules = {};
    let sourceTree = [];
    let cwd = process.cwd().replace(/\\/g, "/");

    // iterate source list
    for(let key in buildscript.source) {
        let expandedSrc = [];
        // iterate the files inside
        for(let item of buildscript.source[key]) {
            // replace $root with the absolute path, normalise slashes
            let tempPath = item.replace("$root", cwd).replace(/\\/g, "/");
            console.log("Parsing file tree", tempPath, "from", item);

            // attempt to expand wildcards
            let expansionRegex = /\*\.((.*)*)/;
            let expansionMatch = tempPath.match(expansionRegex);
            if(expansionMatch != null && expansionMatch.index > item.lastIndexOf("/")) {
                // expansionMatch.groups contains "*.<ext>", "<ext>".
                // extract it, get the list, save it back

                // first save the path (the part before the *.)
                let pathDir = tempPath.substr(0, expansionMatch.index);
                console.log("Finding files in", pathDir, "that end in", expansionMatch[1]);
                if(extensionsUsed.indexOf(expansionMatch[1]) < 0)
                    extensionsUsed.push(expansionMatch[1]);

                // list all files, filter for the extension
                let fileList = fs.readdirSync(pathDir).filter(fn => fn.endsWith(expansionMatch[1]));

                // add the path to each of the files
                for(let file in fileList) {
                    let fullPath = pathDir + fileList[file];
                    fileList[file] = fullPath;
                }

                // add it to the list
                expandedSrc = expandedSrc.concat(fileList);
                
            } else {
                // it's an absolute file or folder. check it exists
                if(!fs.existsSync(tempPath)) {
                    console.log("File or folder", tempPath, "in source set", key, "does not exist!");
                    return;
                }
                console.log("\tAppending absolute file", tempPath, "to source set", key);
                
                let dotPosition = tempPath.lastIndexOf(".") + 1;
                if(!extensionsUsed.includes(tempPath.substr(dotPosition)) && dotPosition > 0)
                    extensionsUsed.push(tempPath.substr(dotPosition));

                expandedSrc = expandedSrc.concat(tempPath);
            }
        }

        buildscript.source[key] = expandedSrc;
    }

    // seek for plugins to load
    for(let ext of extensionsUsed) {

        console.log("Searching for a plugin for the extension", ext);
        let pluginPath = cwd + "/plugins/";
        let extPluginName = pluginPath + ext + ".js";
        if(!fs.existsSync(extPluginName)) {
            console.log("Expected plugin", extPluginName, "does not exist! Searching for another file that provides this extension..");
            let errorFlag = true;
            for(var file of fs.readdirSync(pluginPath)) {
                let module = require(pluginPath + file);
                let functionName = "extension" + ext.toUpperCase();
                if(module[functionName] instanceof Function) {
                    errorFlag = false;
                    extPluginName = pluginPath + file;
                    console.log("Found valid file", file, "that provides the extension", ext);
                    ext = file.substr(0, file.lastIndexOf("."));
                }
            }
            if(errorFlag) {
                console.log("No plugin provides the extension", ext);
                return;
            }
        }
        
        if(modules[ext] != null) continue;

        modules[ext] = require(extPluginName);
        let preprocessorFunc = "extension" + ext.toUpperCase();
        // preprocess the buildscript

        
        modules[ext][preprocessorFunc](buildscript);
        
        console.log("Imported plugin", extPluginName, "for extension", ext, "and ran preprocessor function", preprocessorFunc);

        if(buildscript.target != null) {
            modules[ext].setCompiler(buildscript.target);
        }
    }
    
    console.log(modules);

    // iterate build instructions
    for(let key in buildscript.build) {
        let expandedBuild = [];
        
        console.log("Parsing build step", key);
        // iterate the steps inside
        for(let item of buildscript.build[key]) {
            console.log("Reading step argument", item);
            // find /\$([-\w]+)/g
            let treeRegex = /\$([-\w]+)/g;
            let treeMatches = item.match(treeRegex);
            // if we have something to parse, read it in
            if(treeMatches != null) {
                console.log(treeMatches);
                let name = treeMatches[0].substr(1);
                console.log("Found mnemonic", name, "in step", item);
                // check if the name is a source set
                if(name in buildscript.source) {
                    // if so, sub it in
                    let value = buildscript.source[name];
                    let itemTemp = item.replace(treeMatches[0], value);
                    console.log("Substituting mnemonic", name, "with value", value);
                    
                    // if the mnemonic is on its own, and it's a list, then we append the list to the args.
                    if(/* (treeMatches.index != null && treeMatches.index == 0) && */ item.trim().length == treeMatches[0].length) {
                        if(Array.isArray(value)) {
                            console.log("\tSaving expanded array into this step's parameters");
                            expandedBuild = expandedBuild.concat(value);
                            // Save it to the full list of sources for later
                            sourceTree = sourceTree.concat(value);
                        }
                    } else {
                        expandedBuild.push(itemTemp);
                    }
                } else {
                    switch(name) {
                        case "name":
                        let systemExt = process.platform == "win32" ? ".exe" : "";
                        expandedBuild.push(buildscript.name + systemExt);
                        break;
                    }
                }
            } else {
                switch (true) {
                    // %.o substitution
                    case /\%\.(.+?)/g.test(item):
                        let linkObjects = [];
                        // read source files
                        for (let source of sourceTree) {
                            // remove old extension
                            if(source.lastIndexOf(cwd) < 0) {
                                console.log("Compiling sources outside the cwd is not supported - cwd is", cwd, "source is", source);
                                return;
                            }
                            let sourcePath = source.substr(source.lastIndexOf(cwd) + cwd.length + 1);
                            sourcePath = sourcePath.substr(0, sourcePath.lastIndexOf("."));
                            // Whack the new extension on
                            sourcePath = cwd + "/bsTemp/" + sourcePath + item.substr(item.lastIndexOf("."));
                            // Save it
                            linkObjects.push(sourcePath);
                        }

                        console.log("Substituting replacement mnemonic", item, "with value", linkObjects);
                        expandedBuild = expandedBuild.concat(linkObjects);
                        break;
                    default:
                        expandedBuild = expandedBuild.concat(item);
                        break;
                }
            }
        }

        buildscript.build[key] = expandedBuild;
    }

    console.log("==================================");
    console.log("==================================");

    console.log("Preprocessing done. Building..");

    // now actually execute the build
    for(let keyFull in buildscript.build) {
        
        console.log("Executing build step", keyFull);
        let key = keyFull.split("-")[0];
        
        let stepNameStart = key.substr(0, 1);
        let stepName = "step" + stepNameStart.toUpperCase() + key.substr(1);

        for(let module in modules) {
            if(modules[module][stepName] != null) {
                console.log("Calling function", stepName, "of plugin", module);
                modules[module][stepName](buildscript.build[keyFull]);
            }
        }
    }

    console.log(buildscript);
}

main();