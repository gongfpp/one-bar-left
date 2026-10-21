/* Offline visual-novel player. Story content is supplied by story-data.js. */
(() => {
  "use strict";

  const SAVE_VERSION = 1;
  const SETTINGS_KEY = "one-bar-left:settings";
  const CONTINUE_KEY = "one-bar-left:continue";
  const SEEN_KEY = "one-bar-left:seen";
  const SLOT_PREFIX = "one-bar-left:slot:";
  const DEFAULT_SETTINGS = { textSpeed: 55, textSize: 19, autoDelay: 3, volume: 0 };
  const $ = (selector) => document.querySelector(selector);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const ui = {
    titleScreen: $("#title-screen"),
    playScreen: $("#play-screen"),
    startupMessage: $("#startup-message"),
    start: $("#start-button"),
    continue: $("#continue-button"),
    chapters: $("#chapters-button"),
    titleSettings: $("#settings-button"),
    menu: $("#menu-button"),
    history: $("#history-button"),
    save: $("#save-button"),
    gameSettings: $("#settings-game-button"),
    auto: $("#auto-button"),
    skip: $("#skip-button"),
    chapterLabel: $("#chapter-label"),
    sceneLabel: $("#scene-label"),
    progress: $("#story-progress"),
    stage: $("#scene-stage"),
    backgroundImage: $("#background-image"),
    location: $("#scene-location"),
    portraitFrame: $("#portrait-frame"),
    portraitImage: $("#portrait-image"),
    portraitFallback: $("#portrait-fallback"),
    sceneChapter: $("#scene-chapter"),
    sceneTitle: $("#scene-title"),
    text: $("#text-content"),
    announcement: $("#screen-reader-text"),
    choicePanel: $("#choice-panel"),
    choicePrompt: $("#choice-prompt"),
    choiceOptions: $("#choice-options"),
    status: $("#game-status"),
    speaker: $("#speaker-label"),
    advance: $("#advance-button"),
    modal: $("#modal"),
    modalTitle: $("#modal-title"),
    modalContent: $("#modal-content"),
    modalClose: $("#modal-close"),
    importFile: $("#import-file"),
  };

  let data = null;
  let scenesById = new Map();
  let chaptersById = new Map();
  let sceneOrder = new Map();
  let state = freshState();
  let settings = { ...DEFAULT_SETTINGS };
  let currentScene = null;
  let currentPages = [];
  let currentText = "";
  let isTyping = false;
  let typeTimer = null;
  let autoTimer = null;
  let skipTimer = null;
  let typeToken = 0;
  let audioContext = null;
  let modalReturnFocus = null;

  function freshState() {
    return {
      sceneId: null,
      pageIndex: 0,
      flags: {},
      history: [],
      seenPages: [],
      choices: [],
    };
  }

  function storageGet(key) {
    try { return window.localStorage.getItem(key); }
    catch (_) { return null; }
  }

  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (_) {
      return false;
    }
  }

  function readJson(key) {
    const raw = storageGet(key);
    if (!raw) return null;
    try { return JSON.parse(raw); }
    catch (_) { return null; }
  }

  function loadSeenPages() {
    const saved = readJson(SEEN_KEY);
    if (!Array.isArray(saved)) return [];
    return [...new Set(saved.filter((item) => typeof item === "string"))].slice(-1600);
  }

  function saveSeenPages() {
    storageSet(SEEN_KEY, JSON.stringify(state.seenPages.slice(-1600)));
  }

  function saveSnapshot() {
    return {
      saveVersion: SAVE_VERSION,
      gameVersion: data.version || "1",
      savedAt: new Date().toISOString(),
      sceneId: state.sceneId,
      pageIndex: state.pageIndex,
      flags: { ...state.flags },
      history: state.history.slice(-1200),
      seenPages: state.seenPages.slice(-1600),
      choices: state.choices.slice(-100),
    };
  }

  function validSnapshot(snapshot) {
    return Boolean(
      snapshot && snapshot.saveVersion === SAVE_VERSION &&
      snapshot.gameVersion === (data.version || "1") &&
      typeof snapshot.sceneId === "string" && scenesById.has(snapshot.sceneId) &&
      Number.isInteger(snapshot.pageIndex) && snapshot.pageIndex >= 0 &&
      snapshot.flags && typeof snapshot.flags === "object" &&
      Array.isArray(snapshot.history) && Array.isArray(snapshot.seenPages)
    );
  }

  function saveContinue() {
    if (!state.sceneId || !data) return;
    storageSet(CONTINUE_KEY, JSON.stringify(saveSnapshot()));
    updateContinueButton();
  }

  function updateContinueButton() {
    const snapshot = readJson(CONTINUE_KEY);
    ui.continue.hidden = !validSnapshot(snapshot);
  }

  function setStatus(message, isError = false) {
    if (!ui.status) return;
    ui.status.textContent = message;
    ui.status.classList.toggle("status-error", isError);
  }

  function setStartupMessage(message, isError = false) {
    ui.startupMessage.textContent = message;
    ui.startupMessage.classList.toggle("status-error", isError);
  }

  function applySettings() {
    document.documentElement.style.setProperty("--text-size", `${settings.textSize}px`);
    storageSet(SETTINGS_KEY, JSON.stringify(settings));
  }

  function loadSettings() {
    const saved = readJson(SETTINGS_KEY);
    if (saved && typeof saved === "object") {
      settings = {
        textSpeed: clampNumber(saved.textSpeed, 10, 120, DEFAULT_SETTINGS.textSpeed),
        textSize: clampNumber(saved.textSize, 16, 28, DEFAULT_SETTINGS.textSize),
        autoDelay: clampNumber(saved.autoDelay, 1, 8, DEFAULT_SETTINGS.autoDelay),
        volume: clampNumber(saved.volume, 0, 1, DEFAULT_SETTINGS.volume),
      };
    }
    applySettings();
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  }

  function playUiTick() {
    if (settings.volume <= 0) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      audioContext ||= new AudioContextClass();
      if (audioContext.state === "suspended") audioContext.resume();
      const now = audioContext.currentTime;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(640, now);
      oscillator.frequency.exponentialRampToValueAtTime(460, now + 0.045);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, settings.volume * 0.018), now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.07);
    } catch (_) { /* Audio is optional; reading always works without it. */ }
  }

  function scenePageKey(sceneId, index, text = "") {
    let hash = 2166136261;
    for (const character of text) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return `${sceneId}:${index}:${(hash >>> 0).toString(36)}`;
  }

  function currentPageWasSeen() {
    if (!currentScene || state.pageIndex >= currentPages.length) return false;
    return state.seenPages.includes(scenePageKey(currentScene.id, state.pageIndex, currentPages[state.pageIndex]));
  }

  function buildPages(scene) {
    const before = [];
    const after = [];
    for (const variant of scene.variants || []) {
      if (state.flags[variant.flag] !== variant.value) continue;
      const pages = Array.isArray(variant.pages) ? variant.pages : [];
      (variant.position === "before" ? before : after).push(...pages);
    }
    return [...before, ...(Array.isArray(scene.pages) ? scene.pages : []), ...after]
      .filter((page) => typeof page === "string" && page.trim().length > 0);
  }

  function updateProgress() {
    const sceneIndex = sceneOrder.get(state.sceneId) ?? 0;
    const total = Math.max(1, data.scenes.length);
    const chapter = chaptersById.get(currentScene.chapterId);
    const chapterSceneIds = chapter ? chapter.sceneIds : [];
    const withinChapter = Math.max(0, chapterSceneIds.indexOf(currentScene.id)) + 1;
    ui.chapterLabel.textContent = chapter ? chapter.title : `第${currentScene.chapterNumber || "—"}章`;
    ui.sceneLabel.textContent = `场景 ${withinChapter} / ${Math.max(1, chapterSceneIds.length)}`;
    ui.progress.max = total;
    ui.progress.value = Math.min(total, sceneIndex + 1);
  }

  function setBackground(scene) {
    const key = typeof scene.background === "string" ? scene.background : "station";
    ui.stage.dataset.background = key;
    ui.backgroundImage.hidden = true;
    ui.backgroundImage.onload = () => { ui.backgroundImage.hidden = false; };
    ui.backgroundImage.onerror = () => { ui.backgroundImage.hidden = true; };
    ui.backgroundImage.src = `images/backgrounds/${key}.svg`;
  }

  function setPortrait(scene) {
    const key = typeof scene.portrait === "string" ? scene.portrait : "";
    if (!key) {
      ui.portraitFrame.hidden = true;
      ui.portraitImage.onload = null;
      ui.portraitImage.onerror = null;
      ui.portraitImage.removeAttribute("src");
      return;
    }
    ui.portraitFrame.hidden = false;
    const labels = { xiang: "翔", song: "宋", ma: "马", lu: "鲁", luojie: "骆", fulan: "福" };
    ui.portraitFallback.textContent = scene.portraitLabel || labels[key] || "";
    ui.portraitFallback.hidden = false;
    ui.portraitImage.hidden = true;
    ui.portraitImage.onload = () => {
      ui.portraitImage.hidden = false;
      ui.portraitFallback.hidden = true;
    };
    ui.portraitImage.onerror = () => {
      ui.portraitImage.hidden = true;
      ui.portraitFallback.hidden = false;
    };
    ui.portraitImage.src = `images/portraits/${key}.svg`;
  }

  function cancelTimers() {
    if (typeTimer) window.clearTimeout(typeTimer);
    if (autoTimer) window.clearTimeout(autoTimer);
    if (skipTimer) window.clearTimeout(skipTimer);
    typeTimer = autoTimer = skipTimer = null;
    typeToken += 1;
  }

  function enterScene(sceneId, restore = false) {
    cancelTimers();
    const scene = scenesById.get(sceneId);
    if (!scene) {
      setStatus("剧情数据中找不到这个场景。", true);
      return;
    }
    currentScene = scene;
    state.sceneId = scene.id;
    if (!restore) state.pageIndex = 0;
    currentPages = buildPages(scene);
    setBackground(scene);
    ui.location.textContent = scene.location || "";
    ui.sceneChapter.textContent = chaptersById.get(scene.chapterId)?.title || "还有一格电";
    ui.sceneTitle.textContent = scene.title || "";
    ui.speaker.textContent = scene.speaker || "旁白";
    ui.text.replaceChildren();
    ui.announcement.textContent = "";
    ui.choicePanel.hidden = true;
    ui.choiceOptions.replaceChildren();
    ui.advance.disabled = false;
    ui.advance.textContent = "继续";
    setStatus("");
    setPortrait(scene);
    updateProgress();
    if (state.pageIndex < currentPages.length) renderPage(restore);
    else showSceneEnd();
    ui.titleScreen.hidden = true;
    ui.playScreen.hidden = false;
    saveContinue();
  }

  function renderPage(showFully = false) {
    cancelTimers();
    if (state.pageIndex >= currentPages.length) {
      showSceneEnd();
      return;
    }
    const text = currentPages[state.pageIndex];
    currentText = text;
    ui.announcement.textContent = text;
    const paragraph = el("p", "", "");
    ui.text.replaceChildren(paragraph);
    ui.choicePanel.hidden = true;
    ui.advance.disabled = false;
    ui.advance.textContent = "继续";
    const token = typeToken;

    if (showFully || settings.textSpeed >= 120) {
      paragraph.textContent = text;
      isTyping = false;
      scheduleAuto();
      runFastForwardIfNeeded();
      return;
    }

    isTyping = true;
    const characters = Array.from(text);
    let cursor = 0;
    const step = Math.max(1, Math.round(settings.textSpeed / 20));
    const tick = () => {
      if (token !== typeToken) return;
      cursor = Math.min(characters.length, cursor + step);
      paragraph.textContent = characters.slice(0, cursor).join("");
      if (cursor >= characters.length) {
        isTyping = false;
        typeTimer = null;
        scheduleAuto();
        runFastForwardIfNeeded();
      } else {
        typeTimer = window.setTimeout(tick, 50);
      }
    };
    typeTimer = window.setTimeout(tick, 50);
  }

  function finishTyping() {
    if (!isTyping) return false;
    cancelTimers();
    isTyping = false;
    const paragraph = ui.text.querySelector("p");
    if (paragraph) paragraph.textContent = currentText;
    scheduleAuto();
    return true;
  }

  function scheduleAuto() {
    if (autoTimer) window.clearTimeout(autoTimer);
    autoTimer = null;
    if (!state.auto || ui.modal.open || isTyping || !currentScene || currentScene.choice && state.pageIndex >= currentPages.length) return;
    autoTimer = window.setTimeout(() => {
      autoTimer = null;
      advance();
    }, settings.autoDelay * 1000);
  }

  function markPageSeen() {
    const key = scenePageKey(currentScene.id, state.pageIndex, currentText);
    if (!state.seenPages.includes(key)) state.seenPages.push(key);
    saveSeenPages();
    state.history.push({
      type: "story",
      chapterId: currentScene.chapterId,
      sceneTitle: currentScene.title || "",
      text: currentText,
    });
    if (state.history.length > 1200) state.history.shift();
  }

  function advance() {
    if (!currentScene) return;
    if (isTyping) {
      finishTyping();
      if (state.skip) runFastForwardIfNeeded();
      return;
    }
    if (state.pageIndex < currentPages.length) {
      markPageSeen();
      setStatus("");
      state.pageIndex += 1;
      saveContinue();
      if (state.pageIndex < currentPages.length) renderPage(false);
      else showSceneEnd();
      return;
    }
    if (currentScene.choice) return;
    const next = currentScene.next || currentScene.nextSceneId;
    if (next) enterScene(next);
    else showEnding();
  }

  function showSceneEnd() {
    isTyping = false;
    ui.choicePanel.hidden = true;
    ui.choiceOptions.replaceChildren();
    if (currentScene.choice) {
      ui.choicePanel.hidden = false;
      ui.choicePrompt.textContent = currentScene.choice.prompt || "你会怎么做？";
      const options = currentScene.choice.options || [];
      options.forEach((option) => {
        const button = el("button", "button choice-option", option.label || "继续");
        button.type = "button";
        button.addEventListener("click", () => chooseOption(option));
        ui.choiceOptions.append(button);
      });
      ui.advance.disabled = true;
      ui.advance.textContent = "请选择";
      setStatus("选择会改变记录卡中的关注点，不改变小说既定结局。");
      ui.choiceOptions.querySelector("button")?.focus();
      if (state.skip) runFastForwardIfNeeded();
      return;
    }
    ui.advance.disabled = false;
    ui.advance.textContent = currentScene.next || currentScene.nextSceneId ? "进入下一场景" : "读完了";
    if (state.auto) scheduleAuto();
    if (state.skip) runFastForwardIfNeeded();
  }

  function chooseOption(option) {
    const choice = currentScene.choice;
    if (choice.flag) state.flags[choice.flag] = option.value;
    state.choices.push({
      chapterId: currentScene.chapterId,
      sceneTitle: currentScene.title || "",
      label: option.label || "",
      value: option.value,
      note: option.note || "",
    });
    state.history.push({
      type: "choice",
      chapterId: currentScene.chapterId,
      sceneTitle: currentScene.title || "",
      text: `选择：${option.label || "继续"}`,
    });
    const next = currentScene.next || currentScene.nextSceneId;
    saveContinue();
    playUiTick();
    if (next) {
      enterScene(next);
      if (option.note) setStatus(option.note.startsWith("记录卡：") ? option.note : `记录卡：${option.note}`);
    } else showEnding();
  }

  function runFastForwardIfNeeded() {
    if (!state.skip || ui.modal.open || !currentScene) return;
    if (state.pageIndex < currentPages.length) {
      if (!currentPageWasSeen()) {
        state.skip = false;
        updateToggleButtons();
        setStatus("遇到未读内容，已暂停快进。", true);
        return;
      }
      if (isTyping) finishTyping();
      skipTimer = window.setTimeout(() => {
        skipTimer = null;
        advance();
      }, 80);
      return;
    }
    if (currentScene.choice) {
      state.skip = false;
      updateToggleButtons();
      setStatus("已到选择点，快进暂停。", true);
      return;
    }
    skipTimer = window.setTimeout(() => {
      skipTimer = null;
      advance();
    }, 80);
  }

  function toggleAuto() {
    state.auto = !state.auto;
    if (state.auto) {
      state.skip = false;
      if (skipTimer) { window.clearTimeout(skipTimer); skipTimer = null; }
    }
    updateToggleButtons();
    playUiTick();
    if (state.auto && !isTyping) scheduleAuto();
    else if (!state.auto && autoTimer) { window.clearTimeout(autoTimer); autoTimer = null; }
  }

  function toggleSkip() {
    state.skip = !state.skip;
    if (state.skip) {
      state.auto = false;
      if (autoTimer) { window.clearTimeout(autoTimer); autoTimer = null; }
    } else if (skipTimer) {
      window.clearTimeout(skipTimer);
      skipTimer = null;
    }
    updateToggleButtons();
    playUiTick();
    if (state.skip) runFastForwardIfNeeded();
  }

  function updateToggleButtons() {
    ui.auto.setAttribute("aria-pressed", String(Boolean(state.auto)));
    ui.auto.textContent = `自动：${state.auto ? "开" : "关"}`;
    ui.skip.setAttribute("aria-pressed", String(Boolean(state.skip)));
    ui.skip.textContent = `已读快进：${state.skip ? "开" : "关"}`;
  }

  function showTitle() {
    cancelTimers();
    ui.playScreen.hidden = true;
    ui.titleScreen.hidden = false;
    state.auto = false;
    state.skip = false;
    updateToggleButtons();
    updateContinueButton();
    ui.start.focus();
  }

  function startNewGame(firstSceneId) {
    const first = firstSceneId || data.chapters[0]?.firstSceneId || data.chapters[0]?.firstScene;
    if (!first || !scenesById.has(first)) {
      setStartupMessage("剧情入口配置不完整。", true);
      return;
    }
    state = freshState();
    state.seenPages = loadSeenPages();
    state.sceneId = first;
    state.auto = false;
    state.skip = false;
    updateToggleButtons();
    playUiTick();
    enterScene(first);
  }

  function restoreSnapshot(snapshot) {
    if (!validSnapshot(snapshot)) {
      setStatus("存档无法读取：版本不兼容或场景不存在。", true);
      return false;
    }
    state = {
      sceneId: snapshot.sceneId,
      pageIndex: snapshot.pageIndex,
      flags: { ...snapshot.flags },
      history: snapshot.history.slice(-1200),
      seenPages: [...new Set([...loadSeenPages(), ...snapshot.seenPages.filter((item) => typeof item === "string")])].slice(-1600),
      choices: Array.isArray(snapshot.choices) ? snapshot.choices.slice(-100) : [],
      auto: false,
      skip: false,
    };
    updateToggleButtons();
    enterScene(state.sceneId, true);
    return true;
  }

  function openModal(title, fill) {
    const alreadyOpen = ui.modal.open;
    if (!alreadyOpen) {
      if (isTyping) finishTyping();
      if (autoTimer) { window.clearTimeout(autoTimer); autoTimer = null; }
      if (skipTimer) { window.clearTimeout(skipTimer); skipTimer = null; }
      modalReturnFocus = document.activeElement;
    }
    ui.modalTitle.textContent = title;
    ui.modalContent.replaceChildren();
    fill(ui.modalContent);
    if (!alreadyOpen) ui.modal.showModal();
    ui.modalClose.focus();
  }

  function closeModal() {
    if (ui.modal.open) ui.modal.close();
    if (modalReturnFocus && typeof modalReturnFocus.focus === "function") modalReturnFocus.focus();
  }

  function menuActionButton(container, label, action, primary = false) {
    const button = el("button", `button${primary ? " button-primary" : ""}`, label);
    button.type = "button";
    button.addEventListener("click", action);
    container.append(button);
    return button;
  }

  function openMenu() {
    openModal("菜单", (container) => {
      const text = el("p", "", "进度会在阅读过程中自动保存在“继续”位置；仍建议使用手动存档。");
      container.append(text);
      const actions = el("div", "modal-actions");
      menuActionButton(actions, "存读档", () => openSaveMenu());
      menuActionButton(actions, "章节选择", () => openChapterMenu());
      menuActionButton(actions, "记录卡", () => openJournal());
      menuActionButton(actions, "历史记录", () => openHistory());
      menuActionButton(actions, "设置", () => openSettings());
      menuActionButton(actions, "回到标题", () => { saveContinue(); closeModal(); showTitle(); });
      menuActionButton(actions, "关闭菜单", closeModal, true);
      container.append(actions);
    });
  }

  function openSaveMenu() {
    openModal("存读档", (container) => {
      const explanation = el("p", "", "三个手动存档位保存在本机浏览器。也可导出 JSON，在关闭或更换浏览器后导入。");
      container.append(explanation);
      const list = el("div", "modal-list");
      for (let slot = 1; slot <= 3; slot += 1) {
        const snapshot = readJson(`${SLOT_PREFIX}${slot}`);
        const row = el("div", "modal-row");
        const info = el("div", "");
        const title = el("strong", "", `存档位 ${slot}`);
        const details = el("p", "", snapshot && validSnapshot(snapshot)
          ? describeSnapshot(snapshot)
          : "空存档");
        info.append(title, details);
        const buttons = el("div", "modal-actions");
        menuActionButton(buttons, "保存", () => {
          const ok = storageSet(`${SLOT_PREFIX}${slot}`, JSON.stringify(saveSnapshot()));
          setStatus(ok ? `已保存到存档位 ${slot}。` : "浏览器禁止本地存储；请使用导出存档。", !ok);
          openSaveMenu();
        }, true).disabled = !state.sceneId;
        menuActionButton(buttons, "读取", () => {
          const save = readJson(`${SLOT_PREFIX}${slot}`);
          if (!restoreSnapshot(save)) return;
          closeModal();
        }).disabled = !validSnapshot(snapshot);
        row.append(info, buttons);
        list.append(row);
      }
      container.append(list);
      const actions = el("div", "modal-actions");
      menuActionButton(actions, "导出当前存档", exportSave).disabled = !state.sceneId;
      menuActionButton(actions, "导入存档", () => ui.importFile.click());
      menuActionButton(actions, "返回", closeModal, true);
      container.append(actions);
    });
  }

  function describeSnapshot(snapshot) {
    const scene = scenesById.get(snapshot.sceneId);
    const chapter = scene ? chaptersById.get(scene.chapterId) : null;
    const date = snapshot.savedAt ? new Date(snapshot.savedAt) : null;
    const dateText = date && !Number.isNaN(date.getTime()) ? date.toLocaleString("zh-CN") : "时间未知";
    return `${chapter?.title || "未知章节"} · ${scene?.title || "未知场景"} · ${dateText}`;
  }

  function exportSave() {
    if (!state.sceneId) return;
    const blob = new Blob([JSON.stringify(saveSnapshot(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = el("a", "");
    link.href = url;
    link.download = "还有一格电-存档.json";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("存档 JSON 已导出。");
  }

  function importSaveFile(file) {
    if (!file) return;
    file.text().then((text) => {
      const snapshot = JSON.parse(text);
      if (!validSnapshot(snapshot)) throw new Error("存档格式不兼容");
      if (restoreSnapshot(snapshot)) {
        saveContinue();
        closeModal();
        setStatus("存档已导入。");
      }
    }).catch((error) => {
      setStatus(`导入失败：${error.message || "文件无法读取"}`, true);
    }).finally(() => { ui.importFile.value = ""; });
  }

  function openChapterMenu() {
    openModal("章节选择", (container) => {
      const note = el("p", "", "从选定章节重新阅读会开启一段新进度，不会改写主线结局。");
      container.append(note);
      const grid = el("div", "chapter-grid");
      data.chapters.forEach((chapter) => {
        const button = el("button", "button", chapter.title);
        button.type = "button";
        button.addEventListener("click", () => {
          closeModal();
          startNewGame(chapter.firstSceneId || chapter.firstScene);
        });
        grid.append(button);
      });
      container.append(grid);
      const actions = el("div", "modal-actions");
      menuActionButton(actions, "返回", closeModal, true);
      container.append(actions);
    });
  }

  function openJournal() {
    openModal("翔子的记录卡", (container) => {
      container.append(el("p", "", "记录你在关键时刻选择先核对的事项；它不改变既定账目或结局。"));
      if (!state.choices.length) {
        container.append(el("p", "", "暂时还没有选择记录。"));
      } else {
        const list = el("div", "history-list");
        state.choices.forEach((entry, index) => {
          const item = el("div", "history-entry");
          const chapter = chaptersById.get(entry.chapterId);
          item.append(el("strong", "", `${index + 1}. ${chapter?.title || "记录"} · ${entry.sceneTitle || ""}`));
          item.append(el("p", "", entry.note || entry.label || "已记录"));
          list.append(item);
        });
        container.append(list);
      }
      const actions = el("div", "modal-actions");
      menuActionButton(actions, "返回", closeModal, true);
      container.append(actions);
    });
  }

  function openHistory() {
    openModal("历史记录", (container) => {
      const entries = state.history.slice(-180).reverse();
      if (!entries.length) {
        container.append(el("p", "", "还没有已读内容。"));
      } else {
        const list = el("div", "history-list");
        entries.forEach((entry) => {
          const wrapper = el("div", "history-entry");
          const chapter = chaptersById.get(entry.chapterId);
          wrapper.append(el("strong", "", `${chapter?.title || "阅读记录"} · ${entry.sceneTitle || ""}`));
          wrapper.append(el("p", "", entry.text || ""));
          list.append(wrapper);
        });
        container.append(list);
      }
      const actions = el("div", "modal-actions");
      menuActionButton(actions, "返回", closeModal, true);
      container.append(actions);
    });
  }

  function settingControl(container, key, label, min, max, step, unit) {
    const row = el("div", "setting-row");
    const id = `setting-${key}`;
    const labelNode = el("label", "", label);
    labelNode.htmlFor = id;
    const input = document.createElement("input");
    input.id = id;
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(settings[key]);
    const value = el("span", "setting-value", `${settings[key]}${unit}`);
    input.addEventListener("input", () => {
      settings[key] = Number(input.value);
      value.textContent = `${settings[key]}${unit}`;
      applySettings();
    });
    row.append(labelNode, input, value);
    container.append(row);
  }

  function openSettings() {
    openModal("设置", (container) => {
      const note = el("p", "", "文字与界面偏好保存在本机。音量只控制无语音的按钮提示音；设为0即静音。");
      container.append(note);
      settingControl(container, "textSpeed", "文字速度", 10, 120, 5, " 字/秒");
      settingControl(container, "textSize", "正文字号", 16, 28, 1, " px");
      settingControl(container, "autoDelay", "自动间隔", 1, 8, 1, " 秒");
      const volumeRow = el("div", "setting-row");
      const volumeLabel = el("label", "", "提示音音量");
      volumeLabel.htmlFor = "setting-volume";
      const volume = document.createElement("input");
      volume.id = "setting-volume";
      volume.type = "range";
      volume.min = "0";
      volume.max = "1";
      volume.step = "0.05";
      volume.value = String(settings.volume);
      const volumeValue = el("span", "setting-value", `${Math.round(settings.volume * 100)}%`);
      volume.addEventListener("input", () => {
        settings.volume = Number(volume.value);
        volumeValue.textContent = `${Math.round(settings.volume * 100)}%`;
        applySettings();
        playUiTick();
      });
      volumeRow.append(volumeLabel, volume, volumeValue);
      container.append(volumeRow);
      const actions = el("div", "modal-actions");
      menuActionButton(actions, "完成", closeModal, true);
      container.append(actions);
    });
  }

  function openEnding() {
    openModal("这一段故事读完了", (container) => {
      container.append(el("p", "", "主线到此结束。可以回到标题，或从章节目录重读；选择不会改变既定结局。"));
      const actions = el("div", "modal-actions");
      menuActionButton(actions, "回到标题", () => { closeModal(); showTitle(); }, true);
      menuActionButton(actions, "重读第十八章", () => {
        closeModal();
        const last = data.chapters[data.chapters.length - 1];
        startNewGame(last.firstSceneId || last.firstScene);
      });
      container.append(actions);
    });
  }

  function showEnding() {
    saveContinue();
    state.auto = false;
    state.skip = false;
    updateToggleButtons();
    openEnding();
  }

  function bindEvents() {
    ui.start.addEventListener("click", () => startNewGame());
    ui.continue.addEventListener("click", () => {
      const snapshot = readJson(CONTINUE_KEY);
      if (!restoreSnapshot(snapshot)) setStartupMessage("没有可继续的有效进度。", true);
    });
    ui.chapters.addEventListener("click", openChapterMenu);
    ui.titleSettings.addEventListener("click", openSettings);
    ui.menu.addEventListener("click", openMenu);
    ui.history.addEventListener("click", openHistory);
    ui.save.addEventListener("click", openSaveMenu);
    ui.gameSettings.addEventListener("click", openSettings);
    ui.auto.addEventListener("click", toggleAuto);
    ui.skip.addEventListener("click", toggleSkip);
    ui.advance.addEventListener("click", () => { playUiTick(); advance(); });
    ui.modalClose.addEventListener("click", closeModal);
    ui.modal.addEventListener("click", (event) => {
      if (event.target === ui.modal) closeModal();
    });
    ui.importFile.addEventListener("change", () => importSaveFile(ui.importFile.files?.[0]));
    ui.modal.addEventListener("close", () => {
      if (modalReturnFocus && typeof modalReturnFocus.focus === "function") modalReturnFocus.focus();
      if (!ui.playScreen.hidden) {
        if (state.skip) runFastForwardIfNeeded();
        else if (state.auto) scheduleAuto();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (ui.modal.open) return;
      const target = event.target;
      const editing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
      if (editing) return;
      if (event.key === "Escape") { event.preventDefault(); state.sceneId ? openMenu() : null; return; }
      if (event.key.toLowerCase() === "h") { event.preventDefault(); if (state.sceneId) openHistory(); return; }
      if ((event.key === "Enter" || event.key === " ") && !target.closest("button")) {
        event.preventDefault();
        advance();
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const options = [...ui.choiceOptions.querySelectorAll("button")];
        if (!options.length) return;
        event.preventDefault();
        const current = options.indexOf(document.activeElement);
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex = current < 0
          ? (delta > 0 ? 0 : options.length - 1)
          : (current + delta + options.length) % options.length;
        options[nextIndex].focus();
      }
    });
    window.addEventListener("pagehide", saveContinue);
  }

  function initialize() {
    data = window.GAME_DATA;
    if (!data || !Array.isArray(data.chapters) || !Array.isArray(data.scenes) || !data.scenes.length) {
      setStartupMessage("剧情数据尚未生成。请运行游戏构建脚本后打开发行目录中的 index.html。", true);
      ui.start.disabled = true;
      ui.chapters.disabled = true;
      return;
    }
    scenesById = new Map(data.scenes.map((scene) => [scene.id, scene]));
    data.chapters.forEach((chapter) => chaptersById.set(chapter.id, chapter));
    data.scenes.forEach((scene, index) => sceneOrder.set(scene.id, index));
    loadSettings();
    state.seenPages = loadSeenPages();
    bindEvents();
    ui.start.disabled = false;
    ui.chapters.disabled = false;
    const storageAvailable = storageSet(`${SETTINGS_KEY}:probe`, "ok");
    if (storageAvailable) {
      try { window.localStorage.removeItem(`${SETTINGS_KEY}:probe`); } catch (_) { /* Optional cleanup. */ }
    }
    setStartupMessage(
      storageAvailable ? "离线剧情已载入；进度保存在本机浏览器。" : "剧情已载入；本机存储不可用，请用导出/导入存档保留进度。",
      !storageAvailable,
    );
    updateContinueButton();
    ui.modal.addEventListener("cancel", () => { modalReturnFocus = null; });
  }

  document.addEventListener("DOMContentLoaded", initialize, { once: true });
})();
