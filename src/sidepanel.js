(function () {
  /**
   * Side panel controller.
   *
   * This file owns the visible keyword-management UI, while the content script
   * owns page scanning/highlighting. The two communicate through Chrome tab
   * messages and share persistent state through chrome.storage.
   */

  /** Shared pure helpers loaded before this script in sidepanel.html. */
  const {
    CURRENT_KEYWORD_DATA_VERSION,
    STORAGE_KEYS,
    addCategory,
    addKeyword,
    categoriesFromKeywordTableJson,
    categoriesFromStorage,
    categoryIsEnabled,
    isHighlightingEnabled,
    keywordMatchesQuery,
    keywordTableFromCategories,
    migrateCategoriesForVersion,
    moveKeyword,
    needsKeywordDataMigration,
    normalizeKeyword,
    normalizeKeywordList,
    removeCategory,
    removeKeyword,
    sanitizeKeyword,
    selectionKeyword,
    sortKeywordsByPageMatch,
    wordCount
  } = window.StackHighlighterShared;

  /** Static DOM references for the panel controls and templates. */
  const categoryList = document.getElementById("categoryList");
  const categoryTemplate = document.getElementById("categoryTemplate");
  const chipTemplate = document.getElementById("chipTemplate");
  const searchInput = document.getElementById("searchInput");
  const clearSearchButton = document.getElementById("clearSearchButton");
  const selectionBar = document.getElementById("selectionBar");
  const selectionText = document.getElementById("selectionText");
  const enabledToggleButton = document.getElementById("enabledToggleButton");
  const disabledOverlay = document.getElementById("disabledOverlay");
  const disabledEnableButton = document.getElementById("disabledEnableButton");
  const refreshButton = document.getElementById("refreshButton");
  const matchSummary = document.getElementById("matchSummary");
  const viewJsonButton = document.getElementById("viewJsonButton");
  const exportJsonButton = document.getElementById("exportJsonButton");
  const importJsonButton = document.getElementById("importJsonButton");
  const importJsonFileInput = document.getElementById("importJsonFileInput");
  const jsonEditorPanel = document.getElementById("jsonEditorPanel");
  const jsonTextarea = document.getElementById("jsonTextarea");
  const jsonError = document.getElementById("jsonError");
  const jsonSaveButton = document.getElementById("jsonSaveButton");
  const jsonCloseButton = document.getElementById("jsonCloseButton");
  const addCategoryButton = document.getElementById("addCategoryButton");
  const addCategoryForm = document.getElementById("addCategoryForm");
  const categoryNameInput = document.getElementById("categoryNameInput");
  const categoryColorInput = document.getElementById("categoryColorInput");

  /** Mutable panel state mirrored from storage, current tab, and content script messages. */
  let categories = [];
  let selectedText = "";
  let highlightingEnabled = true;
  let pageMatchKeywords = new Set();
  let draggedKeyword = null;
  let collapsedCategoryIds = new Set();
  let collapsedStateInitialized = false;
  let targetTabId = null;
  let targetTabUrl = "";

  /** Startup and persistence: load storage, migrate saved data, save edits, and sync the active page. */
  async function loadState() {
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

    await refreshTargetTabFromActive();

    const local = await chrome.storage.local.get([STORAGE_KEYS.selectedText, STORAGE_KEYS.pageMatches]);
    selectedText = selectedTextFromStorage(local[STORAGE_KEYS.selectedText]);
    pageMatchKeywords = pageMatchesFromStorage(local[STORAGE_KEYS.pageMatches]);
    if (!highlightingEnabled) pageMatchKeywords = new Set();

    render();
    await refreshPageMatches();
  }

  async function saveCategories(nextCategories) {
    categories = nextCategories;
    await chrome.storage.sync.set({
      [STORAGE_KEYS.categories]: categories,
      [STORAGE_KEYS.keywordDataVersion]: CURRENT_KEYWORD_DATA_VERSION,
      [STORAGE_KEYS.enabled]: highlightingEnabled
    });
    await sendHighlightRefresh(categories);
    render();
    syncJsonEditor();
  }

  async function toggleHighlightingEnabled() {
    highlightingEnabled = !highlightingEnabled;
    await chrome.storage.sync.set({ [STORAGE_KEYS.enabled]: highlightingEnabled });
    if (!highlightingEnabled) await clearActiveTabHighlights();
    const response = await sendActiveTabMessage({
      type: "STACK_HIGHLIGHTER_SET_ENABLED",
      enabled: highlightingEnabled,
      categories
    }, { silent: true });

    if (response?.matches) {
      pageMatchKeywords = pageMatchesFromStorage(response.matches);
    } else if (!highlightingEnabled) {
      pageMatchKeywords = new Set();
    }

    render();
  }

  /** Small state helpers used by rendering and storage-event guards. */
  function currentQuery() {
    return sanitizeKeyword(searchInput.value);
  }

  function selectedKeywordCandidate() {
    return selectionKeyword(selectedText);
  }

  function visibleKeywords(category) {
    const query = currentQuery();
    const filtered = category.keywords.filter((keyword) => keywordMatchesQuery(keyword, query));
    return sortKeywordsByPageMatch(filtered, pageMatchKeywords);
  }

  function initializeCollapsedCategories() {
    if (collapsedStateInitialized) return;
    collapsedCategoryIds = new Set(categories.map((category) => category.id));
    collapsedStateInitialized = true;
  }

  function toggleCategory(categoryId) {
    if (collapsedCategoryIds.has(categoryId)) {
      collapsedCategoryIds.delete(categoryId);
    } else {
      collapsedCategoryIds.add(categoryId);
    }

    render();
  }

  function pageMatchesFromStorage(value) {
    if (!storageValueBelongsToTarget(value)) return new Set();
    return new Set(normalizeKeywordList(value?.keywords || []));
  }

  function selectedTextFromStorage(value) {
    if (typeof value === "string") return selectionKeyword(value);
    if (!storageValueBelongsToTarget(value)) return "";
    return selectionKeyword(value?.text || "");
  }

  function storageValueBelongsToTarget(value) {
    if (!value || typeof value !== "object") return true;
    if (!targetTabUrl || !value.url) return true;
    return value.url === targetTabUrl;
  }

  function keywordIsOnPage(keyword) {
    return pageMatchKeywords.has(normalizeKeyword(keyword));
  }

  /** Rendering: rebuild the panel from canonical state and attach fresh handlers. */
  function renderSelection() {
    if (!selectedText || wordCount(selectedText) > 5) {
      selectionBar.classList.add("hidden");
      return;
    }

    selectionText.textContent = selectedText;
    selectionBar.classList.remove("hidden");
  }

  function renderSummary(totalVisible, totalKeywords, totalPageMatches) {
    if (!highlightingEnabled) {
      matchSummary.textContent = `Highlighting disabled across ${totalKeywords} keywords`;
      return;
    }

    const query = currentQuery();
    if (query) {
      matchSummary.textContent = `${totalPageMatches} page hits in ${totalVisible} visible keywords`;
      return;
    }

    matchSummary.textContent = `${totalPageMatches} page hits across ${totalKeywords} keywords`;
  }

  function render() {
    categoryList.textContent = "";
    renderSelection();
    renderEnabledState();
    initializeCollapsedCategories();

    let totalVisible = 0;
    let totalKeywords = 0;
    let totalPageMatches = 0;
    const selectionCandidate = selectedKeywordCandidate();

    // Each category is rebuilt from the template so event handlers match state.
    for (const category of categories) {
      const node = categoryTemplate.content.firstElementChild.cloneNode(true);
      const chips = node.querySelector(".chips");
      const deleteCategoryButton = node.querySelector(".delete-category-button");
      const categoryEnabledButton = node.querySelector(".category-enabled-button");
      const moveUpButton = node.querySelector(".category-move-up-button");
      const moveDownButton = node.querySelector(".category-move-down-button");
      const selectedAddChip = node.querySelector(".selected-add-chip");
      const headerButton = node.querySelector(".category-toggle");
      const addForm = node.querySelector(".add-form");
      const addInput = addForm.querySelector("input");
      const title = node.querySelector("h2");
      const count = node.querySelector(".category-count");
      const categoryIndex = categories.findIndex((item) => item.id === category.id);
      const isCategoryEnabled = categoryIsEnabled(category);
      // Collapsed categories show only matching page hits; expanded shows all.
      const matchingKeywords = isCategoryEnabled ? visibleKeywords(category) : [];
      const pageMatchedKeywords = matchingKeywords.filter(keywordIsOnPage);
      const isCollapsed = !isCategoryEnabled || collapsedCategoryIds.has(category.id);
      const renderedKeywords = isCollapsed ? pageMatchedKeywords : matchingKeywords;
      const pageMatchCount = isCategoryEnabled ? category.keywords.filter(keywordIsOnPage).length : 0;

      totalVisible += renderedKeywords.length;
      totalKeywords += category.keywords.length;
      totalPageMatches += matchingKeywords.filter(keywordIsOnPage).length;

      node.dataset.categoryId = category.id;
      node.style.setProperty("--category-color", category.color);
      node.classList.toggle("collapsed", isCollapsed);
      node.classList.toggle("has-page-matches", pageMatchedKeywords.length > 0);
      node.classList.toggle("disabled-category", !isCategoryEnabled);
      title.textContent = category.label;
      count.textContent = `${pageMatchCount}/${category.keywords.length}`;
      headerButton.setAttribute("aria-expanded", String(!isCollapsed));
      headerButton.setAttribute("aria-label", `${isCollapsed ? "Expand" : "Collapse"} ${category.label}`);
      moveUpButton.disabled = categoryIndex <= 0;
      moveDownButton.disabled = categoryIndex < 0 || categoryIndex >= categories.length - 1;
      selectedAddChip.classList.toggle("hidden", !selectionCandidate);
      if (selectionCandidate) {
        const displayedCandidate = normalizeKeyword(selectionCandidate);
        selectedAddChip.title = `Add ${displayedCandidate} to ${category.label}`;
      } else {
        selectedAddChip.title = "Add selected keyword";
      }
      selectedAddChip.setAttribute("aria-label", selectedAddChip.title);
      categoryEnabledButton.classList.toggle("category-off", !isCategoryEnabled);
      categoryEnabledButton.title = isCategoryEnabled ? `Disable ${category.label}` : `Enable ${category.label}`;
      categoryEnabledButton.setAttribute("aria-label", categoryEnabledButton.title);

      // Header buttons manage category-level actions without changing chip layout.
      headerButton.addEventListener("click", () => {
        toggleCategory(category.id);
      });

      selectedAddChip.addEventListener("click", async (event) => {
        event.stopPropagation();
        await addSelectedKeywordToCategory(category.id);
      });

      moveUpButton.addEventListener("click", async (event) => {
        event.stopPropagation();
        await moveCategoryByStep(category.id, -1);
      });

      moveDownButton.addEventListener("click", async (event) => {
        event.stopPropagation();
        await moveCategoryByStep(category.id, 1);
      });

      categoryEnabledButton.addEventListener("click", async (event) => {
        event.stopPropagation();
        await toggleCategoryEnabled(category.id);
      });

      deleteCategoryButton.addEventListener("click", async (event) => {
        event.stopPropagation();
        if (!confirmCategoryDeletion(category)) return;
        await saveCategories(removeCategory(categories, category.id));
      });

      addForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const result = addKeyword(categories, category.id, addInput.value);
        addInput.value = "";
        addForm.classList.add("hidden");
        await saveCategories(result.categories);
      });

      // Category cards still accept dropped chips for quick keyword moves.
      node.addEventListener("dragover", (event) => {
        event.preventDefault();
        node.classList.add("drop-target");
      });

      node.addEventListener("dragleave", () => node.classList.remove("drop-target"));

      node.addEventListener("drop", async (event) => {
        event.preventDefault();
        node.classList.remove("drop-target");
        if (!draggedKeyword) return;
        const nextCategories = moveKeyword(categories, draggedKeyword.categoryId, category.id, draggedKeyword.keyword);
        draggedKeyword = null;
        await saveCategories(nextCategories);
      });

      if (renderedKeywords.length === 0 && !isCollapsed) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = currentQuery() ? "No matching keywords here." : "No keywords yet.";
        chips.append(empty);
      }

      for (const keyword of renderedKeywords) {
        chips.append(createChip(category, keyword, keywordIsOnPage(keyword)));
      }

      categoryList.append(node);
    }

    renderSummary(totalVisible, totalKeywords, totalPageMatches);
    syncJsonEditor();
  }

  /** Category and keyword actions that mutate saved keyword data. */
  async function moveCategoryByStep(categoryId, direction) {
    const index = categories.findIndex((category) => category.id === categoryId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= categories.length) return;

    const nextCategories = [...categories];
    const [category] = nextCategories.splice(index, 1);
    nextCategories.splice(targetIndex, 0, category);
    await saveCategories(nextCategories);
  }

  function renderEnabledState() {
    enabledToggleButton.classList.toggle("enabled-off", !highlightingEnabled);
    enabledToggleButton.title = highlightingEnabled ? "Disable highlights" : "Enable highlights";
    enabledToggleButton.setAttribute("aria-label", enabledToggleButton.title);
    document.querySelector(".app-shell")?.classList.toggle("disabled", !highlightingEnabled);
    disabledOverlay.classList.toggle("hidden", highlightingEnabled);
  }

  async function toggleCategoryEnabled(categoryId) {
    const nextCategories = categories.map((category) => {
      if (category.id !== categoryId) return category;
      return { ...category, enabled: !categoryIsEnabled(category) };
    });

    const target = nextCategories.find((category) => category.id === categoryId);
    if (target && !categoryIsEnabled(target)) {
      collapsedCategoryIds.add(categoryId);
    }

    await saveCategories(nextCategories);
  }

  async function addSelectedKeywordToCategory(categoryId) {
    const candidate = selectedKeywordCandidate();
    if (!candidate) return;

    const result = addKeyword(categories, categoryId, candidate);
    await saveCategories(result.categories);
    selectedText = "";
    await chrome.storage.local.set({
      [STORAGE_KEYS.selectedText]: { text: "", url: targetTabUrl, updatedAt: Date.now() }
    });
    render();
  }

  function confirmCategoryDeletion(category) {
    return window.confirm(
      `Delete category "${category.label}" and ${category.keywords.length} keywords?\n\nBack up your JSON first. This cannot be undone.`
    );
  }

  /** JSON import/export and editor actions. */
  function keywordJsonText() {
    return `${JSON.stringify(keywordTableFromCategories(categories), null, 2)}\n`;
  }

  function syncJsonEditor(force = false) {
    if (jsonEditorPanel.classList.contains("hidden")) return;
    if (!force && document.activeElement === jsonTextarea) return;
    jsonTextarea.value = keywordJsonText();
    jsonError.textContent = "";
  }

  function toggleJsonEditor() {
    const willOpen = jsonEditorPanel.classList.contains("hidden");
    jsonEditorPanel.classList.toggle("hidden", !willOpen);
    if (willOpen) {
      syncJsonEditor(true);
      jsonTextarea.focus();
    }
  }

  async function saveJsonEditor() {
    try {
      const nextCategories = categoriesFromKeywordTableJson(jsonTextarea.value);
      await saveCategories(nextCategories);
      jsonError.textContent = "";
      jsonEditorPanel.classList.add("hidden");
    } catch (error) {
      jsonError.textContent = error instanceof Error ? error.message : "Invalid JSON";
    }
  }

  function exportJsonKeywords() {
    const blob = new Blob([keywordJsonText()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `stack-highlighter-keywords-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importJsonKeywords(file) {
    if (!file) return;

    try {
      const text = await file.text();
      const nextCategories = categoriesFromKeywordTableJson(text);
      await saveCategories(nextCategories);
      matchSummary.textContent = `Imported ${nextCategories.length} keyword categories`;
      jsonError.textContent = "";
      if (!jsonEditorPanel.classList.contains("hidden")) syncJsonEditor(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON";
      matchSummary.textContent = `Import failed: ${message}`;
      jsonError.textContent = message;
    }
  }

  /** Chip creation includes delete, drag, and jump-to-highlight behavior. */
  function createChip(category, keyword, isOnPage) {
    const chip = chipTemplate.content.firstElementChild.cloneNode(true);
    chip.dataset.keyword = keyword;
    chip.dataset.categoryId = category.id;
    chip.style.setProperty("--chip-color", category.color);
    chip.classList.toggle("missing", !isOnPage);
    chip.querySelector(".chip-label").textContent = keyword;
    chip.title = `${isOnPage ? "Found on page" : "Not found on page"}. Drag to move. Click x to delete ${keyword}.`;

    chip.addEventListener("dragstart", () => {
      draggedKeyword = { categoryId: category.id, keyword };
      chip.classList.add("dragging");
    });

    chip.addEventListener("dragend", () => {
      draggedKeyword = null;
      chip.classList.remove("dragging");
    });

    chip.addEventListener("click", async (event) => {
      const removeIcon = event.target.closest(".chip-remove");
      if (removeIcon) {
        await saveCategories(removeKeyword(categories, category.id, keyword));
        return;
      }

      if (highlightingEnabled && isOnPage) {
        await jumpToKeyword(keyword);
      }
    });

    return chip;
  }

  /** Target-tab messaging, content-script injection, and live match refresh. */
  async function sendHighlightRefresh(nextCategories = categories) {
    const response = await sendActiveTabMessage({
      type: "STACK_HIGHLIGHTER_REFRESH",
      categories: nextCategories,
      enabled: highlightingEnabled
    }, { silent: true });

    if (response?.matches) {
      pageMatchKeywords = pageMatchesFromStorage(response.matches);
    }

    return response;
  }

  async function refreshPageMatches() {
    const response = await sendActiveTabMessage({
      type: "STACK_HIGHLIGHTER_GET_MATCHES",
      categories,
      enabled: highlightingEnabled
    }, { silent: true });
    if (response?.matches) {
      pageMatchKeywords = pageMatchesFromStorage(response.matches);
      render();
    }
  }

  async function jumpToKeyword(keyword) {
    const response = await sendActiveTabMessage({
      type: "STACK_HIGHLIGHTER_JUMP_TO_KEYWORD",
      keyword
    });

    if (response?.ok) {
      matchSummary.textContent = `${keyword} ${response.index}/${response.count}`;
      return;
    }

    await refreshPageMatches();
    matchSummary.textContent = response?.error || `No live highlight for ${keyword}`;
  }

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  async function refreshTargetTabFromActive() {
    const tab = await getActiveTab();
    if (tab?.id) {
      targetTabId = tab.id;
      targetTabUrl = tab.url || "";
    }
    return tab;
  }

  async function getTargetTab() {
    const activeTab = await getActiveTab();
    if (activeTab?.id && activeTab.id !== targetTabId) {
      targetTabId = activeTab.id;
      targetTabUrl = activeTab.url || "";
      pageMatchKeywords = new Set();
    } else if (activeTab?.id && activeTab.url && activeTab.url !== targetTabUrl) {
      targetTabUrl = activeTab.url;
    }

    if (!targetTabId) return activeTab;

    try {
      return await chrome.tabs.get(targetTabId);
    } catch (_error) {
      return refreshTargetTabFromActive();
    }
  }

  async function sendActiveTabMessage(message, options = {}) {
    const tab = await getTargetTab();
    if (!tab?.id) {
      if (!options.silent) matchSummary.textContent = "No active page";
      return null;
    }

    targetTabId = tab.id;
    targetTabUrl = tab.url || targetTabUrl;

    const ready = await ensureContentScript(tab.id, options);
    if (!ready) return null;

    try {
      return await chrome.tabs.sendMessage(tab.id, message);
    } catch (error) {
      if (!options.silent) {
        matchSummary.textContent = error instanceof Error ? error.message : "Could not reach this page";
      }
      return null;
    }
  }

  async function clearActiveTabHighlights() {
    const tab = await getTargetTab();
    if (!tab?.id) return;

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: removeStackHighlighterMarks
      });
      pageMatchKeywords = new Set();
    } catch (_error) {
      // The regular content-script message path still gets a chance to clear highlights.
    }
  }

  function removeStackHighlighterMarks() {
    const marks = document.querySelectorAll(".stack-highlighter-mark");
    for (const mark of marks) {
      const text = document.createTextNode(mark.textContent || "");
      mark.replaceWith(text);
      text.parentElement?.normalize();
    }
  }

  async function ensureContentScript(tabId, options = {}) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: "STACK_HIGHLIGHTER_PING" });
      return true;
    } catch (_error) {
      // Extension reloads can leave old highlight DOM behind while the old content-script
      // message channel is gone. Re-inject so chip clicks still work without a page refresh.
    }

    try {
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ["src/content.css"]
      });
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["src/shared.js", "src/contentScript.js"]
      });
      return true;
    } catch (error) {
      if (!options.silent) {
        matchSummary.textContent = error instanceof Error ? error.message : "Refresh this page to enable jumping";
      }
      return false;
    }
  }

  /** Panel control event bindings. */
  searchInput.addEventListener("input", () => {
    render();
  });

  clearSearchButton.addEventListener("click", () => {
    searchInput.value = "";
    render();
    searchInput.focus();
  });

  refreshButton.addEventListener("click", refreshPageMatches);
  enabledToggleButton.addEventListener("click", toggleHighlightingEnabled);
  disabledEnableButton.addEventListener("click", toggleHighlightingEnabled);
  viewJsonButton.addEventListener("click", toggleJsonEditor);
  exportJsonButton.addEventListener("click", exportJsonKeywords);
  importJsonButton.addEventListener("click", () => importJsonFileInput.click());
  importJsonFileInput.addEventListener("change", async () => {
    await importJsonKeywords(importJsonFileInput.files?.[0]);
    importJsonFileInput.value = "";
  });
  jsonSaveButton.addEventListener("click", saveJsonEditor);
  jsonCloseButton.addEventListener("click", () => {
    jsonEditorPanel.classList.add("hidden");
    jsonError.textContent = "";
  });
  addCategoryButton.addEventListener("click", () => {
    addCategoryForm.classList.toggle("hidden");
    if (!addCategoryForm.classList.contains("hidden")) categoryNameInput.focus();
  });
  addCategoryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = addCategory(categories, categoryNameInput.value, categoryColorInput.value);
    if (!result.added) {
      matchSummary.textContent = result.category ? `Category "${result.category.label}" already exists` : "Category name required";
      return;
    }

    categoryNameInput.value = "";
    addCategoryForm.classList.add("hidden");
    await saveCategories(result.categories);
  });

  /** Cross-context storage updates keep the side panel live. */
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" && changes[STORAGE_KEYS.categories]) {
      categories = categoriesFromStorage(changes[STORAGE_KEYS.categories].newValue);
      render();
    }

    if (areaName === "sync" && changes[STORAGE_KEYS.enabled]) {
      highlightingEnabled = isHighlightingEnabled(changes[STORAGE_KEYS.enabled].newValue);
      if (!highlightingEnabled) pageMatchKeywords = new Set();
      render();
    }

    if (areaName === "local" && changes[STORAGE_KEYS.selectedText]) {
      if (!storageValueBelongsToTarget(changes[STORAGE_KEYS.selectedText].newValue)) return;
      const nextSelected = selectedTextFromStorage(changes[STORAGE_KEYS.selectedText].newValue);
      selectedText = nextSelected;
      render();
    }

    if (areaName === "local" && changes[STORAGE_KEYS.pageMatches]) {
      if (!storageValueBelongsToTarget(changes[STORAGE_KEYS.pageMatches].newValue)) return;
      pageMatchKeywords = pageMatchesFromStorage(changes[STORAGE_KEYS.pageMatches].newValue);
      render();
    }
  });

  /** Follow the user's active tab so the panel does not jump across tabs. */
  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
      const tab = await chrome.tabs.get(tabId);
      targetTabId = tab.id || tabId;
      targetTabUrl = tab.url || "";
      pageMatchKeywords = new Set();
      selectedText = "";
      render();
      await refreshPageMatches();
    } catch (_error) {
      targetTabId = tabId;
      targetTabUrl = "";
    }
  });

  /** Refresh match state after the target page navigates or finishes loading. */
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tabId !== targetTabId) return;
    if (!changeInfo.url && changeInfo.status !== "complete") return;

    targetTabUrl = tab.url || changeInfo.url || targetTabUrl;
    pageMatchKeywords = new Set();
    render();
    refreshPageMatches().catch(() => {});
  });

  /** Bootstrap the side panel once all helper functions are defined. */
  loadState();
})();
