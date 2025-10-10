import lume from "lume/mod.ts";

const site = lume({ src: "src" });

site.options.prettyUrls = false;

site.copy("static");

export default site;
