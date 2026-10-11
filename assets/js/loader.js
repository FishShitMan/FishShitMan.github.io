/* ===========================================================================
 * DoubleX GameStudio - 内容加载器
 * ---------------------------------------------------------------------------
 * 作用：把「文本类内容」从 HTML 中分离，改为运行时从 assets/data/ 读取。
 *
 * 设计要点
 *  1. HTML 里始终写有默认内容。本脚本只有在成功取到真实数据后才替换它，
 *     因此脚本 404、JSON 语法错、网络中断、JS 被禁用这四种情况下，
 *     页面依然显示完整可用的默认内容，不会白屏。
 *  2. 数据文件之间彼此独立：某一个读取失败只影响它自己对应的内容。
 *  3. 数据文件里不写任何路径，只写逻辑键（如 "geometry/poster-1"），
 *     由本脚本按页面深度补上 media/ 前缀。以后调整目录结构无需改数据。
 *  4. 需要滚动显现动画的元素，必须在本脚本渲染完成后再加载 main.js，
 *     否则 IntersectionObserver 观察不到新生成的节点。
 *
 * 页面接入方式（放在 </body> 之前、main.js 之前）
 *      <script src="<相对路径>/assets/js/loader.js"></script>
 *      <script src="<相对路径>/assets/js/main.js"></script>
 * =========================================================================== */
(function () {
  'use strict';

  var SLOT_DEFAULT_COUNT = { cards: 4, carousel: 12, gallery: 12, newsOnHome: 5 };
  var FADE_MIN = 3;          // 动态多于此数才开启底部渐隐

  // ---------------------------------------------------------------- 路径
  function rel(n) { var s = ''; while (n-- > 0) { s += '../'; } return s; }

  var ORIGIN = document.baseURI || window.location.href;
  var _segs = window.location.pathname.replace(/\\/g, '/').split('/').filter(Boolean);
  if (_segs.length && !/\.[a-z0-9]+$/i.test(_segs[_segs.length - 1])) { _segs.push('index.html'); }
  var ROOT = rel(Math.max(0, _segs.length - 1));

  function url(label) { return new URL(ROOT + label, ORIGIN).href; }
  function media(k) { return k ? ROOT + 'media/' + k : ''; }
  function local(u) { return u ? new URL(u, ORIGIN).href : ''; }

  var DATA_DIR = 'assets/data/';           // 数据目录（相对站点根）

  // ---------------------------------------------------------------- 工具
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function getJSON(u) {
    return fetch(u, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) { throw new Error(r.status + ' ' + u); }
      return r.json();
    });
  }
  function setHTML(sel, html) {
    var el = document.querySelector(sel);
    if (!el) { return false; }
    el.innerHTML = html;
    return true;
  }
  /* 用 <picture> 输出：WebP 优先，其余浏览器回退到 JPEG/PNG */
  function pic(mediaKey, webpKey, alt, attrs) {
    var img = '<img src="' + esc(media(mediaKey)) + '" alt="' + esc(alt) + '"' + (attrs || '') + '>';
    if (!webpKey) { return img; }
    return '<picture><source srcset="' + esc(media(webpKey)) + '" type="image/webp">' + img + '</picture>';
  }
  /* 用真实像素尺寸输出 width/height，避免浏览器按错误比例预留空间导致布局跳动 */
  function dimAttrs(w, h, dw, dh) {
    w = Number(w) || dw;
    h = Number(h) || dh;
    return ' width="' + w + '" height="' + h + '"';
  }

  /* 截图项：media 已含扩展名，webp 为独立文件名 */
  function shot(item, altPrefix, i) {
    var img = '<img src="' + esc(media(item.media)) + '" alt="' + esc(altPrefix + ' ' + (i + 1)) + '"'
      + ' loading="lazy" decoding="async"'
      + (item.width ? ' width="' + item.width + '" height="' + item.height + '"' : '') + '>';
    var body = item.webp
      ? '<picture><source srcset="' + esc(media(item.webp)) + '" type="image/webp">' + img + '</picture>'
      : img;
    return '<div class="screenshot-item">' + body + '</div>';
  }

  /* 逻辑键补扩展名：数据里可能已带扩展名（如 fishfarm/cover.jpg），
     也可能不带（如 geometry/poster-1 + coverExt=".png"），这里统一处理。 */
  function withExt(key, ext) {
    if (!key) { return ''; }
    if (!ext) { return key; }
    return new RegExp(ext.replace('.', '\\.') + '$', 'i').test(key) ? key : key + ext;
  }

  /* 链接补站点根前缀，但不碰 javascript: / # / 绝对地址 */
  function nav(u) {
    if (!u || /^(javascript:|#|mailto:|https?:|\/\/)/i.test(u)) { return u || 'javascript:;'; }
    return ROOT + u.replace(/^\.\//, '');
  }

  // ---------------------------------------------------------------- 数据
  var DX = window.DX = {
    ready: false, failed: false, onReady: null,
    data: { news: [], games: {}, gallery: null, showcase: null, siteslots: null },
    version: '', buildDate: '', slots: SLOT_DEFAULT_COUNT,
    render: {},
    media: media,                          // 页面脚本用：把逻辑键解析为实际 URL
    url: url,
    applyVisible: function () { applyVisible(); }   // 页面脚本重建内容后调用
  };
  var _readyCbs = [];
  DX.onReady = function (fn) {
    if (typeof fn !== 'function') { return; }
    if (DX.ready || DX.failed) { try { fn(DX.data); } catch (e) { if (window.console) console.error(e); } }
    else { _readyCbs.push(fn); }
  };
  function fire() {
    DX.ready = true;
    for (var i = 0; i < _readyCbs.length; i++) {
      try { _readyCbs[i](DX.data); } catch (e) { if (window.console) console.error(e); }
    }
    _readyCbs = [];
  }

  /* 每个数据源独立请求：某一个失败不影响其余内容 */
  function one(label) {
    return getJSON(url(label)).then(
      function (v) { return { ok: true, label: label, value: v }; },
      function (e) {
        if (window.console) { console.warn('[DX] 数据读取失败，已使用页面默认内容：' + label, e); }
        return { ok: false, label: label, value: null };
      });
  }

  function loadAll() {
    return one(DATA_DIR + 'manifest.json').then(function (r) {
      if (!r.ok) { throw new Error('manifest'); }
      var m = r.value || {};
      DX.version = (m.site && m.site.version) || '';
      DX.buildDate = (m.site && m.site.buildDate) || '';
      DX.slots = m.slots || SLOT_DEFAULT_COUNT;

      var jobs = [];
      (m.news || []).forEach(function (n) { jobs.push(one(DATA_DIR + 'news/' + n)); });
      (m.games || []).forEach(function (g) { jobs.push(one(DATA_DIR + 'games/' + g)); });
      if (m.gallery) { jobs.push(one(DATA_DIR + m.gallery)); }
      if (m.showcase) { jobs.push(one(DATA_DIR + m.showcase)); }
      if (m.siteslots) { jobs.push(one(DATA_DIR + m.siteslots)); }

      return Promise.all(jobs).then(function (res) {
        res.forEach(function (x) {
          if (!x.ok) { return; }
          if (x.label.indexOf(DATA_DIR + 'news/') === 0) { DX.data.news.push(x.value); }
          else if (x.label.indexOf(DATA_DIR + 'games/') === 0) { DX.data.games[x.value.key || ''] = x.value; }
          else { DX.data[x.label.replace(DATA_DIR, '').replace('.json', '')] = x.value; }
        });
      });
    });
  }

  // ---------------------------------------------------------------- 渲染
  var EMPTY = {
    cardTitle: '待开发项目',
    cardSubtitle: '这是一个等待开发中的游戏项目哦',
    cardTag: '暂无 · 暂无',
    cardBtn: '即将推出',
    comingBtn: '敬请期待',
    newsTitle: '🎮 更多动态即将公布',
    newsBody: '开发进展正在整理中，敬请期待。'
  };

  function byNewest(a, b) {
    var da = String(a.date || '').split('.').join('-'), db = String(b.date || '').split('.').join('-');
    if (da !== db) { return da < db ? 1 : -1; }
    return (a.order || 0) - (b.order || 0);
  }

  /* ---------------------------------------------------------------------------
   * 关键：.reveal / .reveal-left / .reveal-scale 等类在 CSS 里是 opacity:0，
   * 只有加上 .visible 才会显示。而 .visible 由 main.js 的 IntersectionObserver
   * 在 DOMContentLoaded 时统一添加 —— 那时本脚本注入的内容还不存在（fetch 是异步的），
   * 于是注入的元素永远停在 opacity:0：占着位置（所以滚动条长度正常）但完全看不见。
   * 这里在渲染后主动补上 .visible，并广播 dx:content 让 main.js 也能重新扫描。
   * ------------------------------------------------------------------------- */
  function applyVisible() {
    var els = document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-up, .reveal-scale');
    for (var i = 0; i < els.length; i++) { els[i].classList.add('visible'); }
    try {
      document.dispatchEvent(new CustomEvent('dx:content', { detail: { count: els.length } }));
    } catch (e) { /* 旧浏览器不支持 CustomEvent 时忽略 */ }
  }

  /* ---- 首页「最新动态」精简列表：只列最新的 N 条 ---- */
  DX.render.news = function () {
    var all = DX.data.news.slice().sort(byNewest);
    var limit = DX.slots.newsOnHome || SLOT_DEFAULT_COUNT.newsOnHome;
    var items = all.slice(0, limit);
    /* 底部渐隐：动态多于 3 条时开启，≤3 条时关闭（条目太少时渐变会遮住内容） */
    var wrap = document.querySelector('.news-timeline-wrap');
    if (wrap) {
      if (all.length <= FADE_MIN) { wrap.classList.add('is-short'); }
      else { wrap.classList.remove('is-short'); }
    }
    if (!items.length) {
      return setHTML('#newsList',
        '<div class="news-item reveal-left"><div class="news-date">—</div><h3>' + esc(EMPTY.newsTitle)
        + '</h3><p>' + esc(EMPTY.newsBody) + '</p></div>');
    }
    var html = '';
    items.forEach(function (n, i) {
      html += '<div class="news-item reveal-left"' + (i ? ' style="transition-delay: ' + (0.05 * i).toFixed(2) + 's;"' : '') + '>'
        + '<div class="news-date">' + esc(n.date) + '</div>'
        + '<h3>' + esc(n.title) + '</h3>'
        + '<p>' + esc(n.summary || (n.body && n.body[0]) || '') + '</p></div>';
    });
    setHTML('#newsList', html);
  };

  /* ---- 动态页时间线 ---- */
  DX.render.newsFull = function () {
    var items = DX.data.news.slice().sort(byNewest);
    if (!items.length) {
      return setHTML('#newsTimeline',
        '<div class="timeline-item reveal"><div class="timeline-date">—</div><h3>' + esc(EMPTY.newsTitle)
        + '</h3><p>' + esc(EMPTY.newsBody) + '</p></div>');
    }
    var html = '';
    items.forEach(function (n) {
      html += '<div class="timeline-item reveal"><div class="timeline-date">' + esc(n.date) + '</div>'
        + '<h3>' + esc(n.title) + '</h3>';
      (n.body || []).forEach(function (p) { html += '<p>' + esc(p) + '</p>'; });
      if (n.tags && n.tags.length) {
        html += '<div class="update-meta">';
        n.tags.forEach(function (t) { html += '<span>' + esc(t) + '</span>'; });
        html += '</div>';
      }
      html += '</div>';
    });
    setHTML('#newsTimeline', html);
  };

  /* ---- 首页游戏卡片 ---- */
  DX.render.cards = function () {
    var slots = (DX.data.siteslots && DX.data.siteslots.cards) || [];
    var n = DX.slots.cards || SLOT_DEFAULT_COUNT.cards;
    var html = '';
    for (var i = 0; i < n; i++) {
      var s = slots[i] || {};
      var g = s.game ? DX.data.games[s.game] : null;
      var title = (g && g.title) || s.title || EMPTY.cardTitle;
      var subtitle = (g && g.subtitle) || s.subtitle || EMPTY.cardSubtitle;
      var tag = (g && g.badge) || s.tag || EMPTY.cardTag;
      var icon = s.icon || (g && g.icon) || '';
      var mediaKey = s.media || withExt(g && g.cover, g && g.coverExt);
      var webpKey = s.webp || withExt(g && g.coverWebp, g && g.coverWebpExt);
      var bg;
      if (s.iconOnly && icon) {
        /* 该槽位有意只用图标（如首页《养鱼大亨》用 🐟），不套用游戏封面 */
        bg = '<div class="project-bg"><span class="icon">' + esc(icon) + '</span></div>';
      } else if (mediaKey) {
        bg = '<div class="project-bg" style="padding:0; overflow:hidden;">'
          + pic(mediaKey, webpKey, title + ' 宣传图', ' width="1920" height="1080" loading="lazy" decoding="async" style="width:100%; height:100%; object-fit:cover;"')
          + '</div>';
      } else if (icon) {
        bg = '<div class="project-bg"><span class="icon">' + esc(icon) + '</span></div>';
      } else {
        bg = '<div class="project-bg"><span class="icon">✦</span></div>';
      }
      var btn;
      if (s.link) {
        btn = '<a class="nav-link" href="' + esc(nav(s.link)) + '">' + esc(s.linkText || '游戏详情') + '</a>';
      } else {
        btn = '<span class="nav-link disabled" aria-disabled="true" title="' + esc(title + ' 仍在开发中，暂无详情页')
          + '">' + esc(s.linkText || (g ? EMPTY.comingBtn : EMPTY.cardBtn)) + '</span>';
      }
      html += '<div class="project-card reveal-scale"' + (i ? ' style="transition-delay: ' + (0.1 * i).toFixed(1) + 's;"' : '')
        + '>' + bg + '<div class="project-overlay"><h3>' + esc(title) + '</h3><p>' + esc(subtitle)
        + '</p><span class="tag">' + esc(tag) + '</span>' + btn + '</div></div>';
    }
    setHTML('#projectsGrid', html);
  };

  /* ---- 游戏画廊 ---- */
  DX.render.gallery = function () {
    var data = DX.data.gallery;
    var items = (data && data.items) || [];
    var n = DX.slots.gallery || SLOT_DEFAULT_COUNT.gallery;
    var html = '';
    for (var i = 0; i < n; i++) {
      var it = items[i];
      if (!it || !it.media) {
        html += '<div class="gallery-item reveal-up" data-category="all" data-url="">'
          + '<div class="item-image item-empty"><span>?</span></div>'
          + '<div class="item-overlay"><span class="item-category">敬请期待</span>'
          + '<h3>作品 #' + (i + 1) + '</h3>'
          + '<p class="item-desc">更多作品即将公开</p>'
          + '<span class="view-btn" data-index="' + i + '">查看大图</span></div></div>';
        continue;
      }
      html += '<div class="gallery-item reveal-up" data-category="' + esc(it.category) + '"'
        + ' data-url="' + esc(it.url || '') + '" data-index="' + i + '">'
        + '<div class="item-image">'
        + pic(it.media, it.webp, it.alt || it.title,
          dimAttrs(it.width, it.height, 1536, 864) + ' loading="lazy" decoding="async"')
        + '</div><div class="item-overlay"><span class="item-category">' + esc(it.label) + '</span>'
        + '<h3>' + esc(it.title) + '</h3><p class="item-desc">' + esc(it.desc) + '</p>'
        + '<span class="view-btn" data-index="' + i + '">查看大图</span></div></div>';
    }
    setHTML('#galleryGrid', html);
  };

  /* ---- 作品转盘数据（转盘的 3D / 点击 / 滚动逻辑不改，只换数据来源） ---- */
  DX.buildCarousel = function () {
    var data = DX.data.showcase;
    var slots = (data && data.slots) || [];
    var n = DX.slots.carousel || SLOT_DEFAULT_COUNT.carousel;
    var out = [];
    for (var i = 0; i < n; i++) {
      var s = slots[i] || {};
      var g = s.game ? DX.data.games[s.game] : null;
      var mk = s.iconOnly ? '' : (s.media || withExt(g && g.cover, g && g.coverExt));
      var wk = s.iconOnly ? '' : (s.webp || withExt(g && g.coverWebp, g && g.coverWebpExt));
      out.push({
        t: (g && g.title) || s.title || ('作品 #' + (i + 1)),
        s: (g && g.subtitle) || s.subtitle || '敬请期待',
        e: s.icon || '✦',
        i: media(mk),
        w: media(wk),
        b: (g && g.badge) || s.badge || '✦ 开发中',
        d: (g && g.desc) || s.desc || EMPTY.cardSubtitle,
        a: s.link
          ? { u: nav(s.link.replace(/^game-detail\.html/, 'games/detail.html')), t: s.linkText || '了解更多' }
          : { u: 'javascript:;', t: s.linkText || EMPTY.comingBtn }
      });
    }
    return out;
  };

  /* ---- 所有页面共用的渲染入口 ---- */
  DX.renderAll = function () {
    DX.render.news();
    DX.render.newsFull();
    DX.render.cards();
    DX.render.gallery();
  };
  // ---------------------------------------------------------------- 启动
  function boot() {
    var timer = setTimeout(function () {                       // 网络迟迟无响应时也要放行
      if (!DX.ready && !DX.failed) { DX.failed = true; fire(); }
    }, 6000);

    loadAll().then(function () {
      clearTimeout(timer);
      DX.renderAll();
      applyVisible();                     // 必须在上面的渲染之后，否则注入内容不可见
      fire();
    }, function () {
      clearTimeout(timer);
      DX.failed = true;
      if (window.console) { console.warn('[DX] 内容数据不可用，页面保留 HTML 内置的默认内容。'); }
      applyVisible();                     // 降级路径同样要保证内置默认内容可见
      fire();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
