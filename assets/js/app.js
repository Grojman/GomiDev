(() => {
  "use strict";

  const PAGES = ["home", "games", "software", "books", "about", "media"];
  const SITE = "https://gomidev.es/";
  const PAGE_FILES = {
    home: "./",
    games: "games.html",
    software: "software.html",
    books: "books.html",
    about: "about.html",
    media: "media.html",
  };
  const page = document.body.dataset.page || "home";
  document.body.classList.add("loading");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ------------------------------------------------------------------ language

  function initialLang() {
    const fromQuery = new URLSearchParams(location.search).get("lang");
    if (fromQuery === "es" || fromQuery === "en") return fromQuery;
    try {
      const saved = localStorage.getItem("lang");
      if (saved === "es" || saved === "en") return saved;
    } catch (_) {}
    return "es";
  }

  let lang = initialLang();
  const t = (key) => (I18N[lang] && I18N[lang][key]) ?? I18N.es[key] ?? key;
  const pick = (value) => (value && typeof value === "object" ? value[lang] ?? value.es ?? value.en : value);

  function setLang(next) {
    lang = next;
    try {
      localStorage.setItem("lang", next);
    } catch (_) {}
    // keep the address bar on the URL search engines index for this language
    history.replaceState(null, "", location.pathname + langQuery() + location.hash);
    render();
  }

  // Spanish lives at the plain URL, English at ?lang=en (see the hreflang links and sitemap.xml).
  const langQuery = () => (lang === "en" ? "?lang=en" : "");
  const pageHref = (p) => PAGE_FILES[p] + langQuery();

  // ------------------------------------------------------------------ SEO

  function setMeta(selector, attr, value) {
    const el = document.head.querySelector(selector);
    if (el) el.setAttribute(attr, value);
  }

  function updateMeta() {
    const title = t(`meta.${page}.title`);
    const description = t(`meta.${page}.description`);
    const url = SITE + (page === "home" ? "" : PAGE_FILES[page]) + langQuery();
    document.title = title;
    setMeta('meta[name="description"]', "content", description);
    setMeta('meta[property="og:title"]', "content", title);
    setMeta('meta[property="og:description"]', "content", description);
    setMeta('meta[property="og:url"]', "content", url);
    setMeta('meta[property="og:locale"]', "content", lang === "en" ? "en_US" : "es_ES");
    setMeta('meta[property="og:locale:alternate"]', "content", lang === "en" ? "es_ES" : "en_US");
    // The canonical depends on the language, so it is only ever set here (never in the static HTML).
    let canonical = document.head.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = url;
  }

  // ------------------------------------------------------------------ helpers

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const link = (href) =>
    href ? `<a class="url" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(href)}</a>` : "";

  // Terminal palette: list items cycle through accents so neighbours never share a color.
  const ACCENTS = 6;
  const accent = (i) => `c${i % ACCENTS}`;
  const STATUS_CLASS = { wip: "st-wip", released: "st-done", published: "st-done", writing: "st-writing" };

  const date = (iso) => (iso ? String(iso).slice(0, 10) : "");

  function ascii(text, label, cls = "") {
    if (!text) return "";
    const cols = Math.max(...text.split("\n").map((l) => [...l].length));
    const aria = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
    return `<div class="ascii-wrap"><pre class="ascii ${cls}" style="--cols:${cols}" ${aria}>${esc(text)}</pre></div>`;
  }

  // key/value rows, like `git config --list` output
  function kv(rows) {
    const body = rows
      .filter(([, v]) => v)
      .map(([k, v]) => `<dt>${esc(k)}:</dt><dd>${v}</dd>`)
      .join("");
    return body ? `<dl class="kv">${body}</dl>` : "";
  }

  const cmd = (text) => `<p class="cmd"><span class="prompt">${esc(t("nav.prompt"))}</span> ${esc(text)}</p>`;
  const rule = (title, cls = "") => `<h2 class="rule ${cls}"><span>${esc(title)}</span></h2>`;
  const empty = (text = t("empty")) => `<p class="empty">${esc(text)}</p>`;

  // ------------------------------------------------------------------ data

  const dataPromise = fetch("data/content.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .catch(() => null);

  const textCache = {};
  const loadText = (path) =>
    (textCache[path] ??= fetch(path)
      .then((r) => (r.ok ? r.text() : ""))
      .then((s) => s.replace(/\s+$/, ""))
      .catch(() => ""));

  // ------------------------------------------------------------------ chrome

  function langToggle() {
    return `<span class="lang" role="group" aria-label="${esc(t("nav.lang"))}">[${["es", "en"]
      .map(
        (l) =>
          `<button type="button" data-lang="${l}" aria-pressed="${l === lang}"${l === lang ? ' class="active"' : ""}>${l.toUpperCase()}</button>`,
      )
      .join("|")}]</span>`;
  }

  function renderNav() {
    const nav = document.getElementById("nav");
    if (page === "home") {
      nav.innerHTML = `<div class="topbar"><span></span>${langToggle()}</div>`;
      return;
    }
    const links = PAGES.map(
      (p) =>
        `<a class="sec-${p}" href="${pageHref(p)}"${p === page ? ' aria-current="page"' : ""}>${esc(t("nav." + p))}</a>`,
    ).join(" ");
    nav.innerHTML = `<nav class="topbar" aria-label="main">
      <div class="nav-links"><span class="prompt">${esc(t("nav.prompt"))}</span> ${esc(t("nav.cd"))} ${links}</div>
      ${langToggle()}
    </nav>`;
  }

  function renderFooter(data) {
    const year = new Date().getFullYear();
    const sync = data?.generated_at ? ` · ${esc(t("footer.sync"))}: ${esc(date(data.generated_at))}` : "";
    document.getElementById("footer").innerHTML = `
      <p>&copy; ${year} GomiDev. ${esc(t("footer.rights"))}</p>
      <p>${esc(t("footer.made"))}${sync}</p>
      <div class="term-log" aria-live="polite">${termLog.map(termEntry).join("")}</div>
      <form class="term" id="term">
        <label class="prompt" for="term-input">${esc(t("nav.prompt"))}</label>
        <span class="cursor" aria-hidden="true">█</span>
        <input id="term-input" type="text" placeholder=" " aria-label="${esc(t("term.label"))}"
          autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go" />
      </form>`;
  }

  // ------------------------------------------------------------------ terminal

  // Every command printed somewhere on the site (loader animations and page headers) opens its page.
  const COMMANDS = {};
  for (const p of PAGES) {
    COMMANDS[LOADERS[p].cmd] = p;
    for (const l of Object.keys(I18N)) COMMANDS[I18N[l][p === "home" ? "home.ls" : `${p}.cmd`]] = p;
  }
  const KNOWN = new Set(Object.keys(COMMANDS).map((c) => c.split(" ")[0]));
  const HOME_DIRS = ["~", "..", "/", "~/gomidev"];

  function helpOutput() {
    const nav = (p) => t("nav." + p);
    const rows = [
      ["help", t("term.help.help")],
      ["clear", t("term.help.clear")],
      ["cd <dir>", `${t("term.help.cd")} ${PAGES.map(nav).join(", ")}`],
      ...Object.entries(COMMANDS).map(([c, p]) => [c, `→ ${nav(p)}`]),
    ];
    return `<p>${esc(t("term.help.title"))}</p><dl class="kv help">${rows
      .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
      .join("")}</dl>`;
  }

  // -> { page } to navigate, { clear } to wipe the log, or { html } / { error } to print
  function resolveCommand(text) {
    const [name, ...args] = text.split(" ");
    if (name === "help") return { html: helpOutput() };
    if (name === "clear") return { clear: true };
    if (name === "cd") {
      const arg = args[0] ?? "~";
      const dir = arg.length > 1 ? arg.replace(/\/$/, "") : arg;
      if (HOME_DIRS.includes(dir)) return { page: "home" };
      const leaf = dir.replace(/^(~\/gomidev\/|~\/|\.\/)/, "");
      const target = PAGES.find((p) => [p, ...Object.values(I18N).map((l) => l["nav." + p])].includes(leaf));
      return target ? { page: target } : { error: `bash: cd: ${arg}: ${t("term.noDir")}` };
    }
    if (Object.hasOwn(COMMANDS, text)) return { page: COMMANDS[text] };
    return { error: `bash: ${name}: ${t(KNOWN.has(name) ? "term.denied" : "term.notFound")}` };
  }

  // commands that printed something, kept so the log survives a language switch
  const termLog = [];
  const termEntry = (text) => {
    const result = resolveCommand(text);
    return cmd(text) + (result.html ?? `<p class="error">${esc(result.error)}</p>`);
  };

  function runCommand(input) {
    const text = input.value.trim().replace(/\s+/g, " ");
    input.value = "";
    if (!text) return;
    const result = resolveCommand(text);
    if (result.page) {
      location.href = pageHref(result.page);
      return;
    }
    const log = document.querySelector(".term-log");
    if (result.clear) {
      termLog.length = 0;
      log.innerHTML = "";
      return;
    }
    termLog.push(text);
    log.insertAdjacentHTML("beforeend", termEntry(text));
    input.scrollIntoView({ block: "nearest" });
  }

  // ------------------------------------------------------------------ pages

  async function homePage() {
    const [banner, logo] = await Promise.all([loadText("assets/ascii/banner.txt"), loadText("assets/ascii/logo.txt")]);
    const sections = PAGES.filter((p) => p !== "home")
      .map(
        (p) => `<li class="sec-${p}"><a href="${pageHref(p)}">
          <span class="perm">drwxr-xr-x</span>
          <span class="dir">${esc(t("nav." + p))}/</span>
          <span class="desc">${esc(t("section." + p))}</span></a></li>`,
      )
      .join("");
    return `
      <section class="hero">
        <p class="welcome">${esc(t("home.welcome"))}</p>
        ${ascii(banner, "GomiDev", "banner")}
        ${ascii(logo, "GomiDev logo")}
        <p class="bio">${esc(t("home.description"))}</p>
      </section>
      <section class="sections">
        ${cmd(t("home.ls"))}
        <ul class="ls">${sections}</ul>
        <p class="hint">${esc(t("home.hint"))}</p>
      </section>`;
  }

  function projectEntry(item, statusKey, index) {
    const status = statusKey
      ? `<span class="badge ${STATUS_CLASS[item.status] || ""}">[${esc(t("status." + item.status))}]</span>`
      : "";
    return `<article class="entry ${accent(index)}">
      ${item.ascii ? ascii(item.ascii) : ""}
      <div class="entry-body">
        <h3><span class="title">&gt; ${esc(item.title)}</span> ${status}</h3>
        ${item.description ? `<p>${esc(pick(item.description))}</p>` : ""}
        ${kv([
          [t("field.itch"), link(item.itch)],
          [t("field.web"), link(item.website)],
          [t("field.repo"), link(item.repo_url)],
          [t("field.link"), link(item.url)],
          [t("field.lang"), esc(item.language)],
          [t("field.updated"), esc(date(item.updated))],
        ])}
      </div>
    </article>`;
  }

  function grouped(items, groups) {
    return groups
      .map(([status, title, emptyText]) => {
        const list = items.filter((i) => (i.status || groups[0][0]) === status);
        return (
          rule(title, STATUS_CLASS[status]) +
          (list.length ? list.map((item, i) => projectEntry(item, true, i)).join("") : empty(emptyText))
        );
      })
      .join("");
  }

  function gamesPage(data) {
    const profiles = kv([
      ["itch.io", link(data.profiles?.itch)],
      ["github", link(data.profiles?.github)],
    ]);
    return (
      cmd(t("games.cmd")) +
      profiles +
      grouped(data.games || [], [
        ["wip", t("games.wip")],
        ["released", t("games.released")],
      ])
    );
  }

  function softwarePage(data) {
    const items = data.software || [];
    return (
      cmd(t("software.cmd")) +
      kv([["github", link(data.profiles?.github)]]) +
      rule(`${items.length} pkgs`) +
      (items.length ? items.map((item, i) => projectEntry(item, false, i)).join("") : empty())
    );
  }

  function booksPage(data) {
    return (
      cmd(t("books.cmd")) +
      kv([[t("books.store"), link(data.profiles?.amazon)]]) +
      grouped(data.books || [], [
        ["writing", t("books.writing"), t("books.empty")],
        ["published", t("books.published"), t("books.empty")],
      ])
    );
  }

  async function aboutPage(data) {
    const logo = await loadText("assets/ascii/logo.txt");
    const socials = ["github", "youtube", "instagram", "tiktok", "itch", "amazon"]
      .map((k) => [k, link(data?.profiles?.[k])]);
    return `
      ${cmd(t("about.cmd"))}
      <div class="about">
        ${ascii(logo, "GomiDev logo")}
        <div>
          ${kv(["name", "role", "location", "languages", "interests"].map((k) => [t("about." + k), esc(t("about.v." + k))]))}
          <p>${esc(t("about.bio"))}</p>
          <p>${esc(t("about.contact"))}</p>
          ${kv(socials)}
        </div>
      </div>`;
  }

  function mediaPage(data) {
    const media = data.media || {};
    return (
      cmd(t("media.cmd")) +
      ["youtube", "instagram", "tiktok", "github"]
        .map((platform) => {
          const feed = media[platform] || {};
          const items = feed.items || [];
          let body;
          if (!feed.url) body = empty(t("media.notConfigured"));
          else if (!items.length) body = kv([[t("field.profile"), link(feed.url)]]) + empty();
          else
            body =
              kv([[t("field.profile"), link(feed.url)]]) +
              `<p class="sub">${esc(t("media." + platform))}:</p>` +
              `<div class="${items.some((i) => i.ascii) ? "cards" : "list"}">` +
              items
                .map(
                  (i, n) => `<article class="card ${accent(n)}">
                    ${ascii(i.ascii)}
                    <h3 class="title">${esc(i.title || "—")}</h3>
                    ${i.description ? `<p>${esc(i.description)}</p>` : ""}
                    ${kv([
                      [t("field.updated"), esc(date(i.date))],
                      [t("field.link"), link(i.url)],
                    ])}
                  </article>`,
                )
                .join("") +
              `</div>`;
          return rule(platform, `pf-${platform}`) + body;
        })
        .join("")
    );
  }

  const RENDERERS = {
    home: homePage,
    games: gamesPage,
    software: softwarePage,
    books: booksPage,
    about: aboutPage,
    media: mediaPage,
  };

  async function render() {
    document.documentElement.lang = lang;
    updateMeta();
    const data = await dataPromise;
    renderNav();
    renderFooter(data);
    const main = document.getElementById("main");
    if (!data && page !== "home" && page !== "about") {
      main.innerHTML = `<p class="error">${esc(t("error.load"))}</p>`;
      return;
    }
    main.innerHTML = await RENDERERS[page](data || {});
  }

  // ------------------------------------------------------------------ loader

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function runLoader() {
    const loader = document.getElementById("loader");
    const spec = LOADERS[page];
    if (!loader || !spec || reducedMotion) return;

    let skipped = false;
    const skip = () => (skipped = true);
    const wait = (ms) => (skipped ? Promise.resolve() : sleep(ms));
    ["keydown", "pointerdown"].forEach((e) => window.addEventListener(e, skip, { once: true }));

    loader.hidden = false;
    loader.innerHTML = `<div class="loader-log"><p class="cmd"><span class="prompt">&gt;</span> <span class="typed"></span><span class="cursor">█</span></p></div>
      <p class="loader-skip">${esc(t("loader.skip"))}</p>`;
    const log = loader.querySelector(".loader-log");
    const typed = loader.querySelector(".typed");

    for (const ch of spec.cmd) {
      if (skipped) break;
      typed.textContent += ch;
      await wait(14);
    }
    typed.textContent = spec.cmd;
    loader.querySelector(".cursor").remove();

    const spin = "|/-\\";
    for (const [text, kind] of spec.steps[lang] || spec.steps.es) {
      const line = document.createElement("p");
      log.appendChild(line);
      const frames = kind === "bar" ? 10 : 6;
      for (let f = 0; f <= frames && !skipped; f++) {
        if (kind === "spin") line.textContent = `  ${spin[f % 4]} ${text}`;
        else if (kind === "dots") line.textContent = `  ${text}${".".repeat((f % 3) + 1)}`;
        else line.textContent = `  ${text} [${"#".repeat(f * 2).padEnd(20, ".")}] ${String(f * 10).padStart(3)}%`;
        await wait(kind === "bar" ? 45 : 70);
      }
      line.textContent =
        kind === "bar" ? `  ${text} [${"#".repeat(20)}] 100%` : `  ${text}... ${t("loader.done")}`;
    }
    await Promise.all([dataPromise, wait(180)]);
    loader.classList.add("leaving");
    await wait(160);
    loader.hidden = true;
    loader.innerHTML = "";
  }

  // ------------------------------------------------------------------ boot

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-lang]");
    if (btn && btn.dataset.lang !== lang) setLang(btn.dataset.lang);
  });

  document.addEventListener("submit", (e) => {
    if (e.target.id !== "term") return;
    e.preventDefault();
    runCommand(e.target.querySelector("input"));
  });

  // typing anywhere on the page goes to the prompt, like in a real terminal
  document.addEventListener("keydown", (e) => {
    if (e.key.length !== 1 || e.key === " " || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!document.body.classList.contains("ready") || e.target.closest?.("input, textarea")) return;
    document.getElementById("term-input")?.focus();
  });

  document.documentElement.lang = lang;
  Promise.all([runLoader(), render().catch(console.error)]).finally(() => document.body.classList.add("ready"));
})();
