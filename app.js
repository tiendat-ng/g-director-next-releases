(function () {
  'use strict';

  /**
   * CẤU HÌNH LINK VIDEO HƯỚNG DẪN (YOUTUBE HOẶC FILE .MP4):
   * Chỉ cần dán link YouTube (VD: 'https://www.youtube.com/watch?v=xxxxxxx' hoặc 'https://youtu.be/xxxxxxx')
   * hoặc đường dẫn file MP4 vào 3 mục dưới đây là khung phát Video trên trang web sẽ tự động bật!
   */
  const VIDEO_TUTORIAL_URLS = {
    overview: '', // Bài 01: Tổng quan & Tạo phim 1-Click
    accounts: '', // Bài 02: Cài đặt & Kết nối Tài khoản AI
    chaining: '', // Bài 03: Kỹ thuật Nối cảnh & Dựng NLE
  };

  const GITHUB_OWNER = 'tiendat-ng';
  const GITHUB_REPO = 'g-director-next-releases';
  const RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=10`;
  const CACHE_KEY = 'dstudio_releases_cache_v1';
  const LANG_STORAGE_KEY = 'dstudio_web_lang';
  const CACHE_TTL_MS = 5 * 60 * 1000;

  const SUPPORTED_LANGS = ['vi', 'en', 'zh', 'ja'];

  const FALLBACK_RELEASES = [
    {
      tag: 'v2.0.6',
      version: '2.0.6',
      publishedAt: '2026-11-21T16:19:03Z',
      macDmg: {
        name: 'D-Studio-2.0.6-arm64.dmg',
        sizeMB: 230,
        url: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/v2.0.6/D-Studio-2.0.6-arm64.dmg`,
      },
      winExe: {
        name: 'D-Studio-setup.exe',
        sizeMB: 207,
        url: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest/download/D-Studio-setup.exe`,
      },
      winZip: {
        name: 'D-Studio-portable-win.zip',
        sizeMB: 278,
        url: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest/download/D-Studio-portable-win.zip`,
      },
    },
  ];

  let parsedReleases = FALLBACK_RELEASES.slice();
  let selectedReleaseIndex = 0;
  let activeModuleKey = 'director';
  let activeTutorialIndex = 0;
  let currentLang = 'vi';

  function getDict() {
    const all = window.DSTUDIO_I18N || {};
    return all[currentLang] || all.vi;
  }

  function detectInitialLang() {
    try {
      const params = new URLSearchParams(window.location.search);
      const qLang = (params.get('lang') || '').toLowerCase();
      if (SUPPORTED_LANGS.includes(qLang)) return qLang;

      const saved = localStorage.getItem(LANG_STORAGE_KEY);
      if (saved && SUPPORTED_LANGS.includes(saved)) return saved;
    } catch (_) {}
    return 'vi';
  }

  function detectVisitorOS() {
    const ua = (navigator.userAgent || '').toLowerCase();
    const platform = (
      (navigator.userAgentData && navigator.userAgentData.platform) ||
      navigator.platform ||
      ''
    ).toLowerCase();

    if (platform.includes('mac') || ua.includes('macintosh') || ua.includes('mac os')) {
      return 'mac';
    }
    if (platform.includes('win') || ua.includes('windows')) {
      return 'win';
    }
    return 'other';
  }

  function formatDateByLang(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    if (currentLang === 'zh' || currentLang === 'ja') {
      return `${yyyy}-${mm}-${dd}`;
    }
    if (currentLang === 'en') {
      return `${yyyy}-${mm}-${dd}`;
    }
    return `${dd}/${mm}/${yyyy}`;
  }

  function toYouTubeEmbedUrl(rawUrl) {
    if (!rawUrl) return '';
    const trimmed = rawUrl.trim();
    const watchMatch = trimmed.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{6,})/);
    if (watchMatch && watchMatch[1]) {
      return `https://www.youtube.com/embed/${watchMatch[1]}?rel=0`;
    }
    return '';
  }

  function mapReleasePayload(apiReleases) {
    if (!Array.isArray(apiReleases)) return [];
    const valid = [];

    for (const rel of apiReleases) {
      if (!rel || rel.draft) continue;
      const assets = Array.isArray(rel.assets) ? rel.assets : [];
      if (assets.length === 0) continue;

      const findAsset = (pred) => assets.find((a) => a && a.browser_download_url && pred(a.name.toLowerCase()));

      const macArm =
        findAsset((n) => n.endsWith('.dmg') && (n.includes('arm64') || n.includes('aarch64'))) ||
        findAsset((n) => n.endsWith('.dmg'));
      const winExe = findAsset((n) => n.endsWith('.exe'));
      const winZip =
        findAsset((n) => n.endsWith('.zip') && (n.includes('win') || n.includes('portable'))) ||
        findAsset((n) => n.endsWith('.zip') && !n.includes('mac'));

      if (!macArm && !winExe && !winZip) continue;

      const toAssetInfo = (a) =>
        a
          ? {
              name: a.name,
              sizeMB: Math.max(1, Math.round((a.size || 0) / 1048576)),
              url: a.browser_download_url,
            }
          : null;

      const tag = String(rel.tag_name || '').trim();
      const version = tag.replace(/^v/i, '') || tag;

      valid.push({
        tag,
        version,
        publishedAt: rel.published_at || rel.created_at || '',
        macDmg: toAssetInfo(macArm),
        winExe: toAssetInfo(winExe),
        winZip: toAssetInfo(winZip),
      });
    }

    return valid;
  }

  async function loadLatestReleases() {
    try {
      const cachedRaw = localStorage.getItem(CACHE_KEY);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw);
        if (cached && Array.isArray(cached.items) && cached.items.length > 0) {
          parsedReleases = cached.items;
          renderReleaseUI();
          if (Date.now() - (cached.ts || 0) < CACHE_TTL_MS) {
            return;
          }
        }
      }
    } catch (_) {}

    try {
      const resp = await fetch(RELEASES_API_URL, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!resp.ok) return;
      const json = await resp.json();
      const mapped = mapReleasePayload(json);
      if (mapped.length > 0) {
        parsedReleases = mapped;
        selectedReleaseIndex = 0;
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), items: mapped }));
        } catch (_) {}
        renderReleaseUI();
      }
    } catch (_) {}
  }

  function showDownloadToast(fileName, osType) {
    const dict = getDict();
    const toast = document.getElementById('dl-toast');
    const titleEl = document.getElementById('dl-toast-title');
    const descEl = document.getElementById('dl-toast-desc');
    if (!toast || !titleEl || !descEl) return;

    titleEl.textContent = `${dict.toast.titlePrefix} ${fileName}...`;
    descEl.textContent =
      osType === 'mac'
        ? dict.toast.macDesc
        : osType === 'win-zip'
        ? dict.toast.winZipDesc
        : dict.toast.winExeDesc;

    toast.classList.add('visible');
    clearTimeout(window.__dstudioToastTimer);
    window.__dstudioToastTimer = setTimeout(() => {
      toast.classList.remove('visible');
    }, 7500);
  }

  function bindDirectDownloadTriggers() {
    document.querySelectorAll('[data-direct-dl]').forEach((btn) => {
      btn.addEventListener('click', function () {
        const osType = btn.getAttribute('data-direct-dl') || 'win';
        const fileName = btn.getAttribute('data-filename') || 'D-Studio';
        showDownloadToast(fileName, osType);
      });
    });
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el && val !== undefined) el.textContent = val;
  }

  function setHtml(id, val) {
    const el = document.getElementById(id);
    if (el && val !== undefined) el.innerHTML = val;
  }

  function renderReleaseUI() {
    const dict = getDict();
    const current = parsedReleases[selectedReleaseIndex] || parsedReleases[0] || FALLBACK_RELEASES[0];
    const latest = parsedReleases[0] || current;
    const os = detectVisitorOS();

    document.querySelectorAll('[data-live-version]').forEach((el) => {
      el.textContent = `v${latest.version}`;
    });

    const releaseSummaryEl = document.getElementById('release-summary-text');
    if (releaseSummaryEl) {
      const dateTxt = formatDateByLang(current.publishedAt);
      const isLatest = selectedReleaseIndex === 0;
      releaseSummaryEl.innerHTML = `${dict.download.selectedPrefix} <strong>v${current.version}</strong> ${
        isLatest ? `<span class="version-pill">${dict.download.latestBadge}</span>` : ''
      } ${dateTxt ? `<span style="color: var(--text-muted)">• ${dict.download.publishedPrefix} ${dateTxt}</span>` : ''}`;
    }

    const selectEl = document.getElementById('version-select');
    if (selectEl) {
      selectEl.innerHTML = '';
      parsedReleases.forEach((rel, idx) => {
        const opt = document.createElement('option');
        opt.value = String(idx);
        const datePart = formatDateByLang(rel.publishedAt);
        opt.textContent =
          idx === 0
            ? `v${rel.version} ${dict.download.latestOptionSuffix}${datePart ? ` (${datePart})` : ''}`
            : `v${rel.version}${datePart ? ` (${datePart})` : ''}`;
        if (idx === selectedReleaseIndex) opt.selected = true;
        selectEl.appendChild(opt);
      });
    }

    const setCardAsset = (prefix, asset) => {
      const btn = document.getElementById(`btn-dl-${prefix}`);
      const nameEl = document.getElementById(`meta-name-${prefix}`);
      const sizeEl = document.getElementById(`meta-size-${prefix}`);
      if (!btn) return;

      if (asset && asset.url) {
        btn.href = asset.url;
        btn.setAttribute('data-filename', asset.name);
        btn.style.pointerEvents = 'auto';
        btn.style.opacity = '1';
        if (nameEl) nameEl.textContent = asset.name;
        if (sizeEl) sizeEl.textContent = `${asset.sizeMB} MB`;
      } else {
        btn.removeAttribute('href');
        btn.style.pointerEvents = 'none';
        btn.style.opacity = '0.5';
        if (nameEl) nameEl.textContent = dict.download.unavailable;
        if (sizeEl) sizeEl.textContent = '—';
      }
    };

    setCardAsset('mac', current.macDmg);
    setCardAsset('win-exe', current.winExe);
    setCardAsset('win-zip', current.winZip);

    document.querySelectorAll('.rec-ribbon').forEach((rib) => {
      rib.textContent = dict.download.recRibbon;
    });

    const macCard = document.getElementById('card-dl-mac');
    const winCard = document.getElementById('card-dl-win-exe');
    const heroBtn = document.getElementById('hero-primary-dl-btn');
    const heroBtnLabel = document.getElementById('hero-primary-dl-label');

    if (os === 'mac' && latest.macDmg) {
      if (macCard) {
        macCard.classList.add('recommended');
        const rib = macCard.querySelector('.rec-ribbon');
        if (rib) rib.style.display = 'inline-block';
      }
      if (winCard) {
        winCard.classList.remove('recommended');
        const rib = winCard.querySelector('.rec-ribbon');
        if (rib) rib.style.display = 'none';
      }
      if (heroBtn && heroBtnLabel) {
        heroBtn.href = latest.macDmg.url;
        heroBtn.setAttribute('data-direct-dl', 'mac');
        heroBtn.setAttribute('data-filename', latest.macDmg.name);
        heroBtnLabel.textContent = dict.hero.dlMac.replace('{ver}', latest.version);
      }
    } else if (latest.winExe) {
      if (winCard) {
        winCard.classList.add('recommended');
        const rib = winCard.querySelector('.rec-ribbon');
        if (rib) rib.style.display = 'inline-block';
      }
      if (macCard && os === 'win') {
        macCard.classList.remove('recommended');
        const rib = macCard.querySelector('.rec-ribbon');
        if (rib) rib.style.display = 'none';
      }
      if (heroBtn && heroBtnLabel) {
        if (os === 'win') {
          heroBtn.href = latest.winExe.url;
          heroBtn.setAttribute('data-direct-dl', 'win');
          heroBtn.setAttribute('data-filename', latest.winExe.name);
          heroBtnLabel.textContent = dict.hero.dlWin.replace('{ver}', latest.version);
        } else {
          heroBtn.href = '#tai-xuong';
          heroBtn.removeAttribute('data-direct-dl');
          heroBtnLabel.textContent = dict.hero.dlGeneric.replace('{ver}', latest.version);
        }
      }
    }
  }

  function renderStudioModule(modKey) {
    activeModuleKey = modKey || 'director';
    const dict = getDict();
    const modules = dict.preview.modules || {};
    const mod = modules[activeModuleKey] || modules.director;

    document.querySelectorAll('.preview-tab-btn').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-module') === activeModuleKey);
    });

    setText('stage-kicker', mod.kicker);
    setText('stage-title', mod.title);
    setText('stage-desc', mod.desc);
    setText('stage-status', mod.status);

    const cardsEl = document.getElementById('stage-cards');
    if (cardsEl) {
      cardsEl.innerHTML = mod.cards
        .map(
          (c) => `
          <div class="stage-card">
            <div class="stage-card-label">${c.label}</div>
            <div class="stage-card-title">${c.title}</div>
            <div class="stage-card-text">${c.text}</div>
          </div>
        `
        )
        .join('');
    }

    const chipsEl = document.getElementById('stage-chips');
    if (chipsEl) {
      chipsEl.innerHTML = mod.chips.map((ch) => `<span class="chip">${ch}</span>`).join('');
    }
  }

  function renderTutorialSection() {
    const dict = getDict();
    const tut = dict.tutorial;
    setText('tut-section-tag', tut.tag);
    setText('tut-section-title', tut.title);
    setText('tut-section-desc', tut.desc);
    setText('tut-watch-note', tut.watchNote);

    const tabsWrap = document.getElementById('tutorial-tab-list');
    const tabs = tut.tabs || [];
    if (activeTutorialIndex >= tabs.length) activeTutorialIndex = 0;

    if (tabsWrap) {
      tabsWrap.innerHTML = tabs
        .map(
          (t, i) => `
          <button type="button" class="tutorial-tab-btn ${i === activeTutorialIndex ? 'active' : ''}" data-tut-idx="${i}">
            <div class="tut-tab-badge">${t.badge}</div>
            <div class="tut-tab-name">${t.name}</div>
          </button>
        `
        )
        .join('');

      tabsWrap.querySelectorAll('.tutorial-tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          activeTutorialIndex = Number(btn.getAttribute('data-tut-idx')) || 0;
          renderTutorialSection();
        });
      });
    }

    const currentEp = tabs[activeTutorialIndex] || tabs[0];
    if (!currentEp) return;

    const frameEl = document.getElementById('tutorial-video-frame');
    const chaptersEl = document.getElementById('tutorial-chapters-bar');

    if (frameEl) {
      const rawVideoUrl = VIDEO_TUTORIAL_URLS[currentEp.id] || '';
      const ytEmbed = toYouTubeEmbedUrl(rawVideoUrl);

      if (ytEmbed) {
        frameEl.innerHTML = `<iframe src="${ytEmbed}" title="${currentEp.headline}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
      } else if (rawVideoUrl) {
        frameEl.innerHTML = `<video src="${rawVideoUrl}" controls preload="metadata"></video>`;
      } else {
        frameEl.innerHTML = `
          <div class="tutorial-stage-card">
            <div class="tut-play-orb" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="#ffffff">
                <polygon points="8 5 19 12 8 19 8 5"></polygon>
              </svg>
            </div>
            <div class="tut-stage-badge">${currentEp.badge} • ${tut.comingSoonBadge}</div>
            <h3 class="tut-stage-headline">${currentEp.headline}</h3>
            <p class="tut-stage-summary">${currentEp.summary}</p>
          </div>
        `;
      }
    }

    if (chaptersEl) {
      chaptersEl.innerHTML = (currentEp.chapters || [])
        .map((ch) => `<span class="chapter-pill">${ch}</span>`)
        .join('');
    }
  }

  function applyLanguage(lang) {
    currentLang = SUPPORTED_LANGS.includes(lang) ? lang : 'vi';
    try {
      localStorage.setItem(LANG_STORAGE_KEY, currentLang);
    } catch (_) {}

    const dict = getDict();
    document.documentElement.setAttribute('lang', dict.langCode || currentLang);
    document.title = dict.pageTitle;

    // Language Switcher UI state
    setText('lang-current-label', dict.shortLabel);
    document.querySelectorAll('.lang-option-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-lang') === currentLang);
    });

    // Navbar
    setText('nav-link-download', dict.nav.download);
    setText('nav-link-features', dict.nav.features);
    setText('nav-link-tutorial', dict.nav.tutorial);
    setText('nav-link-workflow', dict.nav.workflow);
    setText('nav-link-install', dict.nav.install);
    setText('nav-cta-label', dict.nav.cta);
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) {
      themeBtn.setAttribute('title', dict.nav.themeTitle);
      themeBtn.setAttribute('aria-label', dict.nav.themeTitle);
    }

    // Hero
    setText('hero-eyebrow-prefix', dict.hero.eyebrowPrefix);
    setText('hero-eyebrow-suffix', dict.hero.eyebrowSuffix);
    setHtml('hero-title', dict.hero.titleHtml);
    setHtml('hero-subtitle', dict.hero.subtitleHtml);
    setText('hero-secondary-btn', dict.hero.secondaryBtn);
    setText('hero-meta-1', dict.hero.meta1);
    setText('hero-meta-2', dict.hero.meta2);
    setText('hero-meta-3', dict.hero.meta3);

    // Studio Preview Chrome
    setText('preview-window-title', dict.preview.windowTitle);
    setText('preview-ready-badge', dict.preview.readyBadge);
    setText('preview-group-creative', dict.preview.groupCreative);
    setText('preview-group-system', dict.preview.groupSystem);
    setText('tab-label-director', dict.preview.tabDirector);
    setText('tab-label-chat', dict.preview.tabChat);
    setText('tab-label-image', dict.preview.tabImage);
    setText('tab-label-video', dict.preview.tabVideo);
    setText('tab-label-voice', dict.preview.tabVoice);
    setText('tab-label-nle', dict.preview.tabNle);

    // Download Section static copy
    setText('dl-section-tag', dict.download.tag);
    setText('dl-section-title', dict.download.title);
    setText('dl-section-desc', dict.download.desc);
    setText('dl-select-label', dict.download.selectLabel);

    setText('dl-mac-title', dict.download.macTitle);
    setHtml('dl-mac-sub', dict.download.macSubHtml);
    setHtml(
      'dl-mac-specs',
      dict.download.macSpecs.map((s) => `<li>${s}</li>`).join('')
    );
    setText('dl-mac-btn-label', dict.download.macBtn);

    setText('dl-win-exe-title', dict.download.winExeTitle);
    setHtml('dl-win-exe-sub', dict.download.winExeSubHtml);
    setHtml(
      'dl-win-exe-specs',
      dict.download.winExeSpecs.map((s) => `<li>${s}</li>`).join('')
    );
    setText('dl-win-exe-btn-label', dict.download.winExeBtn);

    setText('dl-win-zip-title', dict.download.winZipTitle);
    setHtml('dl-win-zip-sub', dict.download.winZipSubHtml);
    setHtml(
      'dl-win-zip-specs',
      dict.download.winZipSpecs.map((s) => `<li>${s}</li>`).join('')
    );
    setText('dl-win-zip-btn-label', dict.download.winZipBtn);

    // Features Grid
    setText('feat-section-tag', dict.features.tag);
    setText('feat-section-title', dict.features.title);
    setText('feat-section-desc', dict.features.desc);
    dict.features.items.forEach((item, idx) => {
      const n = idx + 1;
      setText(`feat-title-${n}`, item.title);
      setText(`feat-text-${n}`, item.text);
      setHtml(
        `feat-bullets-${n}`,
        item.bullets.map((b) => `<li>${b}</li>`).join('')
      );
    });

    // Workflow 4 Steps
    setText('wf-section-tag', dict.workflow.tag);
    setText('wf-section-title', dict.workflow.title);
    setText('wf-section-desc', dict.workflow.desc);
    dict.workflow.steps.forEach((st, idx) => {
      const n = idx + 1;
      setText(`wf-step-title-${n}`, st.title);
      setText(`wf-step-desc-${n}`, st.desc);
    });

    // Installation Guide
    setText('ins-section-tag', dict.install.tag);
    setText('ins-section-title', dict.install.title);
    setText('ins-section-desc', dict.install.desc);
    setText('ins-win-title', dict.install.winTitle);
    setHtml(
      'ins-win-steps',
      dict.install.winStepsHtml.map((s) => `<li>${s}</li>`).join('')
    );
    setText('ins-mac-title', dict.install.macTitle);
    setHtml(
      'ins-mac-steps',
      dict.install.macStepsHtml.map((s) => `<li>${s}</li>`).join('')
    );
    setText('copy-mac-cmd-btn', dict.install.copyBtn);

    // Footer
    setText('footer-tagline', dict.footer.tagline);
    setText('footer-note', dict.footer.note);

    // Re-render dynamic modules
    renderStudioModule(activeModuleKey);
    renderTutorialSection();
    renderReleaseUI();
  }

  function initLanguageSwitcher() {
    const trigger = document.getElementById('lang-trigger-btn');
    const menu = document.getElementById('lang-menu');
    if (!trigger || !menu) return;

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('open');
    });

    document.querySelectorAll('.lang-option-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const chosen = btn.getAttribute('data-lang') || 'vi';
        menu.classList.remove('open');
        applyLanguage(chosen);
      });
    });

    document.addEventListener('click', () => {
      menu.classList.remove('open');
    });
  }

  function initThemeToggle() {
    const saved = localStorage.getItem('dstudio_web_theme');
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.setAttribute('data-theme', saved);
    }

    const btn = document.getElementById('theme-toggle-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      const next = cur === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      try {
        localStorage.setItem('dstudio_web_theme', next);
      } catch (_) {}
    });
  }

  function initCopyCommand() {
    const copyBtn = document.getElementById('copy-mac-cmd-btn');
    if (!copyBtn) return;
    copyBtn.addEventListener('click', async () => {
      const dict = getDict();
      const cmd = 'xattr -dr com.apple.quarantine "/Applications/D-Studio.app"';
      try {
        await navigator.clipboard.writeText(cmd);
        copyBtn.textContent = dict.install.copiedBtn;
        setTimeout(() => {
          copyBtn.textContent = getDict().install.copyBtn;
        }, 2000);
      } catch (_) {}
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initThemeToggle();
    initLanguageSwitcher();
    initCopyCommand();

    const selectEl = document.getElementById('version-select');
    if (selectEl) {
      selectEl.addEventListener('change', (e) => {
        selectedReleaseIndex = Number(e.target.value) || 0;
        renderReleaseUI();
      });
    }

    document.querySelectorAll('.preview-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        renderStudioModule(btn.getAttribute('data-module') || 'director');
      });
    });

    applyLanguage(detectInitialLang());
    bindDirectDownloadTriggers();
    loadLatestReleases();
  });
})();
