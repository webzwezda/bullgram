const syntaxHighlight = require("@11ty/eleventy-plugin-syntaxhighlight");

module.exports = function (eleventyConfig) {
  eleventyConfig.addPlugin(syntaxHighlight);

  eleventyConfig.addCollection("docsPages", (collectionApi) =>
    collectionApi
      .getAll()
      .filter((page) => page.data.group)
      .sort((a, b) => (a.data.order || 0) - (b.data.order || 0))
  );

  eleventyConfig.addPassthroughCopy("css");

  eleventyConfig.addFilter("groupPages", (pages) => {
    const map = new Map();
    for (const page of pages) {
      const name = page.data.group || "Pages";
      if (!map.has(name)) map.set(name, { name, items: [] });
      map.get(name).items.push({ title: page.data.title, url: page.url });
    }
    return [...map.values()];
  });

  return {
    pathPrefix: "/docs/",
    dir: {
      input: "content",
      includes: "../_includes",
      output: "_site"
    }
  };
};
