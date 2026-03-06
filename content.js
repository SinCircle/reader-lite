/* ============================================
   Reader Lite - Content Script
   提取正文，替换页面为干净阅读视图
   ============================================ */

(() => {
  'use strict';

  /* =====================
     默认配置
     ===================== */
  const RL_DEFAULTS = {
    fontSize: 19, lineHeight: '1.9', width: '920px',
    position: '0 auto', imgScale: 100, imgHidden: false
  };

  /* =====================
     消息监听
     ===================== */
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'toggleReaderMode') {
      try {
        const enabled = toggleReaderMode();
        sendResponse({ enabled });
      } catch (_e) {
        sendResponse({ enabled: false });
      }
    } else if (msg.action === 'getReaderModeState') {
      sendResponse({ enabled: !!window.__readerLiteState });
    }
  });

  /* =====================
     切换
     ===================== */
  function toggleReaderMode() {
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
      'button', '[role="button"]',
      'form', 'input', 'select', 'textarea',
      // 广告
      '.ad', '.ads', '.advert', '.advertisement', '.ad-unit',
      '.dfp-leaderboard-container', '[class*="ad-placement"]',
      '[class*="sponsored"]',
      // 侧栏 / 导航
      '.sidebar', '.side-bar', '[class*="sidebar"]',
      // 社交分享 / 作者社交
      '.social-share', '.share-buttons',
      '.byline-social', '.button-social-group', '.button-social',
      '[class*="social-buttons"]', '[class*="button-social"]',
      '[class*="share-"]', '[aria-label*="Share"]',
      // 评论区（含第三方 Viafoura 等）
      '.comments', '.comment-section', '#comments',
      '.all-comments-container', '.all-comments',
      '[class*="viafoura"]', 'vf-widget', '[class*="vf-"]', '[class*="vf3-"]',
      // 推荐 / 相关 / 热门
      '.related-posts', '.recommended', '.related-articles-block',
      '.popular-box', '[class*="trending"]',
      '.carousel-showcase',
      // 无限滚动 / 信息流
      '.infinite-container', '.infinite-trigger',
      // 面包屑 / 跳转导航
      '.breadcrumb', '[class*="jump-to"]',
      // Cookie 同意 / 隐私弹窗
      '[class*="cky-consent"]', '[class*="cky-"]',
      '[class*="osano-cm"]', '[class*="cookie"]',
      '[class*="consent-bar"]', '[class*="privacy-consent"]',
      // 署名 / 作者元信息（通常出现在正文前后）
      '.byline', '[class*="byline"]',
      '[class*="author__"]', '[class*="author-bio"]',
      // 文章元信息（类型标签、日期栏、分享栏）
      '[class*="article-meta"]', '[class*="article-type"]',
      '.strapline',
      '[class*="affiliate-disclaimer"]',
      // 目录跳转
      '.contents[data-only-inline]', '[data-component-name="Article:JumpTo"]',
      // Newsletter 注册
      '[class*="newsletter"]',
      // 工具栏 / 操作栏
      '[class*="utility-bar"]', '[class*="toolbar"]',
      // 系列导航 / 前后文章
      '[class*="series-nav"]',
      // 评论按钮 / 书签按钮 / 收藏
      '[class*="comments-button"]', '[class*="bookmark-button"]',
      '[class*="favorite"]',
      // Tooltip / 屏幕阅读器专用文本
      '[role="tooltip"]', '[class*="tooltip"]',
      '.screen-reader-text', '.sr-only', '[class*="screen-reader"]',
      // 进度条 / 导航条
      '[class*="progress-bar"]', '[class*="nav__local"]',
      // 文章标题区的元数据（分享、摘要、操作栏）
      '[class*="post__title__actions"]', '[class*="post__title__meta"]',
      '[class*="post__title__kicker"]', '[class*="post__title__series"]',
      '[class*="post__title__author"]', '[class*="post__title__excerpt"]',
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

    // 移除过小的图标图片（宽或高 ≤ 48px 视为图标）
    clone.querySelectorAll('img').forEach((img) => {
      const w = img.naturalWidth || parseInt(img.getAttribute('width'), 10) || 0;
      const h = img.naturalHeight || parseInt(img.getAttribute('height'), 10) || 0;
      if ((w > 0 && w <= 48) || (h > 0 && h <= 48)) {
        img.remove();
      }
    });

    // 移除社交媒体按钮 / 图标链接（只含小图标、无正文文本的 <a>）
    const socialPattern = /facebook|twitter|weibo|wechat|whatsapp|telegram|linkedin|pinterest|instagram|tiktok|reddit|share|social|icon/i;
    clone.querySelectorAll('a').forEach((a) => {
      const text = a.textContent.trim();
      const href = a.getAttribute('href') || '';
      const innerImg = a.querySelector('img');
      const innerSvg = a.querySelector('svg');

      // 链接仅包含 SVG 图标无文字 → 移除
      if (innerSvg && !innerImg && text.length <= 2) { a.remove(); return; }

      // 链接包含 <img> 无文字 → 仅移除确认是小图标的情况
      if (innerImg && text.length <= 2) {
        const iw = innerImg.naturalWidth || parseInt(innerImg.getAttribute('width'), 10) || 0;
        const ih = innerImg.naturalHeight || parseInt(innerImg.getAttribute('height'), 10) || 0;
        const isSmallIcon = (iw > 0 && iw <= 48) || (ih > 0 && ih <= 48);
        if (isSmallIcon) { a.remove(); return; }
        // 尺寸未知或大图 → 保留（内容图片链接）
      }

      // href 或残留 class 匹配社交平台关键字且文本极短
      if (socialPattern.test(href + ' ' + (a.getAttribute('class') || '')) && text.length <= 6) {
        a.remove();
      }
    });

    // 移除所有 SVG（正文中的 SVG 几乎都是图标 / UI 装饰，不是内容图片）
    clone.querySelectorAll('svg').forEach((svg) => svg.remove());

    // 清除所有内联 style、class（使内容只受我们的 CSS 控制）
    clone.querySelectorAll('*').forEach((el) => {
      el.removeAttribute('style');
      el.removeAttribute('class');
      el.removeAttribute('id');
    });
    clone.removeAttribute('style');
    clone.removeAttribute('class');
    clone.removeAttribute('id');

    // 移除空行 / 无内容元素（从内到外，避免嵌套空壳残留）
    const emptyTags = new Set(['P','DIV','SPAN','LI','UL','OL','BLOCKQUOTE','SECTION','FIGURE','A']);
    let removed;
    do {
      removed = false;
      clone.querySelectorAll('*').forEach((el) => {
        if (!emptyTags.has(el.tagName)) return;
        if (!el.textContent.trim() && !el.querySelector('img,video,iframe,canvas,svg,audio')) {
          el.remove();
          removed = true;
        }
      });
    } while (removed);

    // 清理纯空白文本节点产生的连续 <br>
    clone.querySelectorAll('br + br').forEach((br) => br.remove());

    // 修剪开头的非正文碎片：若首部元素文本极短且不含媒体，逐个移除
    trimLeadingJunk(clone);

    return clone;
  }

  /**
   * 移除容器开头的短碎片节点（如残留的标签文本、日期行等）。
   * 只在遇到有实质内容的段落或含媒体的块时停止。
   */
  function trimLeadingJunk(el) {
    const MIN_PAR = 60;  // <p> 文本长度阈值
    while (el.firstChild) {
      const node = el.firstChild;
      // 空白文本节点 → 移除
      if (node.nodeType === Node.TEXT_NODE) {
        if (!node.textContent.trim()) { node.remove(); continue; }
        // 独立非空文本 → 仅保留足够长的
        if (node.textContent.trim().length >= MIN_PAR) break;
        node.remove(); continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) { node.remove(); continue; }
      const tag = node.tagName;
      // <p> 含足够长文本 → 正文开始
      if (tag === 'P' && (node.textContent || '').trim().length >= MIN_PAR) break;
      // 含媒体的块 → 正文开始
      if (node.querySelector('img,video,iframe,canvas,audio')) break;
      // <h1>-<h6> → 如果下一个兄弟是有实质内容的 <p> 则保留，否则碎片
      if (/^H[1-6]$/.test(tag)) {
        const next = nextMeaningfulSibling(node);
        if (next && next.tagName === 'P' && (next.textContent || '').trim().length >= MIN_PAR) break;
        if (next && next.querySelector && next.querySelector('img,video,iframe,canvas,audio')) break;
        // 孤立标题（后面没跟长段落）→ 碎片，移除
        node.remove(); continue;
      }
      // <blockquote>/<pre>/<table> → 实质内容
      if (/^(BLOCKQUOTE|PRE|TABLE|DL)$/.test(tag)) break;
      // 其余元素（div/span/section/ul/ol/li/a 等）：文本短 → 碎片
      if ((node.textContent || '').trim().length < MIN_PAR) {
        node.remove(); continue;
      }
      // 文本长但内部有 <p> → 可能是包裹层，递归修剪
      if (node.querySelector('p')) {
        trimLeadingJunk(node);
        // 修剪后若变空则移除
        if (!node.textContent.trim() && !node.querySelector('img,video,iframe,canvas,audio')) {
          node.remove(); continue;
        }
      }
      break;
    }
  }

  /** 跳过空白文本，找到下一个有意义的兄弟元素 */
  function nextMeaningfulSibling(node) {
    let sib = node.nextSibling;
    while (sib) {
      if (sib.nodeType === Node.ELEMENT_NODE) return sib;
      if (sib.nodeType === Node.TEXT_NODE && sib.textContent.trim()) return sib;
      sib = sib.nextSibling;
    }
    return null;
  }

  /* =====================
     连续图片并排显示
     ===================== */
  function isImageNode(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const tag = node.tagName;
    if (tag === 'IMG') return true;
    if (tag === 'FIGURE' && node.querySelector('img')) return true;
    // <p> / <div> / <span> 等：只要内部有效内容全是 img（或包含 img 的 <a>），就算图片节点
    const meaningful = Array.from(node.childNodes).filter(
      n => !(n.nodeType === Node.TEXT_NODE && !n.textContent.trim())
    );
    if (meaningful.length === 0) return false;
    return meaningful.every(n => {
      if (n.nodeType !== Node.ELEMENT_NODE) return false;
      if (n.tagName === 'IMG') return true;
      if (n.tagName === 'A' && n.querySelector('img')) return true;
      // 递归：包裹层只含图片的也算
      return isImageNode(n);
    });
  }

  function groupConsecutiveImages(el) {
    // 先递归处理所有子元素（深度优先，从最内层开始分组）
    Array.from(el.children).forEach(child => groupConsecutiveImages(child));

    // 再在当前层级寻找连续图片并分组
    const flush = (run) => {
      if (run.length < 2) return;
      const row = document.createElement('div');
      row.className = 'rl-img-row';
      run[0].parentNode.insertBefore(row, run[0]);
      run.forEach(n => row.appendChild(n));
    };

    const children = Array.from(el.childNodes);
    let imgRun = [];

    for (const node of children) {
      if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) continue;
      if (isImageNode(node)) {
        imgRun.push(node);
      } else {
        flush(imgRun);
        imgRun = [];
      }
    }
    flush(imgRun);
  }

  /* =====================
     进入阅读模式
     ===================== */
  function enterReaderMode() {
    const mainEl = pickMainContent();
    if (!mainEl) return false;

    const settings = { ...RL_DEFAULTS };

    const title = extractTitle(mainEl);
    const cloned = mainEl.cloneNode(true);
    cleanClone(cloned);

    const savedScrollY = window.scrollY;
    const savedBodyClass = document.body.className;
    const savedBodyStyle = document.body.getAttribute('style') || '';

    // 禁用原始样式表（保留 PageNote、字体和扩展自身样式）
    const disabledSheets = [];
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((el) => {
      if (el.id === 'pagenote-inpage-style') return;
      if (el.id === 'reader-lite-injected-css') return;
      if (el.href && el.href.includes('fonts.googleapis.com')) return;
      if (el.href && el.href.startsWith('chrome-extension://')) return;
      // 跳过扩展自身的 content script CSS（Chrome 注入的 <style>）
      if (el.tagName === 'STYLE' && el.textContent &&
          el.textContent.includes('.reader-lite-body')) return;
      if (!el.disabled) {
        el.disabled = true;
        disabledSheets.push(el);
      }
    });

    // 确保阅读模式 CSS 始终可用（防止被上面的逻辑误禁用）
    if (!document.getElementById('reader-lite-injected-css')) {
      const rlCSS = document.createElement('link');
      rlCSS.id = 'reader-lite-injected-css';
      rlCSS.rel = 'stylesheet';
      rlCSS.href = chrome.runtime.getURL('content.css');
      document.head.appendChild(rlCSS);
    }

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
    groupConsecutiveImages(contentEl);
    container.appendChild(contentEl);

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
    }));
    fontGroup.appendChild(fontVal);
    fontGroup.appendChild(makeBtn('+', '放大字号', () => {
      tbState.fontSize = Math.min(32, tbState.fontSize + 2);
      contentEl.style.setProperty('font-size', tbState.fontSize + 'px', 'important');
      fontVal.textContent = tbState.fontSize;
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
    }));
    imgGroup.appendChild(imgVal);
    imgGroup.appendChild(makeBtn('+', '放大图片', () => {
      tbState.imgScale = Math.min(100, tbState.imgScale + 20);
      applyImgScale();
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
    const scheduleHide = (delay) => {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        bar.classList.remove('rl-toolbar-visible');
        bar.classList.add('rl-toolbar-hidden');
      }, delay);
    };
    const showBar = (delay = 5000) => {
      bar.classList.add('rl-toolbar-visible');
      bar.classList.remove('rl-toolbar-hidden');
      scheduleHide(delay);
    };

    // 鼠标进入工具栏时保持可见
    bar.addEventListener('mouseenter', () => {
      clearTimeout(hideTimer);
      bar.classList.add('rl-toolbar-visible');
      bar.classList.remove('rl-toolbar-hidden');
    });
    bar.addEventListener('mouseleave', () => {
      scheduleHide(3000);
    });

    // 鼠标靠近屏幕底部 150px 范围时显示
    document.addEventListener('mousemove', (e) => {
      if (e.clientY > window.innerHeight - 150) {
        showBar(5000);
      }
    });

    // 初始显示 5 秒后自动隐藏
    bar.classList.add('rl-toolbar-visible');
    scheduleHide(5000);

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

    // 移除阅读模式注入的 CSS
    const injectedCSS = document.getElementById('reader-lite-injected-css');
    if (injectedCSS) injectedCSS.remove();

    window.scrollTo(0, state.savedScrollY);

    window.__readerLiteState = null;
  }
})();
