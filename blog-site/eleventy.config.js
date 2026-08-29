import rss from "@11ty/eleventy-plugin-rss";

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(rss);

  // Папки-посты: content/posts/<slug>/index.md + index.json (метаданные рядом).
  eleventyConfig.addCollection("posts", (collectionApi) =>
    collectionApi
      .getFilteredByGlob("content/posts/*/index.md")
      .sort((a, b) => new Date(b.data.date) - new Date(a.data.date))
  );

  // Физически сайт собирается в dist/blog, поэтому все абсолютные пути
  // пишем сами: без pathPrefix и без авто-реврайтов Eleventy 3.1,
  // которые задваивают префикс при комбинировании с url-фильтром.
  eleventyConfig.addFilter("blogUrl", (value) => `/blog${value}`);

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
    pathPrefix: "/",
    dir: {
      input: "content",
      includes: "../_includes",
      output: "_site"
    }
  };
}
