import rss from "@11ty/eleventy-plugin-rss";

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(rss);

  // Папки-посты: content/posts/<slug>/index.md + index.yml (метаданные рядом).
  eleventyConfig.addCollection("posts", (collectionApi) =>
    collectionApi
      .getFilteredByGlob("content/posts/*/index.md")
      .sort((a, b) => new Date(b.data.date) - new Date(a.data.date))
  );

  eleventyConfig.addFilter("ruDate", (value) =>
    new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric"
    }).format(new Date(value))
  );

  eleventyConfig.addFilter("rfc3339", (value) => new Date(value).toISOString());

  eleventyConfig.addPassthroughCopy("css");

  return {
    pathPrefix: "/blog/",
    dir: {
      input: "content",
      includes: "../_includes",
      output: "_site"
    }
  };
}
