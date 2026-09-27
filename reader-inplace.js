(async () => {
  // 1. Toggle off cleanly if active
  if (window.__readerViewActive) {
    if (typeof window.__readerViewRestore === "function") {
      window.__readerViewRestore();
    }
    return;
  }

  // Prevent race condition on rapid clicks/shortcuts
  if (window.__readerViewInjecting) return;
  window.__readerViewInjecting = true;

  try {
    // 2. Resolve Readability
    const ReadabilityClass = window.Readability || globalThis.Readability;
    if (!ReadabilityClass) {
      console.error("Readability library is not present.");
      return;
    }

    const documentClone = document.cloneNode(true);
    const reader = new ReadabilityClass(documentClone, {
      charThreshold: 0,
      classesToPreserve: ["hljs", "code", "pre"]
    });

    const article = reader.parse();
    if (!article) {
      console.warn("Readability: No readable content found on this page.");
      return;
    }

    // 3. Register Custom Fonts (Percent-Encoded CSS + Non-blocking Memory Load)
    const fontDefinitions = [
      // Bookerly
      { family: "CustomBookerly", file: "Bookerly Light.ttf", weight: "200", style: "normal" },
      { family: "CustomBookerly", file: "Bookerly Light Italic.ttf", weight: "200", style: "italic" },
      { family: "CustomBookerly", file: "Bookerly.ttf", weight: "400", style: "normal" },
      { family: "CustomBookerly", file: "Bookerly Italic.ttf", weight: "400", style: "italic" },
      { family: "CustomBookerly", file: "Bookerly Bold.ttf", weight: "700", style: "normal" },
      { family: "CustomBookerly", file: "Bookerly Bold Italic.ttf", weight: "700", style: "italic" },
      // Georgia
      { family: "CustomGeorgia", file: "georgia.ttf", weight: "400", style: "normal" },
      { family: "CustomGeorgia", file: "georgiab.ttf", weight: "700", style: "normal" },
      { family: "CustomGeorgia", file: "georgiai.ttf", weight: "400", style: "italic" },
      { family: "CustomGeorgia", file: "georgiaz.ttf", weight: "700", style: "italic" },
      // Cheltenham
      { family: "CustomCheltenham", file: "Cheltenham Light.ttf", weight: "200", style: "normal" },
      { family: "CustomCheltenham", file: "Cheltenham LightItalic.ttf", weight: "200", style: "italic" },
      { family: "CustomCheltenham", file: "Cheltenham Book.ttf", weight: "400", style: "normal" },
      { family: "CustomCheltenham", file: "Cheltenham BookItalic.ttf", weight: "400", style: "italic" },
      { family: "CustomCheltenham", file: "Cheltenham Bold.otf", weight: "700", style: "normal" },
      { family: "CustomCheltenham", file: "Cheltenham Bold Italic.otf", weight: "700", style: "italic" }
    ];

    if (!document.getElementById("reader-custom-fonts")) {
      const fontStyle = document.createElement("style");
      fontStyle.id = "reader-custom-fonts";
      fontStyle.textContent = fontDefinitions.map(f => `
        @font-face {
          font-family: "${f.family}";
          src: url("${encodeURI(browser.runtime.getURL("fonts/" + f.file))}");
          font-weight: ${f.weight};
          font-style: ${f.style};
        }
      `).join("\n");
      document.documentElement.appendChild(fontStyle);
    }

    // Background FontFace ingestion
    if (!window.__readerFontsBinaryLoaded) {
      window.__readerFontsBinaryLoaded = true;
      Promise.all(
        fontDefinitions.map(async (f) => {
          try {
            const url = browser.runtime.getURL("fonts/" + encodeURIComponent(f.file));
            const res = await fetch(url);
            if (res.ok) {
              const buffer = await res.arrayBuffer();
              const face = new FontFace(f.family, buffer, { weight: f.weight, style: f.style });
              await face.load();
              document.fonts.add(face);
            }
          } catch (_) { }
        })
      ).catch(() => { });
    }

    // 4. Retrieve Persisted Preferences with Strict Numeric Sanitization
    const defaultSettings = {
      theme: "theme-dark",
      fontFamily: "font-bookerly",
      fontWeight: "400",
      fontSize: 18,
      width: 62,
      lineHeight: 1.55
    };

    let stored = {};
    try {
      stored = await browser.storage.local.get("readerSettings");
    } catch (_) { }
    const raw = Object.assign({}, defaultSettings, stored.readerSettings || {});

    const allowedWeights = ["200", "400", "700"];
    const rawWeight = String(raw.fontWeight || "400");

    const settings = {
      theme: raw.theme || "theme-dark",
      fontFamily: raw.fontFamily || "font-bookerly",
      fontWeight: allowedWeights.includes(rawWeight) ? rawWeight : "400",
      fontSize: parseInt(raw.fontSize, 10) || 18,
      width: Math.max(26, Math.min(80, parseInt(raw.width, 10) || 62)),
      lineHeight: Math.max(1.1, Math.min(2.3, parseFloat(raw.lineHeight) || 1.55))
    };

    const saveSettings = async (updates) => {
      Object.assign(settings, updates);
      try {
        await browser.storage.local.set({ readerSettings: settings });
      } catch (_) { }
    };

    // 5. Metadata, Scroll Cache & Native Time Estimation
    window.__originalTitle = document.title;
    window.__originalBodyDisplay = document.body.style.display;
    window.__originalScrollY = window.scrollY;

    const cleanHostname = window.location.hostname.replace(/^www\./, "");
    const words = (article.textContent || "").trim().split(/\s+/).filter(Boolean).length;

    let readingTimeText = "1 minute";
    if (words >= 180) {
      const minTime = Math.max(1, Math.round(words / 200));
      const maxTime = Math.max(minTime + 1, Math.round(words / 150));
      readingTimeText = `${minTime}–${maxTime} minutes`;
    }

    // 6. Build Overlay
    const readerRoot = document.createElement("div");
    readerRoot.id = "reader-root";
    readerRoot.tabIndex = -1;
    readerRoot.className = `${settings.theme} ${settings.fontFamily}`;
    readerRoot.style.setProperty("--font-step", `${settings.fontSize}px`);
    readerRoot.style.setProperty("--font-weight", settings.fontWeight);
    readerRoot.style.setProperty("--content-width", `${settings.width}ch`);
    readerRoot.style.setProperty("--line-height", settings.lineHeight);

    readerRoot.innerHTML = `
      <nav id="reader-toolbar">
        <button id="btn-close" class="reader-tool-btn" title="Close Reader View (Esc)">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z"/>
          </svg>
        </button>
        <button id="btn-text-panel" class="reader-tool-btn" title="Text and Layout">Aa</button>
        <button id="btn-theme-panel" class="reader-tool-btn" title="Theme">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 4h-1V3c0-.55-.45-1-1-1H7c-.55 0-1 .45-1 1v5c0 .55.45 1 1 1h10c.55 0 1-.45 1-1V7h1c.55 0 1 .45 1 1v3c0 1.1-.9 2-2 2h-4c-1.1 0-2 .9-2 2v2.17c-.6-.35-1.27-.57-2-.57-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4v-2c0-.55.45-1 1-1h3c2.21 0 4-1.79 4-4V8c0-2.21-1.79-4-4-4z"/>
          </svg>
        </button>
      </nav>

      <!-- Text & Layout Popup -->
      <div id="text-popup" class="reader-popup reader-hidden">
        <div class="reader-popup-title">Text</div>
        <div class="reader-control-row">
          <label>Text size</label>
          <div class="reader-stepper">
            <button id="btn-size-dec" class="reader-step-btn" title="Decrease Size">−</button>
            <button id="btn-size-inc" class="reader-step-btn" title="Increase Size">+</button>
          </div>
        </div>
        <div class="reader-control-grid">
          <div class="reader-select-group">
            <label for="font-family-select">Font</label>
            <select id="font-family-select">
              <option value="font-bookerly" class="opt-bookerly">Bookerly</option>
              <option value="font-cheltenham" class="opt-cheltenham">Cheltenham</option>
              <option value="font-georgia" class="opt-georgia">Georgia</option>
              <option value="font-sans" class="opt-sans">Sans-serif</option>
              <option value="font-charter" class="opt-charter">Charter</option>
              <option value="font-garamond" class="opt-garamond">Garamond</option>
              <option value="font-palatino" class="opt-palatino">Palatino</option>
              <option value="font-mono" class="opt-mono">Monospace</option>
            </select>
          </div>
          <div class="reader-select-group">
            <label for="font-weight-select">Font weight</label>
            <select id="font-weight-select">
              <option value="200">Light</option>
              <option value="400">Regular</option>
              <option value="700">Bold</option>
            </select>
          </div>
        </div>

        <hr class="reader-popup-divider">
        <div class="reader-popup-title">Layout</div>

        <!-- Width Slider (10 Steps: 26ch to 80ch) -->
        <div class="reader-slider-block">
          <div class="reader-slider-label">Content width</div>
          <div class="reader-slider-row">
            <span class="reader-slider-icon">|↔|</span>
            <div class="reader-slider-wrap">
              <input type="range" id="width-slider" min="26" max="80" step="6" value="${settings.width}">
              <div class="reader-ticks">
                <span class="reader-tick"></span><span class="reader-tick"></span>
                <span class="reader-tick"></span><span class="reader-tick"></span>
                <span class="reader-tick"></span><span class="reader-tick"></span>
                <span class="reader-tick"></span><span class="reader-tick"></span>
                <span class="reader-tick"></span><span class="reader-tick"></span>
              </div>
            </div>
          </div>
        </div>

        <!-- Line Spacing Slider (9 Steps) -->
        <div class="reader-slider-block">
          <div class="reader-slider-label">Line spacing</div>
          <div class="reader-slider-row">
            <span class="reader-slider-icon">|↕|</span>
            <div class="reader-slider-wrap">
              <input type="range" id="line-height-slider" min="1.1" max="2.3" step="0.15" value="${settings.lineHeight}">
              <div class="reader-ticks">
                <span class="reader-tick"></span><span class="reader-tick"></span>
                <span class="reader-tick"></span><span class="reader-tick"></span>
                <span class="reader-tick"></span><span class="reader-tick"></span>
                <span class="reader-tick"></span><span class="reader-tick"></span>
                <span class="reader-tick"></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Theme Popup -->
      <div id="theme-popup" class="reader-popup reader-hidden">
        <div class="reader-popup-title">Theme</div>
        <div class="reader-theme-tabs">
          <button class="reader-theme-tab active">Default</button>
        </div>
        <div class="reader-theme-grid">
          <button class="reader-theme-btn" data-theme="theme-auto"><span class="reader-circle circle-auto"></span> Auto</button>
          <button class="reader-theme-btn" data-theme="theme-light"><span class="reader-circle circle-light"></span> Light</button>
          <button class="reader-theme-btn active" data-theme="theme-dark"><span class="reader-circle circle-dark"></span> Dark</button>
          <button class="reader-theme-btn" data-theme="theme-sepia"><span class="reader-circle circle-sepia"></span> Sepia</button>
          <button class="reader-theme-btn" data-theme="theme-contrast"><span class="reader-circle circle-contrast"></span> Contrast</button>
          <button class="reader-theme-btn" data-theme="theme-gray"><span class="reader-circle circle-gray"></span> Gray</button>
        </div>
      </div>

      <main id="reader-container">
        <header>
          <a id="reader-source"></a>
          <h1 id="reader-title"></h1>
          <div id="reader-byline"></div>
          <div id="reader-reading-time"></div>
          <hr class="reader-header-separator">
        </header>
        <article id="reader-content">${article.content}</article>
      </main>
    `;

    // 7. XSS-Safe Metadata Assignment
    const sourceEl = readerRoot.querySelector("#reader-source");
    sourceEl.href = window.location.href;
    sourceEl.textContent = cleanHostname;

    const titleEl = readerRoot.querySelector("#reader-title");
    titleEl.textContent = article.title;

    const bylineEl = readerRoot.querySelector("#reader-byline");
    if (article.byline) {
      bylineEl.textContent = article.byline;
    } else {
      bylineEl.remove();
    }

    const timeEl = readerRoot.querySelector("#reader-reading-time");
    timeEl.textContent = readingTimeText;

    // Fix lazy-loaded images
    readerRoot.querySelectorAll("#reader-content img").forEach((img) => {
      if (!img.src || img.src.startsWith("data:image")) {
        const realSrc = img.dataset.src || img.dataset.lazySrc || img.dataset.original;
        if (realSrc) img.src = realSrc;
      }
    });

    document.documentElement.appendChild(readerRoot);
    document.body.style.display = "none";
    document.title = article.title;

    setTimeout(() => {
      window.focus();
      readerRoot.focus();
    }, 10);

    const fontSelect = readerRoot.querySelector("#font-family-select");
    const weightSelect = readerRoot.querySelector("#font-weight-select");
    fontSelect.value = settings.fontFamily;
    weightSelect.value = settings.fontWeight;

    const themeBtns = readerRoot.querySelectorAll(".reader-theme-btn");
    themeBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.theme === settings.theme);
    });

    window.__readerViewActive = true;

    // 8. Popover Controls Setup
    const popups = {
      text: { btn: readerRoot.querySelector("#btn-text-panel"), el: readerRoot.querySelector("#text-popup") },
      theme: { btn: readerRoot.querySelector("#btn-theme-panel"), el: readerRoot.querySelector("#theme-popup") }
    };

    function closeAllPopups() {
      Object.values(popups).forEach(({ btn, el }) => {
        el?.classList.add("reader-hidden");
        btn?.classList.remove("active");
      });
    }

    function togglePopup(key) {
      const target = popups[key];
      if (!target.el) return;
      const isHidden = target.el.classList.contains("reader-hidden");
      closeAllPopups();
      if (isHidden) {
        target.el.classList.remove("reader-hidden");
        target.btn.classList.add("active");
      }
    }

    // 9. Escape Handler & Instant Restoration
    const onKeydown = (e) => {
      if (e.key === "Escape" || e.code === "Escape" || e.keyCode === 27) {
        e.preventDefault();
        e.stopImmediatePropagation();

        const openPopup = Object.values(popups).find(p => p.el && !p.el.classList.contains("reader-hidden"));
        if (openPopup) {
          closeAllPopups();
        } else {
          window.__readerViewRestore();
        }
      }
    };

    const onPopState = () => {
      if (window.__readerViewActive) {
        window.__readerViewRestore();
      }
    };

    window.__readerViewRestore = () => {
      window.removeEventListener("keydown", onKeydown, true);
      document.removeEventListener("keydown", onKeydown, true);
      readerRoot.removeEventListener("keydown", onKeydown, true);
      window.removeEventListener("popstate", onPopState);

      const root = document.getElementById("reader-root");
      if (root) root.remove();

      document.body.style.display = window.__originalBodyDisplay || "";
      document.title = window.__originalTitle;
      window.scrollTo(0, window.__originalScrollY || 0);
      window.__readerViewActive = false;
    };

    window.addEventListener("keydown", onKeydown, true);
    document.addEventListener("keydown", onKeydown, true);
    readerRoot.addEventListener("keydown", onKeydown, true);
    window.addEventListener("popstate", onPopState);

    readerRoot.querySelector("#btn-close")?.addEventListener("click", window.__readerViewRestore);

    popups.text.btn?.addEventListener("click", (e) => { e.stopPropagation(); togglePopup("text"); });
    popups.theme.btn?.addEventListener("click", (e) => { e.stopPropagation(); togglePopup("theme"); });

    readerRoot.addEventListener("click", (e) => {
      if (!e.target.closest(".reader-popup") && !e.target.closest("#reader-toolbar")) {
        closeAllPopups();
      }
    });

    Object.values(popups).forEach(({ el }) => {
      el?.addEventListener("click", (e) => e.stopPropagation());
    });

    // 10. Input & Typography Change Listeners
    const fontClasses = [
      "font-bookerly",
      "font-cheltenham",
      "font-georgia",
      "font-sans",
      "font-charter",
      "font-garamond",
      "font-palatino",
      "font-mono"
    ];

    fontSelect?.addEventListener("change", (e) => {
      fontClasses.forEach(cls => readerRoot.classList.remove(cls));
      readerRoot.classList.add(e.target.value);
      saveSettings({ fontFamily: e.target.value });
    });

    weightSelect?.addEventListener("change", (e) => {
      readerRoot.style.setProperty("--font-weight", e.target.value);
      saveSettings({ fontWeight: e.target.value });
    });

    let currentSize = settings.fontSize;
    const updateFontSize = (delta) => {
      currentSize = Math.max(12, Math.min(56, currentSize + delta));
      readerRoot.style.setProperty("--font-step", `${currentSize}px`);
      saveSettings({ fontSize: currentSize });
    };

    readerRoot.querySelector("#btn-size-inc")?.addEventListener("click", (e) => {
      e.stopPropagation();
      updateFontSize(2);
    });

    readerRoot.querySelector("#btn-size-dec")?.addEventListener("click", (e) => {
      e.stopPropagation();
      updateFontSize(-2);
    });

    readerRoot.querySelector("#width-slider")?.addEventListener("input", (e) => {
      const val = parseInt(e.target.value, 10) || 62;
      readerRoot.style.setProperty("--content-width", `${val}ch`);
      saveSettings({ width: val });
    });

    readerRoot.querySelector("#line-height-slider")?.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value) || 1.55;
      readerRoot.style.setProperty("--line-height", val);
      saveSettings({ lineHeight: val });
    });

    themeBtns.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        themeBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        readerRoot.classList.remove("theme-auto", "theme-light", "theme-dark", "theme-sepia", "theme-contrast", "theme-gray");
        readerRoot.classList.add(btn.dataset.theme);
        saveSettings({ theme: btn.dataset.theme });
      });
    });

  } finally {
    window.__readerViewInjecting = false;
  }
})();