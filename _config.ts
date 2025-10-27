import lume from "lume/mod.ts";
import esbuild from "lume/plugins/esbuild.ts";
import jsx from "lume/plugins/jsx.ts";
import tailwindcss from "lume/plugins/tailwindcss.ts";

// Function to get git commit information
function getGitInfo() {
  try {
    const gitHash = new Deno.Command("git", {
      args: ["rev-parse", "HEAD"],
    }).outputSync();

    const gitDate = new Deno.Command("git", {
      args: ["log", "-1", "--format=%cd", "--date=format:%Y-%m-%d %H:%M"],
    }).outputSync();

    const fullHash = new TextDecoder().decode(gitHash.stdout).trim();
    const shortHash = fullHash.substring(0, 7);
    const timestamp = new TextDecoder().decode(gitDate.stdout).trim();

    return {
      fullHash,
      shortHash,
      timestamp,
    };
  } catch {
    return {
      fullHash: "unknown",
      shortHash: "unknown",
      timestamp: "unknown",
    };
  }
}

const site = lume({ src: "src" });

// Add git information to global site data
const gitInfo = getGitInfo();
site.data("git", gitInfo);

site.options.prettyUrls = false;

// Add TypeScript and TSX files to be processed
site.add([".ts", ".tsx"]);

// Use JSX plugin for TSX page templates
site.use(
  jsx({
    extensions: [".tsx"],
    pageSubExtension: ".page",
  }),
);

// Use ESBuild plugin to transpile TypeScript and TSX to JavaScript
site.use(
  esbuild({
    extensions: [".ts", ".tsx"],
    options: {
      bundle: false, // Don't bundle - we want separate files
      format: "esm",
      minify: false, // Keep readable for development
      target: ["es2020"], // Modern browser target
      platform: "browser",
      jsx: "automatic", // Use React 17+ JSX transform
      jsxImportSource: "npm:react@18", // React from npm
    },
  }),
);

// Use Tailwind CSS for styling with external config
site.use(tailwindcss());
site.add("style.css");

// Copy static JavaScript files (non-TypeScript)
site.copy("quill-bridge.js");
site.copy("service-worker.js");

export default site;
