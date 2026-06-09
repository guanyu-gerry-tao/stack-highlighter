(function () {
  /**
   * Content script.
   *
   * Runs inside the job page. It loads keyword state, highlights matching text,
   * captures short page selections, and responds to side-panel commands.
   */
  if (window.__STACK_HIGHLIGHTER_CONTENT_SCRIPT_LOADED__) return;
  window.__STACK_HIGHLIGHTER_CONTENT_SCRIPT_LOADED__ = true;

  /** Shared helpers injected before this content script. */
  const {
    CURRENT_KEYWORD_DATA_VERSION,
    STORAGE_KEYS,
    buildKeywordRegex,
    canUsePluralSuffix,
    categoriesFromStorage,
    flattenKeywords,
    isHighlightingEnabled,
    migrateCategoriesForVersion,
    needsKeywordDataMigration,
    normalizeKeyword,
    normalizeKeywordList,
    selectionKeyword
  } = window.StackHighlighterShared;

  /** DOM scanning configuration: what we create and what we must never scan. */
  const HIGHLIGHT_CLASS = "stack-highlighter-mark";
  const SKIP_SELECTOR = [
    "script",
    "style",
    "textarea",
    "input",
    "select",
    "option",
    "code",
    "pre",
    "[contenteditable='true']",
    `.${HIGHLIGHT_CLASS}`
  ].join(",");
  const BLOCK_BOUNDARY_SELECTOR = [
    "address",
    "article",
    "aside",
    "blockquote",
    "dd",
    "div",
    "dl",
    "dt",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "hr",
    "li",
    "main",
    "nav",
    "ol",
    "p",
    "pre",
    "section",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "tr",
    "ul"
  ].join(",");

  /** Runtime page state owned by this content script instance. */
  let categories = [];
  let refreshTimer = 0;
  let selectionTimer = 0;
  let observer = null;
  let isRefreshing = false;
  let highlightingEnabled = true;
  let lastPageMatches = { url: location.href, updatedAt: 0, keywords: [] };
  let readyPromise = Promise.resolve();
  const jumpPositions = new Map();

  /** Startup loads saved settings after installing listeners. */
  function init() {
    installListeners();
    readyPromise = loadCategoriesAndRefresh();
  }

  async function loadCategoriesAndRefresh() {
    const stored = await chrome.storage.sync.get([
      STORAGE_KEYS.categories,
      STORAGE_KEYS.keywordDataVersion,
      STORAGE_KEYS.enabled
    ]);
    categories = categoriesFromStorage(stored[STORAGE_KEYS.categories]);
    highlightingEnabled = isHighlightingEnabled(stored[STORAGE_KEYS.enabled]);

    if (needsKeywordDataMigration(stored[STORAGE_KEYS.keywordDataVersion])) {
      categories = migrateCategoriesForVersion(categories, stored[STORAGE_KEYS.keywordDataVersion]);
      await chrome.storage.sync.set({
        [STORAGE_KEYS.categories]: categories,
        [STORAGE_KEYS.keywordDataVersion]: CURRENT_KEYWORD_DATA_VERSION
      });
    }

    refreshHighlights();
  }

  /**
   * Message, storage, selection, and mutation listeners.
   *
   * The side panel asks for refreshes/jumps through runtime messages. Storage
   * changes keep multiple extension contexts consistent. MutationObserver
   * handles dynamic job pages that load description text after navigation.
   */
  function installListeners() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "STACK_HIGHLIGHTER_PING") {
        sendResponse({ ok: true, url: location.href });
        return false;
      }

      if (message?.type === "STACK_HIGHLIGHTER_REFRESH") {
        respondWhenReady(sendResponse, () => {
          applyMessageState(message);
          const matches = refreshHighlights();
          return { ok: true, matches };
        });
        return true;
      }

      if (message?.type === "STACK_HIGHLIGHTER_GET_MATCHES") {
        respondWhenReady(sendResponse, () => {
          applyMessageState(message);
          const matches = refreshHighlights();
          return { ok: true, matches };
        });
        return true;
      }

      if (message?.type === "STACK_HIGHLIGHTER_JUMP_TO_KEYWORD") {
        respondWhenReady(sendResponse, () => jumpToKeyword(message.keyword));
        return true;
      }

      if (message?.type === "STACK_HIGHLIGHTER_SET_ENABLED") {
        respondWhenReady(sendResponse, () => {
          applyMessageState(message);
          const matches = refreshHighlights();
          return { ok: true, matches, enabled: highlightingEnabled };
        });
        return true;
      }
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync") return;

      if (changes[STORAGE_KEYS.categories]) {
        categories = categoriesFromStorage(changes[STORAGE_KEYS.categories].newValue);
        scheduleRefresh(30);
      }

      if (changes[STORAGE_KEYS.enabled]) {
        highlightingEnabled = isHighlightingEnabled(changes[STORAGE_KEYS.enabled].newValue);
        scheduleRefresh(0);
      }
    });

    document.addEventListener("mouseup", scheduleSelectionCapture, true);
    document.addEventListener("keyup", scheduleSelectionCapture, true);

    observer = new MutationObserver((mutations) => {
      if (!highlightingEnabled) return;
      if (isRefreshing) return;
      if (mutations.some(shouldRefreshForMutation)) {
        scheduleRefresh(450);
      }
    });

    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }
  }

  /** Message helpers keep async startup from racing with panel commands. */
  function applyMessageState(message) {
    if (Array.isArray(message?.categories)) {
      categories = categoriesFromStorage(message.categories);
    }

    if ("enabled" in (message || {})) {
      highlightingEnabled = isHighlightingEnabled(message.enabled);
    }
  }

  function respondWhenReady(sendResponse, callback) {
    readyPromise
      .then(() => sendResponse(callback()))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });
  }

  /** Refresh scheduling and mutation filtering. */
  function shouldRefreshForMutation(mutation) {
    const target = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
    if (!target || target.closest(SKIP_SELECTOR)) return false;

    for (const node of mutation.addedNodes || []) {
      if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim()) return true;
      if (node.nodeType === Node.ELEMENT_NODE && !node.closest(SKIP_SELECTOR)) return true;
    }

    return mutation.type === "characterData";
  }

  function scheduleRefresh(delay) {
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refreshHighlights, delay);
  }

  /**
   * Full highlight pass.
   *
   * Existing marks are removed first so repeated refreshes stay idempotent.
   * Disabled mode records an empty match set and leaves the page unmarked.
   */
  function refreshHighlights() {
    if (!document.body) return lastPageMatches;

    isRefreshing = true;
    removeHighlights();
    jumpPositions.clear();

    if (!highlightingEnabled) {
      lastPageMatches = {
        url: location.href,
        updatedAt: Date.now(),
        keywords: []
      };
      savePageMatches(lastPageMatches).catch(() => {});

      window.setTimeout(() => {
        isRefreshing = false;
      }, 0);

      return lastPageMatches;
    }

    const { regex } = buildKeywordRegex(categories);
    const metadataByKeyword = new Map(flattenKeywords(categories).map((item) => [item.normalized, item]));
    const foundKeywords = new Set();

    if (regex) {
      highlightTextNodes(regex, metadataByKeyword, foundKeywords);
    }

    lastPageMatches = {
      url: location.href,
      updatedAt: Date.now(),
      keywords: normalizeKeywordList([...foundKeywords])
    };

    savePageMatches(lastPageMatches).catch(() => {});

    window.setTimeout(() => {
      isRefreshing = false;
    }, 0);

    return lastPageMatches;
  }

  /** Highlight DOM mutation helpers. */
  async function savePageMatches(matches) {
    if (document.visibilityState !== "visible") return;

    await chrome.storage.local.set({
      [STORAGE_KEYS.pageMatches]: matches
    });
  }

  function removeHighlights() {
    const marks = document.querySelectorAll(`.${HIGHLIGHT_CLASS}`);
    for (const mark of marks) {
      const text = document.createTextNode(mark.textContent || "");
      mark.replaceWith(text);
      text.parentElement?.normalize();
    }
  }

  /**
   * Text-node scanning block.
   *
   * TreeWalker collects eligible text nodes before mutation, then each text
   * node is rewritten into plain text + mark elements when matches exist.
   */
  function highlightTextNodes(regex, metadataByKeyword, foundKeywords) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || parent.closest(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const nodes = [];
    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
    }

    for (let index = 0; index < nodes.length; index++) {
      highlightTextNode(nodes[index], regex, metadataByKeyword, foundKeywords);
    }
  }

  function highlightTextNode(node, regex, metadataByKeyword, foundKeywords) {
    const text = node.nodeValue;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let hasMatch = false;

    regex.lastIndex = 0;

    for (const match of text.matchAll(regex)) {
      const prefix = match[1] || "";
      const keywordText = match[2] || "";
      const pluralSuffix = match[3] || "";
      const start = match.index + prefix.length;
      const end = start + keywordText.length;
      const metadata = metadataByKeyword.get(normalizeKeyword(keywordText));

      if (!metadata || start < lastIndex) continue;
      if (!canUsePluralSuffix(keywordText, pluralSuffix)) continue;

      fragment.append(document.createTextNode(text.slice(lastIndex, start)));
      fragment.append(createHighlight(keywordText, metadata));
      foundKeywords.add(metadata.normalized);
      lastIndex = end;
      hasMatch = true;
    }

    if (!hasMatch) return;

    fragment.append(document.createTextNode(text.slice(lastIndex)));
    node.replaceWith(fragment);
  }

  /** Boundary and mark helpers. */
  function textNodesMayTouch(leftNode, rightNode) {
    if (!leftNode || !rightNode) return false;

    const leftBoundary = nearestBlockBoundary(leftNode);
    const rightBoundary = nearestBlockBoundary(rightNode);
    return Boolean(leftBoundary && rightBoundary && leftBoundary === rightBoundary);
  }

  function nearestBlockBoundary(node) {
    return node?.parentElement?.closest(BLOCK_BOUNDARY_SELECTOR) || null;
  }

  function createHighlight(text, metadata) {
    const mark = document.createElement("mark");
    mark.className = HIGHLIGHT_CLASS;
    mark.dataset.stackCategory = metadata.categoryId;
    mark.dataset.stackKeyword = metadata.keyword;
    mark.style.setProperty("--stack-highlight-color", metadata.color);
    mark.title = `${metadata.categoryLabel}: ${metadata.keyword}`;
    mark.textContent = text;
    return mark;
  }

  /**
   * Jump navigation block.
   *
   * Each keyword keeps its own cursor so repeated chip clicks cycle through
   * matching marks instead of bouncing between tabs or resetting to the top.
   */
  function jumpToKeyword(rawKeyword) {
    if (!highlightingEnabled) {
      return { ok: false, count: 0, index: 0, keyword: rawKeyword, error: "Highlighting disabled" };
    }

    const normalized = normalizeKeyword(rawKeyword);
    let marks = findKeywordMarks(normalized);

    document.querySelectorAll(".stack-highlighter-active").forEach((mark) => {
      mark.classList.remove("stack-highlighter-active");
    });

    if (marks.length === 0) {
      refreshHighlights();
      marks = findKeywordMarks(normalized);
    }

    if (marks.length === 0) {
      return { ok: false, count: 0, index: 0, keyword: rawKeyword };
    }

    const nextIndex = ((jumpPositions.get(normalized) ?? -1) + 1) % marks.length;
    const mark = marks[nextIndex];
    jumpPositions.set(normalized, nextIndex);
    mark.classList.add("stack-highlighter-active");
    mark.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });

    return { ok: true, count: marks.length, index: nextIndex + 1, keyword: rawKeyword };
  }

  function findKeywordMarks(normalizedKeyword) {
    return [...document.querySelectorAll(`.${HIGHLIGHT_CLASS}`)].filter((mark) => {
      return normalizeKeyword(mark.dataset.stackKeyword || mark.textContent || "") === normalizedKeyword;
    });
  }

  /** Page selection capture for the side panel add-keyword buttons. */
  function scheduleSelectionCapture() {
    clearTimeout(selectionTimer);
    selectionTimer = window.setTimeout(captureSelection, 80);
  }

  async function captureSelection() {
    if (document.visibilityState !== "visible") return;

    const selection = window.getSelection();
    const selected = selectionKeyword(selection?.toString() || "");

    await chrome.storage.local.set({
      [STORAGE_KEYS.selectedText]: {
        text: selected,
        url: location.href,
        updatedAt: Date.now()
      }
    });
  }

  init();
})();
