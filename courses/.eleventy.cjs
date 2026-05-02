const COURSES_BASE_PATH = "/courses";
const SITE_URL = "https://bullrun.ru";

function coursesPath(value = "/") {
  if (typeof value !== "string") {
    return COURSES_BASE_PATH + "/";
  }

  if (/^https?:\/\//.test(value)) {
    return value;
  }

  const path = value.startsWith("/") ? value : `/${value}`;
  if (path === "/") {
    return `${COURSES_BASE_PATH}/`;
  }

  return `${COURSES_BASE_PATH}${path}`.replace(/\/{2,}/g, "/");
}

function absoluteCoursesUrl(value = "/") {
  if (typeof value === "string" && /^https?:\/\//.test(value)) {
    return value;
  }

  return `${SITE_URL}${coursesPath(value)}`;
}

function getCourse(courses, slug) {
  return (courses || []).find((course) => course.slug === slug) || null;
}

function getCourseLessons(lessons, courseSlug) {
  return (lessons || [])
    .filter((lesson) => lesson.data.course === courseSlug)
    .sort((left, right) => {
      const byOrder = (left.data.order || 0) - (right.data.order || 0);
      if (byOrder !== 0) return byOrder;
      return left.data.title.localeCompare(right.data.title, "ru");
    });
}

function lessonNeighbor(lessons, pageUrl, offset) {
  const index = (lessons || []).findIndex((lesson) => lesson.url === pageUrl);
  if (index === -1) return null;
  return lessons[index + offset] || null;
}

module.exports = function(eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "styles": "styles" });
  eleventyConfig.addPassthroughCopy({ "assets": "assets" });

  eleventyConfig.addFilter("coursesPath", coursesPath);
  eleventyConfig.addFilter("absoluteCoursesUrl", absoluteCoursesUrl);
  eleventyConfig.addFilter("json", (value) => JSON.stringify(value));
  eleventyConfig.addFilter("isoDate", (value) => new Date(value).toISOString());

  eleventyConfig.addFilter("readableDate", (value) => {
    const date = new Date(value);
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric"
    }).format(date);
  });

  eleventyConfig.addFilter("courseBySlug", getCourse);
  eleventyConfig.addFilter("courseLessons", getCourseLessons);
  eleventyConfig.addFilter("previousLesson", (lessons, pageUrl) => lessonNeighbor(lessons, pageUrl, -1));
  eleventyConfig.addFilter("nextLesson", (lessons, pageUrl) => lessonNeighbor(lessons, pageUrl, 1));

  eleventyConfig.addCollection("lessons", (collectionApi) => {
    return collectionApi
      .getFilteredByGlob("lessons/**/*.md")
      .sort((left, right) => {
        const byCourse = left.data.course.localeCompare(right.data.course, "ru");
        if (byCourse !== 0) return byCourse;
        return (left.data.order || 0) - (right.data.order || 0);
      });
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
