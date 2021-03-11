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
    
    // iterate source list
    for(let key in buildscript.source) {
        let expandedSrc = [];
        
        // iterate the files inside
        for(let index in buildscript.source[key]) {
            let item = buildscript.source[key][index];
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

    // iterate build instructions
    for(let key in buildscript.build) {
        let expandedBuild = [];
        
        console.log("Parsing build step", key);
        // iterate the steps inside
        for(let index in buildscript.build[key]) {
            let item = buildscript.build[key][index];
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
                        if(Array.isArray(value))
                            expandedBuild = expandedBuild.concat(value);
                    } else {
                        expandedBuild.push(itemTemp);
                    }
                }
            }
        }

        buildscript.build[key] = expandedBuild;
    }

    let modules = [];
    // seek for plugins to load
    for(let ind in extensionsUsed) {
        let ext = extensionsUsed[ind];

        console.log("Searching for a plugin for the extension", ext);
        let extPluginName = cwd + "/plugins/" + ext + ".js";
        if(!fs.existsSync(extPluginName)) {
            console.log("Expected plugin", extPluginName, "does not exist! Unable to build");
            return;
        }
        
        let module = require(extPluginName);
        modules.push(module);
        console.log("Imported plugin", extPluginName);
    }

    console.log(buildscript);
}

main();