const child = require("child_process");
const fs = require("fs");

let defaultCompiler = "gcc";
let tempDir;
let defaultLinkFlags = "%.o"
let defaultOutput = "$name"


module.exports = {
    
    /**
     * Preprocess the buildscript.
     * If it contains compile, assemble and link steps, it does nothing
     * If it contains compile but no build, it implicitly adds it with the default arguments.
     * @param {object} buildscript the JSON buildscript object
     */
    extensionC: function(buildscript) {
        console.log("c.js processing buildscript");
        if(!("link" in buildscript.build)) {
            console.log("Inserting link step for gcc");
            buildscript.build["link"] = [defaultLinkFlags];
        }

        if(!("output" in buildscript.build)) {
            console.log("Inserting output step");
            buildscript.build["output"] = [defaultOutput];
        }

        console.log("Creating temporary dir for object files");
        fs.mkdirSync(process.cwd() + "/bsTemp/");
        tempDir = process.cwd() + "/bsTemp/";
    },

    extensionH: function() {},

    /**
     * Called when it is time to execute the compile step.
     * It is passed the array of strings associated with the step in the buildscript.
     * @param  {...string} params the list of strings
     */
    stepCompile: function(...params) {
        let compileFlags = "";
        for(var param of params) {
            if(param.startsWith("-")) {
                compileFlags = param;
            } else {
                let filePath = param.substr(0, param.lastIndexOf("."));
                let fileName = param.substr(param.lastIndexOf("/"), param.lastIndexOf("."));
                let compilerCommand =
                    defaultCompiler + 
                    " -c " + filePath + ".c" +
                    " -o " + tempDir + "/" + fileName + ".o "
                    + compileFlags;
                
                child.spawn(compilerCommand);
            }
        }
    }

}