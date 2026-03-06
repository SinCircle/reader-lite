/* ============================================
   Reader Lite - Content Script
   提取正文，替换页面为干净阅读视图
   ============================================ */

(() => {
  'use strict';

  /* =====================
     配置持久化
     ===================== */
  const RL_STORAGE_KEY = 'readerLiteSettings';
  const RL_DEFAULTS = {
    fontSize: 19, lineHeight: '1.9', width: '920px',
    position: '0 auto', imgScale: 100, imgHidden: false
  };
  function rlLoadSettings() {
    return new Promise(resolve => {
      chrome.storage.local.get(RL_STORAGE_KEY, r => {
        resolve({ ...RL_DEFAULTS, ...(r[RL_STORAGE_KEY] || {}) });
      });
    });
  }
  function rlSaveSettings(s) {
    chrome.storage.local.set({ [RL_STORAGE_KEY]: s });
  }

  /* =====================
     消息监听
     ===================== */
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'toggleReaderMode') {
      toggleReaderMode().then(enabled => sendResponse({ enabled }));
      return true;
    } else if (msg.action === 'getReaderModeState') {
      sendResponse({ enabled: !!window.__readerLiteState });
    }
  });

  /* =====================
     切换
     ===================== */
  async function toggleReaderMode() {
    if (window.__readerLiteState) {
      restorePage();
      return false;
    } else {
      return enterReaderMode();
    }
  }

  /* =====================
     识别正文容器（评分法）
     ===================== */
  function pickMainContent() {
    const article = document.querySelector('article');
    if (article && article.innerText.length > 200) return article;

    const roleMain = document.querySelector('[role="main"]');
    if (roleMain && roleMain.innerText.length > 200) return roleMain;

    const mainTag = document.querySelector('main');
    if (mainTag && mainTag.innerText.length > 200) return mainTag;

    const candidates = document.querySelectorAll('div, section');
    let best = null;
    let bestScore = 0;

    candidates.forEach((el) => {
      const text = el.innerText || '';
      if (text.length < 200) return;

      let score = text.length;
      score += el.querySelectorAll('p').length * 80;
      score += el.querySelectorAll('h1,h2,h3,h4').length * 40;

      const linkText = Array.from(el.querySelectorAll('a')).reduce(
        (s, a) => s + (a.innerText || '').length, 0
      );
      if (text.length && linkText / text.length > 0.4) score *= 0.2;

      const rect = el.getBoundingClientRect();
      if (rect.width > 400 && rect.width < window.innerWidth * 0.95) score *= 1.3;

      let depth = 0, p = el;
      while (p && p !== document.body) { depth++; p = p.parentElement; }
      score *= Math.max(0.5, 1 - depth * 0.02);

      if (score > bestScore) { bestScore = score; best = el; }
    });

    return best;
  }

  /* =====================
     提取标题
     ===================== */
  function extractTitle(mainEl) {
    // 正文内 h1 优先
    const h1 = mainEl.querySelector('h1');
    if (h1 && h1.innerText.trim().length > 2) return h1.innerText.trim();
    // 页面 <title>
    return document.title || '';
  }

  /* =====================
     清理克隆内容
     ===================== */
  function cleanClone(clone) {
    // 移除干扰元素
    const removeSelectors = [
      'script', 'style', 'link', 'noscript',
      'nav', 'aside', 'footer', 'header',
      '[role="navigation"]', '[role="banner"]', '[role="complementary"]',
      '[role="contentinfo"]', '[aria-hidden="true"]',
      '.ad, .ads, .advert, .advertisement',
      '.sidebar, .side-bar',
      '.social-share, .share-buttons',
      '.related-posts, .recommended',
      '.comments, .comment-section, #comments',
    ];

    removeSelectors.forEach((sel) => {
      try {
        clone.querySelectorAll(sel).forEach((el) => el.remove());
      } catch (_) { /* invalid selector, skip */ }
    });

    // 移除隐藏元素
    clone.querySelectorAll('*').forEach((el) => {
      const style = el.getAttribute('style') || '';
      if (/display\s*:\s*none/i.test(style) || /visibility\s*:\s*hidden/i.test(style)) {
        el.remove();
      }
    });

    // 清除所有内联 style、class（使内容只受我们的 CSS 控制）
    clone.querySelectorAll('*').forEach((el) => {
      el.removeAttribute('style');
      el.removeAttribute('class');
      el.removeAttribute('id');
    });
    clone.removeAttribute('style');
    clone.removeAttribute('class');
    clone.removeAttribute('id');

    return clone;
  }

  /* =====================
     进入阅读模式
     ===================== */
  async function enterReaderMode() {
    const mainEl = pickMainContent();
    if (!mainEl) return false;

    const title = extractTitle(mainEl);
    const cloned = mainEl.cloneNode(true);
    cleanClone(cloned);

    const savedScrollY = window.scrollY;
    const savedBodyClass = document.body.className;
    const savedBodyStyle = document.body.getAttribute('style') || '';

    // 禁用原始样式表（保留 PageNote 和字体）
    const disabledSheets = [];
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((el) => {
      if (el.id === 'pagenote-inpage-style') return;
      if (el.href && el.href.includes('fonts.googleapis.com')) return;
      if (!el.disabled) {
        el.disabled = true;
        disabledSheets.push(el);
      }
    });

    // 把原始 body 子节点移入隐藏容器（保留 DOM 引用，不丢失 notes）
    const stash = document.createElement('div');
    stash.id = 'reader-lite-stash';
    stash.style.display = 'none';
    while (document.body.firstChild) {
      stash.appendChild(document.body.firstChild);
    }
    document.body.appendChild(stash);

    document.body.className = 'reader-lite-body';
    document.body.removeAttribute('style');

    // 容器
    const container = document.createElement('div');
    container.className = 'rl-container';

    if (title) {
      const titleEl = document.createElement('h1');
      titleEl.className = 'rl-title';
      titleEl.textContent = title;
      container.appendChild(titleEl);
    }

    const contentEl = document.createElement('div');
    contentEl.className = 'rl-content';
    while (cloned.firstChild) {
      contentEl.appendChild(cloned.firstChild);
    }
    container.appendChild(contentEl);

    const settings = await rlLoadSettings();
    const toolbar = buildToolbar(container, contentEl, settings);

    document.body.appendChild(toolbar);
    document.body.appendChild(container);

    // 把 notes 提到阅读页面顶层（保持可见）
    stash.querySelectorAll('.pagenote-sticky').forEach((note) => {
      document.body.appendChild(note);
    });

    window.scrollTo(0, 0);

    const escHandler = (e) => { if (e.key === 'Escape') restorePage(); };
    document.addEventListener('keydown', escHandler);

    window.__readerLiteState = {
      stash,
      savedBodyClass,
      savedBodyStyle,
      savedScrollY,
      disabledSheets,
      escHandler,
    };

    return true;
  }

  /* =====================
     工具栏
     ===================== */
  function buildToolbar(container, contentEl, settings) {
    const bar = document.createElement('div');
    bar.className = 'rl-toolbar';

    const tbState = { ...settings };

    // Apply saved settings to DOM
    contentEl.style.setProperty('font-size', tbState.fontSize + 'px', 'important');
    contentEl.style.setProperty('line-height', tbState.lineHeight, 'important');
    container.style.setProperty('max-width', tbState.width, 'important');
    container.style.setProperty('margin', tbState.position, 'important');
    if (tbState.imgScale !== 100) {
      contentEl.querySelectorAll('img').forEach(img => {
        img.style.setProperty('max-width', tbState.imgScale + '%', 'important');
      });
    }
    if (tbState.imgHidden) contentEl.classList.add('rl-hide-images');

    function persist() { rlSaveSettings(tbState); }

    // 创建按钮（带 active 状态管理）
    function makeBtn(label, title, onClick, group) {
      const btn = document.createElement('button');
      btn.className = 'rl-tb-btn';
      btn.textContent = label;
      btn.title = title;
      btn.addEventListener('click', () => {
        onClick(btn);
        // 对于组内按钮，设置 active
        if (group) {
          group.querySelectorAll('.rl-tb-btn').forEach(b => b.classList.remove('rl-tb-active'));
          btn.classList.add('rl-tb-active');
        }
      });
      return btn;
    }

    function makeGroup(label) {
      const g = document.createElement('div');
      g.className = 'rl-tb-group';
      const lbl = document.createElement('span');
      lbl.className = 'rl-tb-label';
      lbl.textContent = label;
      g.appendChild(lbl);
      return g;
    }

    // === 字号 ===
    const fontGroup = makeGroup('字号');
    const fontVal = document.createElement('span');
    fontVal.className = 'rl-tb-val';
    fontVal.textContent = tbState.fontSize;

    fontGroup.appendChild(makeBtn('−', '缩小字号', () => {
      tbState.fontSize = Math.max(14, tbState.fontSize - 2);
      contentEl.style.setProperty('font-size', tbState.fontSize + 'px', 'important');
      fontVal.textContent = tbState.fontSize;
      persist();
    }));
    fontGroup.appendChild(fontVal);
    fontGroup.appendChild(makeBtn('+', '放大字号', () => {
      tbState.fontSize = Math.min(32, tbState.fontSize + 2);
      contentEl.style.setProperty('font-size', tbState.fontSize + 'px', 'important');
      fontVal.textContent = tbState.fontSize;
      persist();
    }));
    bar.appendChild(fontGroup);

    // === 行距 ===
    const lhGroup = makeGroup('行距');
    [
      { label: '紧', val: '1.5' },
      { label: '中', val: '1.9' },
      { label: '松', val: '2.3' },
    ].forEach(({ label, val }) => {
      const btn = makeBtn(label, '行距 ' + val, () => {
        tbState.lineHeight = val;
        contentEl.style.setProperty('line-height', val, 'important');
        persist();
      }, lhGroup);
      if (val === tbState.lineHeight) btn.classList.add('rl-tb-active');
      lhGroup.appendChild(btn);
    });
    bar.appendChild(lhGroup);

    // === 宽度 ===
    const wGroup = makeGroup('宽度');
    [
      { label: '窄', val: '720px' },
      { label: '中', val: '920px' },
      { label: '宽', val: '1200px' },
    ].forEach(({ label, val }) => {
      const btn = makeBtn(label, val, () => {
        tbState.width = val;
        container.style.setProperty('max-width', val, 'important');
        persist();
      }, wGroup);
      if (val === tbState.width) btn.classList.add('rl-tb-active');
      wGroup.appendChild(btn);
    });
    bar.appendChild(wGroup);

    // === 位置 ===
    const posGroup = makeGroup('位置');
    [
      { label: '左', val: '0 auto 0 0' },
      { label: '中', val: '0 auto' },
      { label: '右', val: '0 0 0 auto' },
    ].forEach(({ label, val }) => {
      const btn = makeBtn(label, '文本位置 ' + label, () => {
        tbState.position = val;
        container.style.setProperty('margin', val, 'important');
        persist();
      }, posGroup);
      if (val === tbState.position) btn.classList.add('rl-tb-active');
      posGroup.appendChild(btn);
    });
    bar.appendChild(posGroup);

    // === 图片 ===
    const imgGroup = makeGroup('图片');
    const imgVal = document.createElement('span');
    imgVal.className = 'rl-tb-val';
    imgVal.textContent = tbState.imgScale + '%';

    imgGroup.appendChild(makeBtn('−', '缩小图片', () => {
      tbState.imgScale = Math.max(20, tbState.imgScale - 20);
      applyImgScale();
      persist();
    }));
    imgGroup.appendChild(imgVal);
    imgGroup.appendChild(makeBtn('+', '放大图片', () => {
      tbState.imgScale = Math.min(100, tbState.imgScale + 20);
      applyImgScale();
      persist();
    }));

    const hideBtn = makeBtn('隐', '隐藏/显示图片', (btn) => {
      tbState.imgHidden = !tbState.imgHidden;
      if (tbState.imgHidden) {
        contentEl.classList.add('rl-hide-images');
        btn.classList.add('rl-tb-active');
      } else {
        contentEl.classList.remove('rl-hide-images');
        btn.classList.remove('rl-tb-active');
      }
      persist();
    });
    if (tbState.imgHidden) hideBtn.classList.add('rl-tb-active');
    imgGroup.appendChild(hideBtn);
    bar.appendChild(imgGroup);

    function applyImgScale() {
      contentEl.querySelectorAll('img').forEach((img) => {
        img.style.setProperty('max-width', tbState.imgScale + '%', 'important');
      });
      imgVal.textContent = tbState.imgScale + '%';
    }

    // 自动隐藏：鼠标远离底部时淡出，靠近时淡入
    let hideTimer = null;
    const showBar = () => {
      bar.classList.add('rl-toolbar-visible');
      bar.classList.remove('rl-toolbar-hidden');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        bar.classList.remove('rl-toolbar-visible');
        bar.classList.add('rl-toolbar-hidden');
      }, 2500);
    };

    // 鼠标进入工具栏时保持可见
    bar.addEventListener('mouseenter', () => {
      clearTimeout(hideTimer);
      bar.classList.add('rl-toolbar-visible');
      bar.classList.remove('rl-toolbar-hidden');
    });
    bar.addEventListener('mouseleave', () => {
      hideTimer = setTimeout(() => {
        bar.classList.remove('rl-toolbar-visible');
        bar.classList.add('rl-toolbar-hidden');
      }, 1500);
    });

    // 鼠标靠近屏幕底部 120px 范围时显示
    document.addEventListener('mousemove', (e) => {
      if (e.clientY > window.innerHeight - 120) {
        showBar();
      }
    });

    // 初始显示 3 秒后自动隐藏
    bar.classList.add('rl-toolbar-visible');
    hideTimer = setTimeout(() => {
      bar.classList.remove('rl-toolbar-visible');
      bar.classList.add('rl-toolbar-hidden');
    }, 3000);

    return bar;
  }

  /* =====================
     恢复原始页面
     ===================== */
  function restorePage() {
    const state = window.__readerLiteState;
    if (!state) return;

    document.removeEventListener('keydown', state.escHandler);

    // 收集阅读模式中存活的 notes
    const liveNotes = Array.from(document.body.querySelectorAll('.pagenote-sticky'));

    // 移除阅读模式的元素（toolbar, container 等，但不移除 stash）
    Array.from(document.body.children).forEach((child) => {
      if (child !== state.stash && !child.classList.contains('pagenote-sticky')) {
        child.remove();
      }
    });

    // 把 stash 里的原始内容移回 body
    while (state.stash.firstChild) {
      document.body.appendChild(state.stash.firstChild);
    }
    state.stash.remove();

    // 把 notes 放回 body（它们在 stash 恢复前已在 body 上层）
    liveNotes.forEach((note) => document.body.appendChild(note));

    document.body.className = state.savedBodyClass;
    if (state.savedBodyStyle) {
      document.body.setAttribute('style', state.savedBodyStyle);
    } else {
      document.body.removeAttribute('style');
    }

    state.disabledSheets.forEach((el) => {
      el.disabled = false;
    });

    window.scrollTo(0, state.savedScrollY);

    window.__readerLiteState = null;
  }
})();
