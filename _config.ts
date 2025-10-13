import lume from "lume/mod.ts";
import esbuild from "lume/plugins/esbuild.ts";

const site = lume({ src: "src" });

site.options.prettyUrls = false;

// Add TypeScript files to be processed
site.add([".ts"]);

// Use ESBuild plugin to transpile TypeScript to JavaScript
site.use(esbuild({
  extensions: [".ts"],
  options: {
    bundle: false, // Don't bundle - we want separate files
    format: "esm",
    minify: false, // Keep readable for development
    target: ["es2020"], // Modern browser target
    platform: "browser",
  }
}));

// Copy static JavaScript files (non-TypeScript)
site.copy("quill-bridge.js");

export default site;
