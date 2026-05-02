const pluginRss = require("@11ty/eleventy-plugin-rss").default;

const BLOG_BASE_PATH = "/blog";
const SITE_URL = "https://bullrun.ru";

function blogPath(value = "/") {
  if (/^https?:\/\//.test(value)) {
    return value;
  }

  const path = value.startsWith("/") ? value : `/${value}`;
  if (path === "/") {
    return `${BLOG_BASE_PATH}/`;
  }

  return `${BLOG_BASE_PATH}${path}`.replace(/\/{2,}/g, "/");
}

function absoluteBlogUrl(value = "/") {
  if (/^https?:\/\//.test(value)) {
    return value;
  }

  return `${SITE_URL}${blogPath(value)}`;
}

module.exports = function(eleventyConfig) {
  eleventyConfig.addPlugin(pluginRss);

  eleventyConfig.addPassthroughCopy({ "styles": "styles" });
  eleventyConfig.addPassthroughCopy({ "assets": "assets" });

  eleventyConfig.addFilter("readableDate", (value) => {
    const date = new Date(value);
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric"
    }).format(date);
  });

  eleventyConfig.addFilter("categoryPosts", (posts, categorySlug) => {
    return (posts || []).filter((post) => post.data.category === categorySlug);
  });

  eleventyConfig.addFilter("categoryCount", (posts, categorySlug) => {
    return (posts || []).filter((post) => post.data.category === categorySlug).length;
  });

  eleventyConfig.addFilter("categoryLabel", (categorySlug, categories) => {
    const category = (categories || []).find((item) => item.slug === categorySlug);
    return category?.label || categorySlug;
  });

  eleventyConfig.addFilter("blogPath", blogPath);

  eleventyConfig.addFilter("absoluteBlogUrl", absoluteBlogUrl);

  eleventyConfig.addFilter("json", (value) => JSON.stringify(value));

  eleventyConfig.addFilter("isoDate", (value) => new Date(value).toISOString());

  eleventyConfig.addCollection("posts", (collectionApi) => {
    return collectionApi
      .getFilteredByGlob("posts/*.md")
      .sort((left, right) => right.date - left.date);
  });

  const getCategoryPosts = (collectionApi, categorySlug) => {
    return collectionApi
      .getFilteredByGlob("posts/*.md")
      .filter((post) => post.data.category === categorySlug)
      .sort((left, right) => right.date - left.date);
  };

  eleventyConfig.addCollection("telegramPosts", (collectionApi) => {
    return getCategoryPosts(collectionApi, "telegram");
  });

  eleventyConfig.addCollection("steamPosts", (collectionApi) => {
    return getCategoryPosts(collectionApi, "steam");
  });

  eleventyConfig.addCollection("cryptoPosts", (collectionApi) => {
    return getCategoryPosts(collectionApi, "crypto");
  });

  return {
    dir: {
      input: ".",
      output: "_site",
      includes: "_includes",
      data: "_data"
    },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    templateFormats: ["md", "njk", "html"]
  };
};
