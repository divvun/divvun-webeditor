import lume from "lume/mod.ts";

const site = lume({ src: "src" });

site.options.prettyUrls = false;

export default site;
