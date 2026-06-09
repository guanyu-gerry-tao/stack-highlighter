const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const sharedPath = path.join(root, "src", "shared.js");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const sidepanelHtml = fs.readFileSync(path.join(root, "sidepanel.html"), "utf8");
const sharedSource = fs.readFileSync(sharedPath, "utf8");
const context = { window: {} };

vm.createContext(context);
vm.runInContext(sharedSource, context);

const shared = context.window.StackHighlighterShared;
const plain = (value) => JSON.parse(JSON.stringify(value));

function keywordsByCategory(categories = shared.categoriesFromStorage(null)) {
  return new Map(categories.map((category) => [category.id, category.keywords]));
}

function assertIncludesAll(values, expected, label) {
  for (const value of expected) {
    assert.ok(values.includes(value), `${value} should be in ${label}`);
  }
}

function assertExcludesAll(values, expected, label) {
  for (const value of expected) {
    assert.equal(values.includes(value), false, `${value} should not be in ${label}`);
  }
}

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, "0.2.2");
assert.equal(manifest.name, "Stack Highlighter");
assert.ok(manifest.permissions.includes("storage"));
assert.ok(manifest.permissions.includes("sidePanel"));
assert.ok(manifest.permissions.includes("activeTab"));
assert.ok(manifest.permissions.includes("scripting"));

for (const id of [
  "categoryList",
  "searchInput",
  "viewJsonButton",
  "exportJsonButton",
  "importJsonButton",
  "importJsonFileInput",
  "jsonEditorPanel",
  "jsonTextarea",
  "addCategoryButton",
  "disabledOverlay",
  "disabledEnableButton"
]) {
  assert.match(sidepanelHtml, new RegExp(`id="${id}"`), `${id} should exist in sidepanel.html`);
}

assert.equal(shared.sanitizeKeyword("  React,  "), "React");
assert.equal(shared.sanitizeStoredKeyword("  React,  "), "react");
assert.equal(shared.sanitizeKeyword(" “Self Motivated.” "), "Self Motivated");
assert.equal(shared.selectionKeyword("one two three four five six"), "");
assert.equal(shared.wordCount("AI Coding Tool"), 3);
assert.equal(shared.isHighlightingEnabled(undefined), true);
assert.equal(shared.isHighlightingEnabled(false), false);
assert.equal(shared.canUsePluralSuffix("database", "s"), true);
assert.equal(shared.canUsePluralSuffix("go", "es"), false);
assert.deepEqual(plain(shared.normalizeKeywordList([" Python ", "python", "", " JavaScript, "])), ["python", "javascript"]);

const categories = shared.categoriesFromStorage(null);
const defaultKeywords = keywordsByCategory(categories);
assert.deepEqual(plain(categories.map((category) => category.id)), [
  "redFlags",
  "hardSkills",
  "patterns",
  "softSkills",
  "other"
]);

assertIncludesAll(defaultKeywords.get("hardSkills"), [
  "python",
  "javascript",
  "typescript",
  "java",
  "go",
  "c++",
  "git",
  "linux",
  "graphql",
  "mongodb",
  "aws",
  "azure",
  "gcp",
  "terraform",
  "docker",
  "kubernetes",
  "react",
  "pytorch",
  "snowflake"
], "hard skills");

assertIncludesAll(defaultKeywords.get("patterns"), [
  "agile",
  "ci/cd",
  "system design",
  "unit testing",
  "data pipeline",
  "distributed system",
  "observability",
  "query optimization"
], "patterns");

assertIncludesAll(defaultKeywords.get("softSkills"), [
  "communication",
  "teamwork",
  "attention to detail",
  "adaptability"
], "soft skills");

assertIncludesAll(defaultKeywords.get("redFlags"), [
  "sponsorship",
  "without sponsorship",
  "requires sponsorship",
  "u.s. person",
  "h-1b"
], "red flags");

assertIncludesAll(defaultKeywords.get("other"), [
  "intern",
  "internship",
  "2026",
  "2027",
  "co-op",
  "undergraduate",
  "full-time"
], "other keywords");

assertExcludesAll(defaultKeywords.get("hardSkills"), [
  "c/c++",
  "gmail api",
  "azure openai",
  "anthropic sdk",
  "claude api"
], "hard skills");

assertExcludesAll(defaultKeywords.get("patterns"), [
  "monorepo",
  "job scoring",
  "run status tracking",
  "resume tailor"
], "patterns");

const importedCategories = shared.categoriesFromKeywordTableJson(JSON.stringify({
  categories: [
    { name: "Signals", color: "#14b8a6", enabled: false, keywords: [" GraphQL, "] },
    { id: "other", name: "Other Keywords", color: "#f2b84b", keywords: [" Internship. "] }
  ]
}));
assert.equal(importedCategories[0].label, "Signals");
assert.equal(importedCategories[0].color, "#14b8a6");
assert.equal(importedCategories[0].enabled, false);
assert.ok(importedCategories[0].keywords.includes("graphql"));
assert.ok(importedCategories.find((category) => category.id === "other").keywords.includes("internship"));

assert.throws(() => shared.categoriesFromKeywordTableJson("{bad json"), /Invalid keyword table JSON/);
assert.throws(
  () => shared.categoriesFromKeywordTableJson(JSON.stringify({
    categories: [
      { name: "Signals", color: "#14b8a6", keywords: [] },
      { name: "signals", color: "#4f8cff", keywords: [] }
    ]
  })),
  /Category names must be unique/
);

const exportedTable = shared.keywordTableFromCategories([
  { id: "hardSkills", label: "Hard Skills", color: "#4f8cff", enabled: false, keywords: ["Python"] }
]);
assert.deepEqual(Object.keys(exportedTable), ["categories"]);
assert.deepEqual(Object.keys(exportedTable.categories[0]), ["name", "color", "enabled", "keywords"]);
assert.equal(exportedTable.categories[0].enabled, false);
assert.deepEqual(exportedTable.categories[0].keywords, ["python"]);

const addedCategory = shared.addCategory(categories, "Target Stack", "#22c55e");
assert.equal(addedCategory.added, true);
assert.equal(addedCategory.category.label, "Target Stack");
assert.equal(shared.addCategory(addedCategory.categories, "Target Stack", "#22c55e").added, false);
assert.equal(shared.removeCategory(addedCategory.categories, addedCategory.category.id).some((category) => category.id === addedCategory.category.id), false);

const addedKeyword = shared.addKeyword(categories, "other", "  Summer, ");
assert.equal(addedKeyword.added, false);
assert.equal(addedKeyword.keyword, "summer");

const moved = shared.moveKeyword(categories, "hardSkills", "patterns", "Python");
assert.equal(moved.find((category) => category.id === "hardSkills").keywords.includes("python"), false);
assert.equal(moved.find((category) => category.id === "patterns").keywords.includes("python"), true);

const migrated = shared.migrateCategoriesForVersion(
  shared.categoriesFromStorage([
    { id: "hardSkills", keywords: ["Python"] },
    { id: "patterns", keywords: ["CQRS"] },
    { id: "other", keywords: ["Intern", "2026"] }
  ]),
  0
);
const migratedKeywords = keywordsByCategory(migrated);
assertIncludesAll(migratedKeywords.get("hardSkills"), ["git", "graphql", "terraform", "pytorch", "snowflake"], "migrated hard skills");
assertIncludesAll(migratedKeywords.get("patterns"), ["agile", "system design", "unit testing"], "migrated patterns");
assertIncludesAll(migratedKeywords.get("softSkills"), ["teamwork"], "migrated soft skills");
assertIncludesAll(migratedKeywords.get("redFlags"), ["without sponsorship"], "migrated red flags");
assertIncludesAll(migratedKeywords.get("other"), ["2027", "co-op"], "migrated other keywords");

assert.equal(shared.keywordMatchesQuery("React Native", "React"), true);
assert.equal(shared.keywordMatchesQuery("React", "React Native"), true);
assert.equal(shared.keywordMatchesQuery("Python", "React"), false);
assert.deepEqual(
  plain(shared.sortKeywordsByPageMatch(["Python", "JavaScript", "React"], new Set(["javascript"]))),
  ["JavaScript", "Python", "React"]
);

const flattened = shared.flattenKeywords([
  { id: "hardSkills", label: "Hard Skills", color: "#4f8cff", keywords: ["React", "React Native"] }
]);
assert.deepEqual(plain(flattened.map((item) => item.keyword)), ["react native", "react"]);

function regexMatches(keywords, text) {
  const { regex } = shared.buildKeywordRegex([
    { id: "hardSkills", label: "Hard Skills", color: "#4f8cff", keywords }
  ]);
  return [...text.matchAll(regex)].map((match) => ({
    keyword: match[2],
    suffix: match[3] || ""
  }));
}

assert.deepEqual(plain(regexMatches(["react", "react native", "python"], "React Native, React, and Python.")), [
  { keyword: "React Native", suffix: "" },
  { keyword: "React", suffix: "" },
  { keyword: "Python", suffix: "" }
]);
assert.deepEqual(plain(regexMatches(["c", "c++"], "C/C++ and C++")), [
  { keyword: "C", suffix: "" },
  { keyword: "C++", suffix: "" },
  { keyword: "C++", suffix: "" }
]);
assert.deepEqual(plain(regexMatches(["ml"], "ML/AI coursework")), [{ keyword: "ML", suffix: "" }]);
assert.deepEqual(plain(regexMatches(["java"], "JavaScript")), []);
assert.deepEqual(
  plain(regexMatches(["go"], "ego, go, goes").filter((match) => shared.canUsePluralSuffix(match.keyword, match.suffix))),
  [{ keyword: "go", suffix: "" }]
);
assert.deepEqual(plain(regexMatches(["api", "database", "process"], "APIs, databases, processes")), [
  { keyword: "API", suffix: "s" },
  { keyword: "database", suffix: "s" },
  { keyword: "process", suffix: "es" }
]);

const { regex: disabledCategoryRegex } = shared.buildKeywordRegex([
  { id: "hardSkills", label: "Hard Skills", color: "#4f8cff", enabled: false, keywords: ["python"] },
  { id: "patterns", label: "Patterns", color: "#43b883", enabled: true, keywords: ["sdlc"] }
]);
assert.deepEqual(plain([..."Python and SDLC".matchAll(disabledCategoryRegex)].map((match) => match[2])), ["SDLC"]);

console.log("shared.test.js passed");
