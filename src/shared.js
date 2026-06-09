(function () {
  /**
   * Shared constants, defaults, and pure helpers used by both the side panel and
   * the content script. This file intentionally avoids module imports because it
   * is loaded directly by Chrome as a plain script.
   */

  /** Chrome storage keys owned by the extension. */
  const STORAGE_KEYS = {
    categories: "stackHighlighter.categories",
    selectedText: "stackHighlighter.selectedText",
    pageMatches: "stackHighlighter.pageMatches",
    keywordDataVersion: "stackHighlighter.keywordDataVersion",
    enabled: "stackHighlighter.enabled"
  };

  /** Bump this when default keyword data should be added to existing users. */
  const CURRENT_KEYWORD_DATA_VERSION = 10;

  /** Built-in category order used for a fresh install and restored defaults. */
  const CATEGORY_ORDER = ["redFlags", "hardSkills", "patterns", "softSkills", "other"];

  /** Default keyword table shown on first install. */
  const DEFAULT_CATEGORIES = [
    {
      id: "hardSkills",
      label: "Hard Skills",
      color: "#4f8cff",
      keywords: [
        "Java",
        "Spring Boot",
        "Python",
        "FastAPI",
        "TypeScript",
        "JavaScript",
        "Node.js",
        "Go",
        "C",
        "C++",
        "C#",
        "Git",
        "Linux",
        "Bash",
        "Shell",
        "RESTful API",
        "GraphQL",
        "SQL",
        "NoSQL",
        "MySQL",
        "PostgreSQL",
        "pgvector",
        "SQLite",
        "MongoDB",
        "DynamoDB",
        "Redis",
        "Elasticsearch",
        "Kafka",
        "RabbitMQ",
        "Redpanda",
        "Weaviate",
        "Milvus",
        "Docker",
        "Docker Compose",
        "Kubernetes",
        "Helm",
        "AWS",
        "EC2",
        "EKS",
        "S3",
        "Lambda",
        "API Gateway",
        "SQS",
        "RDS",
        "Azure",
        "GCP",
        "Terraform",
        "Jenkins",
        "GitHub Actions",
        "GitLab CI",
        "Playwright",
        "Selenium",
        "Cypress",
        "Jest",
        "JUnit",
        "OpenAI API",
        "MCP SDK",
        "LangChain",
        "LangGraph",
        "RAG",
        "BM25",
        "Vector Database",
        "Tool Calling",
        "Multi-Agent Workflow",
        "Prompt Engineering",
        "Machine Learning",
        "Deep Learning",
        "NLP",
        "LLM",
        "PyTorch",
        "TensorFlow",
        "scikit-learn",
        "Pandas",
        "NumPy",
        "XGBoost",
        "Spark",
        "Airflow",
        "Snowflake",
        "Databricks",
        "Neo4j",
        "NebulaGraph",
        "React",
        "Next.js",
        "Vue",
        "Angular",
        "Tailwind CSS",
        "CSS",
        "HTML",
        "ESLint",
        "pytest",
        "Vibe Coding",
        "Codex",
        "Cursor",
        "Claude Code"
      ]
    },
    {
      id: "patterns",
      label: "Patterns",
      color: "#43b883",
      keywords: [
        "AI Coding",
        "AI Evaluation",
        "AI Runtime",
        "Agile",
        "Application Layer",
        "Audit Log",
        "Browser Automation",
        "CI/CD",
        "Cloud Computing",
        "Containerization",
        "CQRS",
        "Data Modeling",
        "Database Design",
        "Data Pipeline",
        "Data Visualization",
        "Data Warehousing",
        "DevOps",
        "Distributed System",
        "ETL",
        "Event-Driven Architecture",
        "Feature Engineering",
        "Hybrid Search",
        "Idempotency",
        "Incident Detection",
        "Indexing",
        "Integration Testing",
        "Knowledge Base",
        "Layered Architecture",
        "MCP Server",
        "Microservice",
        "MLOps",
        "Model Evaluation",
        "Observability",
        "Object-Oriented Programming",
        "Platform API",
        "Platform Engineering",
        "Optimistic Locking",
        "Outbox Pattern",
        "Query Optimization",
        "REST API",
        "Scalability",
        "Schema Design",
        "Scrum",
        "SDLC",
        "System Design",
        "TDD",
        "Test Automation",
        "Unit Testing",
        "Vector Search",
        "Workflow Orchestration"
      ]
    },
    {
      id: "softSkills",
      label: "Soft Skills",
      color: "#9b7bff",
      keywords: [
        "Self Motivated",
        "Ownership",
        "Collaboration",
        "Communication",
        "Problem Solving",
        "Analytical",
        "Attention to Detail",
        "Adaptability",
        "Teamwork",
        "Leadership",
        "Cross-functional",
        "Customer Focus",
        "Fast-paced",
        "Written Communication",
        "Verbal Communication",
        "Debuggable",
        "Traceable",
        "Maintainable",
        "Extensible",
        "Reliable",
        "Quality Gate",
        "Mentored"
      ]
    },
    {
      id: "redFlags",
      label: "Red Flags",
      color: "#ff6b6b",
      keywords: [
        "GC",
        "Green Card",
        "Greencard",
        "sponsorship",
        "visa sponsorship",
        "immigration support",
        "work authorization",
        "authorized to work",
        "without sponsorship",
        "require sponsorship",
        "requires sponsorship",
        "now or in the future",
        "citizen",
        "US Citizen",
        "U.S. Citizen",
        "US Person",
        "U.S. Person",
        "permanent resident",
        "security clearance",
        "clearance",
        "export control",
        "ITAR",
        "CPT",
        "OPT",
        "H-1B"
      ]
    },
    {
      id: "other",
      label: "Other Keywords",
      color: "#f2b84b",
      keywords: [
        "Intern",
        "Internship",
        "SWE Intern",
        "Software Engineer Intern",
        "2026",
        "2027",
        "Summer",
        "Fall",
        "Spring",
        "New Grad",
        "Graduate",
        "Undergraduate",
        "Bachelor",
        "Entry Level",
        "Early Career",
        "Full-time",
        "Part-time",
        "Co-op",
        "Remote",
        "Hybrid",
        "Onsite",
        "Return Offer",
        "University",
        "Master"
      ]
    }
  ];

  /** Keywords added to existing saved tables when the data version increases. */
  const KEYWORD_DATA_MIGRATION_ADDITIONS = {
    hardSkills: [
      "Go",
      "C",
      "C++",
      "C#",
      "Git",
      "Linux",
      "Bash",
      "Shell",
      "RESTful API",
      "GraphQL",
      "NoSQL",
      "pgvector",
      "MongoDB",
      "DynamoDB",
      "Elasticsearch",
      "RabbitMQ",
      "Redpanda",
      "AWS",
      "EC2",
      "EKS",
      "S3",
      "Lambda",
      "API Gateway",
      "SQS",
      "RDS",
      "Azure",
      "GCP",
      "Terraform",
      "Jenkins",
      "GitLab CI",
      "Selenium",
      "Cypress",
      "Jest",
      "JUnit",
      "OpenAI API",
      "MCP SDK",
      "BM25",
      "Vector Database",
      "Tool Calling",
      "Multi-Agent Workflow",
      "Prompt Engineering",
      "Machine Learning",
      "Deep Learning",
      "NLP",
      "LLM",
      "PyTorch",
      "TensorFlow",
      "scikit-learn",
      "Pandas",
      "NumPy",
      "XGBoost",
      "Spark",
      "Airflow",
      "Snowflake",
      "Databricks",
      "Neo4j",
      "NebulaGraph",
      "Vue",
      "Angular",
      "CSS",
      "HTML",
      "Vibe Coding",
      "Codex",
      "Cursor",
      "Claude Code"
    ],
    patterns: [
      "Agile",
      "CQRS",
      "Cloud Computing",
      "Data Modeling",
      "Database Design",
      "Data Pipeline",
      "Data Visualization",
      "Data Warehousing",
      "DevOps",
      "ETL",
      "Event-Driven Architecture",
      "Feature Engineering",
      "Incident Detection",
      "Indexing",
      "Integration Testing",
      "Optimistic Locking",
      "Outbox Pattern",
      "Query Optimization",
      "Scalability",
      "Schema Design",
      "Scrum",
      "System Design",
      "TDD",
      "Test Automation",
      "Unit Testing",
      "Distributed System",
      "Microservice",
      "MLOps",
      "Model Evaluation",
      "Object-Oriented Programming"
    ],
    softSkills: [
      "Analytical",
      "Attention to Detail",
      "Adaptability",
      "Teamwork",
      "Leadership",
      "Cross-functional",
      "Customer Focus",
      "Fast-paced",
      "Written Communication",
      "Verbal Communication"
    ],
    redFlags: [
      "authorized to work",
      "without sponsorship",
      "requires sponsorship",
      "US Person",
      "U.S. Person"
    ],
    other: ["2027", "Undergraduate", "Bachelor", "Full-time", "Part-time", "Co-op"]
  };

  /** Trims user selections such as " Python," into the useful keyword body. */
  const trailingPunctuation = /^[\s"'“”‘’([{<]+|[\s.,;:!?，。；：！？"'“”‘’)\]}>]+$/g;
  /** A word boundary for matching: letters, numbers, and underscore stay internal. */
  const textTokenBoundary = "[^\\p{L}\\p{N}_]";
  /** Palette for imported or user-created categories without valid colors. */
  const fallbackCategoryColors = ["#4f8cff", "#43b883", "#9b7bff", "#ff6b6b", "#f2b84b", "#14b8a6", "#ef7d55"];

  /** Category and text normalization helpers. */
  function cloneCategories(categories) {
    return categories.map((category) => ({
      ...category,
      keywords: [...category.keywords]
    }));
  }

  function categoryIsEnabled(category) {
    return category?.enabled !== false;
  }

  function sanitizeKeyword(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(trailingPunctuation, "")
      .trim();
  }

  function sanitizeStoredKeyword(value) {
    return sanitizeKeyword(value).toLocaleLowerCase();
  }

  function sanitizeCategoryName(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function sanitizeColor(value, fallback = fallbackCategoryColors[0]) {
    const color = String(value || "").trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
  }

  function categoryIdFromName(value) {
    const slug = sanitizeCategoryName(value)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    return slug || "category";
  }

  function uniqueCategoryId(baseId, existingIds) {
    const base = categoryIdFromName(baseId);
    let candidate = base;
    let index = 2;

    while (existingIds.has(candidate)) {
      candidate = `${base}-${index}`;
      index += 1;
    }

    existingIds.add(candidate);
    return candidate;
  }

  function assertUniqueCategoryNames(categoryPayload) {
    const seenNames = new Set();

    for (const category of categoryPayload || []) {
      const name = normalizeKeyword(category?.name || category?.label || category?.id);
      if (!name) continue;
      if (seenNames.has(name)) throw new Error("Category names must be unique");
      seenNames.add(name);
    }
  }

  function wordCount(value) {
    const cleaned = sanitizeKeyword(value);
    if (!cleaned) return 0;
    return cleaned.split(/\s+/).length;
  }

  function selectionKeyword(value) {
    const keyword = sanitizeKeyword(value);
    if (!keyword || wordCount(keyword) > 5) return "";
    return keyword;
  }

  function isHighlightingEnabled(value) {
    return value !== false;
  }

  function normalizeKeyword(value) {
    return sanitizeKeyword(value).toLocaleLowerCase();
  }

  function canUsePluralSuffix(keyword, suffix) {
    if (!suffix) return true;
    return normalizeKeyword(keyword).length >= 3;
  }

  function normalizeKeywordList(values) {
    const seen = new Set();
    const normalized = [];

    for (const value of values || []) {
      const keyword = normalizeKeyword(value);
      if (!keyword || seen.has(keyword)) continue;
      seen.add(keyword);
      normalized.push(keyword);
    }

    return normalized;
  }

  function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function sortCategoriesByDefaultOrder(categories) {
    const order = new Map(CATEGORY_ORDER.map((id, index) => [id, index]));
    return cloneCategories(categories).sort((a, b) => {
      return (order.get(a.id) ?? CATEGORY_ORDER.length) - (order.get(b.id) ?? CATEGORY_ORDER.length);
    });
  }

  /** Storage, import, export, and additive migration helpers. */
  function categoriesFromStorage(value) {
    const shouldUseDefaultOrder = !Array.isArray(value);
    const categoryPayload = shouldUseDefaultOrder ? DEFAULT_CATEGORIES : value;

    const defaultsById = new Map(DEFAULT_CATEGORIES.map((category) => [category.id, category]));
    const seenIds = new Set();
    const seenNames = new Set();

    const categories = categoryPayload
      .filter(Boolean)
      .map((category, index) => {
        const defaultCategory = category.id ? defaultsById.get(category.id) : null;
        const label = sanitizeCategoryName(category.name || category.label || defaultCategory?.label || category.id);
        if (!label) return null;

        const normalizedLabel = normalizeKeyword(label);
        if (seenNames.has(normalizedLabel)) return null;
        seenNames.add(normalizedLabel);

        const id =
          defaultCategory && !seenIds.has(category.id)
            ? (seenIds.add(category.id), category.id)
            : uniqueCategoryId(category.id || label, seenIds);
        const fallbackColor = defaultCategory?.color || fallbackCategoryColors[index % fallbackCategoryColors.length];

        return {
          id,
          label,
          color: sanitizeColor(category.color || defaultCategory?.color, fallbackColor),
          enabled: categoryIsEnabled(category),
          keywords: Array.isArray(category.keywords) ? category.keywords.map(sanitizeStoredKeyword).filter(Boolean) : []
        };
      })
      .filter(Boolean);

    return shouldUseDefaultOrder ? sortCategoriesByDefaultOrder(categories) : categories;
  }

  function keywordTableFromCategories(categories) {
    return {
      categories: categoriesFromStorage(categories).map((category) => ({
        name: category.label,
        color: category.color,
        enabled: categoryIsEnabled(category),
        keywords: category.keywords.map(sanitizeStoredKeyword).filter(Boolean)
      }))
    };
  }

  function categoriesFromKeywordTableJson(jsonText) {
    let parsed;

    try {
      parsed = JSON.parse(jsonText);
    } catch (_error) {
      throw new Error("Invalid keyword table JSON");
    }

    const categoryPayload = Array.isArray(parsed) ? parsed : parsed?.categories;
    if (!Array.isArray(categoryPayload)) {
      throw new Error("Keyword table JSON must include a categories array");
    }

    assertUniqueCategoryNames(categoryPayload);
    return categoriesFromStorage(categoryPayload);
  }

  function keywordDataVersionFromStorage(value) {
    const version = Number(value);
    return Number.isFinite(version) && version > 0 ? version : 0;
  }

  function needsKeywordDataMigration(value) {
    return keywordDataVersionFromStorage(value) < CURRENT_KEYWORD_DATA_VERSION;
  }

  function restoreMissingDefaultCategories(categories) {
    const updated = categoriesFromStorage(categories);

    for (const defaultCategory of DEFAULT_CATEGORIES) {
      if (!updated.some((category) => category.id === defaultCategory.id)) {
        updated.push({ ...defaultCategory, keywords: [] });
      }
    }

    return sortCategoriesByDefaultOrder(categoriesFromStorage(updated));
  }

  function migrateCategoriesForVersion(categories, storedVersion) {
    if (!needsKeywordDataMigration(storedVersion)) return categoriesFromStorage(categories);

    let updated = restoreMissingDefaultCategories(categories);

    for (const [categoryId, keywords] of Object.entries(KEYWORD_DATA_MIGRATION_ADDITIONS)) {
      for (const keyword of keywords) {
        updated = addKeyword(updated, categoryId, keyword).categories;
      }
    }

    return updated;
  }

  /** Matching helpers used by the content script and side panel search. */
  function flattenKeywords(categories) {
    const seen = new Set();
    const flattened = [];

    for (const category of categories) {
      if (!categoryIsEnabled(category)) continue;

      for (const rawKeyword of category.keywords) {
        const keyword = sanitizeStoredKeyword(rawKeyword);
        const normalized = normalizeKeyword(keyword);

        if (!keyword || seen.has(normalized)) continue;
        seen.add(normalized);
        flattened.push({
          keyword,
          normalized,
          categoryId: category.id,
          categoryLabel: category.label,
          color: category.color
        });
      }
    }

    return flattened.sort((a, b) => b.keyword.length - a.keyword.length || a.keyword.localeCompare(b.keyword));
  }

  function buildKeywordRegex(categories) {
    const flattened = flattenKeywords(categories);
    if (flattened.length === 0) return { regex: null, keywords: [] };

    const source = flattened.map((item) => escapeRegex(item.keyword)).join("|");
    return {
      regex: new RegExp(`(^|${textTokenBoundary})(${source})(es|s)?(?=$|${textTokenBoundary})`, "giu"),
      keywords: flattened
    };
  }

  /** Mutators return normalized category arrays for UI/storage updates. */
  function addKeyword(categories, categoryId, rawKeyword) {
    const keyword = sanitizeStoredKeyword(rawKeyword);
    if (!keyword) return { categories, added: false, keyword: "" };

    const normalized = normalizeKeyword(keyword);
    const updated = categoriesFromStorage(categories);
    const exists = updated.some((category) => category.keywords.some((item) => normalizeKeyword(item) === normalized));
    if (exists) return { categories: updated, added: false, keyword };

    const target = updated.find((category) => category.id === categoryId) || updated[0];
    if (!target) return { categories: updated, added: false, keyword };
    target.keywords.push(keyword);
    target.keywords.sort((a, b) => a.localeCompare(b));

    return { categories: updated, added: true, keyword };
  }

  function addCategory(categories, rawName, rawColor) {
    const label = sanitizeCategoryName(rawName);
    const updated = categoriesFromStorage(categories);
    if (!label) return { categories: updated, added: false, category: null };

    const normalized = normalizeKeyword(label);
    const exists = updated.find((category) => normalizeKeyword(category.label) === normalized);
    if (exists) return { categories: updated, added: false, category: exists };

    const id = uniqueCategoryId(label, new Set(updated.map((category) => category.id)));
    const category = {
      id,
      label,
      color: sanitizeColor(rawColor, fallbackCategoryColors[updated.length % fallbackCategoryColors.length]),
      enabled: true,
      keywords: []
    };

    updated.push(category);
    return { categories: updated, added: true, category };
  }

  function removeCategory(categories, categoryId) {
    return categoriesFromStorage(categories).filter((category) => category.id !== categoryId);
  }

  function removeKeyword(categories, categoryId, rawKeyword) {
    const normalized = normalizeKeyword(rawKeyword);
    const updated = categoriesFromStorage(categories);
    const target = updated.find((category) => category.id === categoryId);
    if (!target) return updated;

    target.keywords = target.keywords.filter((keyword) => normalizeKeyword(keyword) !== normalized);
    return updated;
  }

  function moveKeyword(categories, fromCategoryId, toCategoryId, rawKeyword) {
    const keyword = sanitizeKeyword(rawKeyword);
    if (!keyword || fromCategoryId === toCategoryId) return cloneCategories(categories);

    const withoutKeyword = removeKeyword(categories, fromCategoryId, keyword);
    return addKeyword(withoutKeyword, toCategoryId, keyword).categories;
  }

  function reorderCategory(categories, draggedCategoryId, targetCategoryId) {
    const updated = categoriesFromStorage(categories);
    if (!draggedCategoryId || !targetCategoryId || draggedCategoryId === targetCategoryId) return updated;

    const fromIndex = updated.findIndex((category) => category.id === draggedCategoryId);
    const targetIndex = updated.findIndex((category) => category.id === targetCategoryId);
    if (fromIndex < 0 || targetIndex < 0) return updated;

    const [dragged] = updated.splice(fromIndex, 1);
    const nextTargetIndex = updated.findIndex((category) => category.id === targetCategoryId);
    updated.splice(nextTargetIndex < 0 ? targetIndex : nextTargetIndex, 0, dragged);
    return updated;
  }

  function keywordMatchesQuery(keyword, query) {
    const cleanedQuery = normalizeKeyword(query);
    if (!cleanedQuery) return true;

    const cleanedKeyword = normalizeKeyword(keyword);
    return cleanedKeyword.includes(cleanedQuery) || cleanedQuery.includes(cleanedKeyword);
  }

  function sortKeywordsByPageMatch(keywords, pageMatches) {
    return [...keywords].sort((a, b) => {
      const aFound = pageMatches.has(normalizeKeyword(a));
      const bFound = pageMatches.has(normalizeKeyword(b));
      if (aFound !== bFound) return aFound ? -1 : 1;
      return a.localeCompare(b);
    });
  }

  /** Public helper surface shared through the page global. */
  window.StackHighlighterShared = {
    STORAGE_KEYS,
    CURRENT_KEYWORD_DATA_VERSION,
    DEFAULT_CATEGORIES,
    addCategory,
    addKeyword,
    buildKeywordRegex,
    categoriesFromStorage,
    categoryIsEnabled,
    cloneCategories,
    canUsePluralSuffix,
    flattenKeywords,
    categoriesFromKeywordTableJson,
    keywordMatchesQuery,
    keywordTableFromCategories,
    isHighlightingEnabled,
    migrateCategoriesForVersion,
    moveKeyword,
    needsKeywordDataMigration,
    normalizeKeyword,
    normalizeKeywordList,
    reorderCategory,
    removeCategory,
    removeKeyword,
    sanitizeKeyword,
    sanitizeStoredKeyword,
    selectionKeyword,
    sortCategoriesByDefaultOrder,
    sortKeywordsByPageMatch,
    wordCount
  };
})();
