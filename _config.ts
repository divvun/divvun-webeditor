import lume from "lume/mod.ts";
import vento from "lume/plugins/vento.ts";

const site = lume({ src: "src" });

site.use(vento());

site.options.prettyUrls = false;

site.copy("static");

// Generate fallback pages for missing translations
site.addEventListener("beforeBuild", async () => {
  const srcDir = "src";

  // Get all Norwegian pages
  const norwegianPages: string[] = [];
  for await (const entry of Deno.readDir(srcDir)) {
    if (
      entry.isFile &&
      entry.name.endsWith(".md") &&
      entry.name !== "index.md"
    ) {
      norwegianPages.push(entry.name);
    }
  }

  for (const pageFile of norwegianPages) {
    const pageName = pageFile.replace(".md", "");

    // Read the Norwegian content
    const content = await Deno.readTextFile(`${srcDir}/${pageFile}`);

    // Extract frontmatter if present
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    const pageData: Record<string, string> = {};
    let pageContent = content;

    if (frontmatterMatch) {
      // Parse frontmatter (simple YAML parsing)
      const frontmatter = frontmatterMatch[1];
      pageContent = frontmatterMatch[2];

      frontmatter.split("\n").forEach((line) => {
        const [key, ...valueParts] = line.split(":");
        if (key && valueParts.length > 0) {
          const value = valueParts.join(":").trim();
          pageData[key.trim()] = value;
        }
      });
    }

    // Add se fallback page
    site.page({
      url: `/se/${pageName}/`,
      content: pageContent,
      ...pageData,
    });

    // Add sma fallback page
    site.page({
      url: `/sma/${pageName}/`,
      content: pageContent,
      ...pageData,
    });
  }
});

export default site;
