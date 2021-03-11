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
    let cwd = path.resolve("./").replace(/\\/g, "/");
    let modules = {};
    let sourceTree = [];

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
                console.log("Appending absolute file", tempPath, "to source set", key);

                expandedSrc = expandedSrc.concat(tempPath);
            }
        }

        buildscript.source[key] = expandedSrc;
    }

    // seek for plugins to load
    for(let ext of extensionsUsed) {

        console.log("Searching for a plugin for the extension", ext);
        let extPluginName = cwd + "/plugins/" + ext + ".js";
        if(!fs.existsSync(extPluginName)) {
            console.log("Expected plugin", extPluginName, "does not exist! Unable to build");
            return;
        }
        
        modules[ext] = require(extPluginName);
        let preprocessorFunc = "extension" + ext.toUpperCase();
        // preprocess the buildscript
        modules[ext][preprocessorFunc](buildscript);
        
        console.log("Imported plugin", extPluginName, "for extension", ext, "and ran preprocessor function", preprocessorFunc);
    }
    
    console.log(modules);

    // iterate build instructions
    for(let key in buildscript.build) {
        let expandedBuild = [];
        
        console.log("Parsing build step", key);
        // iterate the steps inside
        for(let item of buildscript.build[key]) {
            console.log("Reading step argument", item);
            // find \$(.+?)\b
            let treeRegex = /\$(.+?)\b/;
            let treeMatches = item.match(treeRegex);
            // if we have something to parse, read it in
            if(treeMatches != null) {
                let name = treeMatches[1];
                console.log("Found mnemonic", name, "in step", item);
                // check if the name is a source set
                if(name in buildscript.source) {
                    // if so, sub it in
                    let value = buildscript.source[name];
                    let itemTemp = item.replace(treeMatches[0], value);
                    console.log("Substituting mnemonic", name, "with value", value);
                    
                    
                    // if the mnemonic is on its own, and it's a list, then we append the list to the args.
                    if(treeMatches.index == 0 && item.trim().length == treeMatches[0].length) {
                        if(Array.isArray(value)) {
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
                            let sourcePath = source.substr(0, source.lastIndexOf("."));
                            // Whack the new extension on
                            sourcePath = sourcePath + item.substr(item.lastIndexOf("."));
                            // Save it
                            linkObjects.push(sourcePath);
                        }

                        console.log("Substituting mnemonic", item, "with value", linkObjects);
                        expandedBuild = expandedBuild.concat(linkObjects);
                        break;
                }
            }
        }

        buildscript.build[key] = expandedBuild;
    }

    console.log(buildscript);
}

main();