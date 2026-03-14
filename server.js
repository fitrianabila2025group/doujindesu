const http = require("http");
const { fetch: undiFetch, Agent } = require("undici");
const puppeteer = require("puppeteer-core");

const PORT = process.env.PORT || 3000;
const TARGET_HOST = "doujindesu.tv";
const TARGET_ORIGIN = "https://" + TARGET_HOST;
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || "/usr/bin/chromium-browser";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const SOURCE_DOMAINS = ["doujindesu.tv", "www.doujindesu.tv"];

// ========== CACHE CONFIG ==========
var HTML_CACHE_TTL = 5 * 60 * 1000;   // 5 min for HTML pages
var ASSET_CACHE_TTL = 30 * 60 * 1000; // 30 min for CSS/JS/JSON
var MAX_CACHE_ENTRIES = 500;

// ========== BLOCK LIST ==========
const blockedDomains = [
  "frozenpayerpregnant.com", "footbathmockerpurse.com", "pncloudfl.com",
  "popads.net", "popcash.net", "propellerads.com", "exoclick.com",
  "juicyads.com", "clickadu.com", "adsterra.com", "bidgear.com",
  "trafficjunky.com", "hilltopads.net", "pushame.com", "notix.io",
];
const blockedAdLinkDomains = [
  "linkol.xyz", "dw.zeus.fun", "gacor.zone", "klik.top",
  "aksesin.top", "menujupenta.site", "gacor.vin", "cek.to",
];

function isBlockedDomain(s) {
  if (!s) return false;
  s = s.toLowerCase();
  return blockedDomains.some(function (d) {
    return s === d || s.endsWith("." + d) || s.includes(d);
  });
}

// ========== SCANNER / EXPLOIT PATH BLOCKER ==========
var SCANNER_PATTERNS = /\.(env|git|svn|htaccess|htpasswd|ds_store|bak|sql|log|ini|conf|cfg|yml|yaml|toml|swp|old|orig|save|tmp|temp)$/i;
var SCANNER_PATHS = /^\/(wp-login|wp-admin|wp-includes|wp-content\/uploads|administrator|admin|xmlrpc|cgi-bin|phpmyadmin|pma|mysql|myadmin|config|\.well-known\/security|telescope|api\/v1\/auth|actuator|solr|manager|jmx-console|debug|trace|info|console|shell|cmd|eval|exec|system|passw)/i;

function isScannerRequest(pathname) {
  return SCANNER_PATTERNS.test(pathname) || SCANNER_PATHS.test(pathname);
}

// ========== UNDICI AGENT (for static assets on CDN - no CF protection) ==========
var tlsAgent = new Agent({
  connect: {
    rejectUnauthorized: true,
  },
});

// ========== RESPONSE CACHE ==========
// Cache: key = pathname+search, value = { body, headers, status, time }
var pageCache = new Map();
var inFlightRequests = new Map(); // deduplication: key -> Promise

function getCacheKey(pathname, search) {
  return pathname + (search || "");
}

function getFromCache(key) {
  var entry = pageCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > entry.ttl) {
    pageCache.delete(key);
    return null;
  }
  return entry;
}

function putInCache(key, data, ttl) {
  // Evict oldest if cache full
  if (pageCache.size >= MAX_CACHE_ENTRIES) {
    var oldest = pageCache.keys().next().value;
    pageCache.delete(oldest);
  }
  pageCache.set(key, {
    body: data.body,
    headers: data.headers,
    status: data.status,
    contentType: data.contentType,
    time: Date.now(),
    ttl: ttl,
  });
}

// ========== BROWSER MANAGER ==========
var browser = null;
var browserContext = null;

// Page pool: reuse Chrome tabs instead of creating/destroying
var pagePool = [];
var PAGE_POOL_SIZE = 3;
var pagePoolBusy = new Set();

async function launchBrowser() {
  if (browser && browser.isConnected()) return browser;
  if (browser) {
    try { await browser.close(); } catch (e) {}
    browser = null;
    browserContext = null;
    pagePool = [];
    pagePoolBusy.clear();
  }
  console.log("[Chrome] Launching browser...");
  browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-sync",
      "--disable-translate",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-search-engine-choice-screen",
      "--disable-infobars",
      "--no-pings",
      "--password-store=basic",
      "--user-agent=" + BROWSER_UA,
    ],
  });

  // Use a persistent context to keep cookies across page navigations
  browserContext = browser;
  console.log("[Chrome] Browser launched");

  // Pre-warm the page pool
  for (var i = 0; i < PAGE_POOL_SIZE; i++) {
    try {
      var p = await browser.newPage();
      await p.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9,id;q=0.8" });
      // Block ad/tracker resources in Chrome to speed up page loads
      await p.setRequestInterception(true);
      p.on("request", interceptRequest);
      pagePool.push(p);
    } catch (e) {
      console.error("[Chrome] Failed to create pool page:", e.message);
    }
  }
  console.log("[Chrome] Page pool ready: " + pagePool.length + " pages");
  return browser;
}

// Intercept requests in Chrome to block ads/trackers (speeds up page loads)
function interceptRequest(req) {
  var url = req.url();
  var rtype = req.resourceType();

  // Block ad domains
  if (isBlockedDomain(url)) {
    req.abort("blockedbyclient");
    return;
  }

  // Block tracking/ad resource types we don't need
  if (rtype === "media" || rtype === "websocket" || rtype === "manifest") {
    req.abort("blockedbyclient");
    return;
  }

  req.continue();
}

// Get a page from pool, or create a new one
async function acquirePage() {
  await launchBrowser();
  // Find an available pooled page
  for (var i = 0; i < pagePool.length; i++) {
    var pg = pagePool[i];
    if (!pagePoolBusy.has(pg)) {
      pagePoolBusy.add(pg);
      return pg;
    }
  }
  // All pool pages busy — create a temporary one
  var tmpPage = await browser.newPage();
  await tmpPage.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9,id;q=0.8" });
  await tmpPage.setRequestInterception(true);
  tmpPage.on("request", interceptRequest);
  tmpPage._isTemp = true;
  return tmpPage;
}

function releasePage(pg) {
  if (pg._isTemp) {
    pg.close().catch(function () {});
    return;
  }
  pagePoolBusy.delete(pg);
}

// ========== CHROME PAGE FETCH ==========
// Fetch a URL via Chrome (solves CF challenge automatically)
async function chromeFetch(url) {
  var page = await acquirePage();
  try {
    var resp = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });

    // Wait a little for dynamic content, but not too long
    await new Promise(function (r) { setTimeout(r, 1500); });

    // Check if CF challenge page
    var title = await page.title();
    if (title.includes("Just a moment") || title.includes("Attention Required")) {
      // Wait for CF to resolve
      console.log("[Chrome] CF challenge on " + url + ", waiting...");
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(function () {});
      await new Promise(function (r) { setTimeout(r, 2000); });
    }

    var status = resp ? resp.status() : 200;
    var body = await page.content();
    var ct = resp ? (resp.headers()["content-type"] || "text/html") : "text/html";

    return { body: body, status: status, contentType: ct };
  } finally {
    // Navigate to blank to free memory, then release
    await page.goto("about:blank", { timeout: 5000 }).catch(function () {});
    releasePage(page);
  }
}

// Coalesced Chrome fetch: deduplicate concurrent requests for same URL
async function chromeFetchCoalesced(url, cacheKey) {
  // Check cache first
  var cached = getFromCache(cacheKey);
  if (cached) return cached;

  // Check if already in-flight
  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey);
  }

  // Start fetch and register as in-flight
  var promise = chromeFetch(url)
    .then(function (result) {
      inFlightRequests.delete(cacheKey);
      return result;
    })
    .catch(function (err) {
      inFlightRequests.delete(cacheKey);
      throw err;
    });

  inFlightRequests.set(cacheKey, promise);
  return promise;
}

// ========== DOMAIN REWRITING ==========
function deepRewrite(text, mirrorHost, mirrorProto) {
  var result = text;
  for (var i = 0; i < SOURCE_DOMAINS.length; i++) {
    var src = SOURCE_DOMAINS[i];
    result = result.split("https://" + src).join(mirrorProto + "://" + mirrorHost);
    result = result.split("http://" + src).join(mirrorProto + "://" + mirrorHost);
    result = result.split("//" + src).join("//" + mirrorHost);
    result = result.split(src).join(mirrorHost);
  }
  return result;
}

// ========== SEO REWRITING ==========
function rewriteSeo(body, mirrorHost, mirrorProto, pathname) {
  var origin = mirrorProto + "://" + mirrorHost;
  var canonical = origin + pathname;

  body = body.replace(/<link\s+[^>]*rel=["']canonical["'][^>]*\/?>/gi, "");
  body = body.replace(/<meta\s+[^>]*property=["']og:url["'][^>]*\/?>/gi, "");
  body = body.replace(/<link\s+[^>]*rel=["']alternate["'][^>]*hreflang[^>]*\/?>/gi, "");
  body = body.replace(/<meta\s+[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex[^"']*["'][^>]*\/?>/gi, "");
  body = body.replace(/<meta\s+[^>]*content=["'][^"']*noindex[^"']*["'][^>]*name=["']robots["'][^>]*\/?>/gi, "");

  body = body.replace(
    /(<meta\s+[^>]*(?:property|name)=["'](?:og:image|og:image:url|og:image:secure_url|twitter:image)[^"']*["'][^>]*content=["'])([^"']+)(["'][^>]*\/?>)/gi,
    function (m, before, url, after) {
      for (var i = 0; i < SOURCE_DOMAINS.length; i++) url = url.split(SOURCE_DOMAINS[i]).join(mirrorHost);
      return before + url + after;
    }
  );

  body = body.replace(
    /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    function (m, json) {
      var rw = json;
      for (var i = 0; i < SOURCE_DOMAINS.length; i++) {
        rw = rw.split("https://" + SOURCE_DOMAINS[i]).join(origin);
        rw = rw.split("http://" + SOURCE_DOMAINS[i]).join(origin);
        rw = rw.split(SOURCE_DOMAINS[i]).join(mirrorHost);
      }
      return m.replace(json, rw);
    }
  );

  var tags =
    '<link rel="canonical" href="' + canonical + '" />\n' +
    '<meta property="og:url" content="' + canonical + '" />\n' +
    '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />';
  if (body.match(/<head[^>]*>/i)) {
    body = body.replace(/(<head[^>]*>)/i, "$1\n" + tags + "\n");
  }

  body = body.replace(/(srcset=["'])([^"']+)(["'])/gi, function (m, b, s, a) {
    for (var i = 0; i < SOURCE_DOMAINS.length; i++) s = s.split(SOURCE_DOMAINS[i]).join(mirrorHost);
    return b + s + a;
  });
  body = body.replace(/((?:data-src|data-url|data-lazy-src|data-original|data-bg)=["'])([^"']+)(["'])/gi, function (m, b, u, a) {
    for (var i = 0; i < SOURCE_DOMAINS.length; i++) u = u.split(SOURCE_DOMAINS[i]).join(mirrorHost);
    return b + u + a;
  });
  body = body.replace(/(<form\s+[^>]*action=["'])([^"']+)(["'])/gi, function (m, b, u, a) {
    for (var i = 0; i < SOURCE_DOMAINS.length; i++) u = u.split(SOURCE_DOMAINS[i]).join(mirrorHost);
    return b + u + a;
  });
  body = body.replace(/(url\s*\(\s*['"]?)([^)'"]+)(['"]?\s*\))/gi, function (m, b, u, a) {
    for (var i = 0; i < SOURCE_DOMAINS.length; i++) u = u.split(SOURCE_DOMAINS[i]).join(mirrorHost);
    return b + u + a;
  });

  return body;
}

// ========== ADBLOCK ==========
var adblockScriptCache = null;
function buildAdblockScript() {
  if (adblockScriptCache) return adblockScriptCache;
  adblockScriptCache =
    '\n<style id="proxy-adblock-css">\n' +
    'div[style*="position:fixed"][style*="z-index:2147483647"],\n' +
    'div[style*="position: fixed"][style*="z-index:2147483647"],\n' +
    'div[style*="position:fixed"][style*="z-index:99999"],\n' +
    'div[style*="position: fixed"][style*="z-index:99999"],\n' +
    'iframe[src*="popads"],iframe[src*="popcash"],iframe[src*="propellerads"],iframe[src*="exoclick"],\n' +
    'iframe[src*="adsterra"],iframe[src*="hilltopads"],\n' +
    'img[src*="frozenpayerpregnant"],img[src*="footbathmockerpurse"],img[src*="pncloudfl"],\n' +
    'script[src*="frozenpayerpregnant"],script[src*="footbathmockerpurse"],script[src*="pncloudfl"],\n' +
    'script[src*="popads"],script[src*="popcash"],script[src*="propellerads"],\n' +
    'script[src*="exoclick"],script[src*="adsterra"],script[src*="hilltopads"],\n' +
    'a[href*="popads"],a[href*="popcash"],a[href*="propellerads"],a[href*="exoclick"],a[href*="adsterra"],a[href*="hilltopads"],\n' +
    'a[href*="linkol.xyz"],a[href*="dw.zeus.fun"],a[href*="gacor.zone"],\n' +
    'a[href*="klik.top"],a[href*="aksesin.top"],a[href*="menujupenta.site"],\n' +
    'a[href*="gacor.vin"],a[href*="cek.to"]{\n' +
    '  display:none!important;visibility:hidden!important;pointer-events:none!important;\n}\n' +
    'center:has(>a[rel="nofollow"]>img.img-responsive){display:none!important;}\n' +
    '</style>\n' +
    '<script id="proxy-adblock-js">\n' +
    '(function(){"use strict";\n' +
    'var ap=' + JSON.stringify(blockedDomains.map(function (d) { return d.split(".")[0]; })) + ';\n' +
    'var al=' + JSON.stringify(blockedAdLinkDomains) + ';\n' +
    'function isA(s){if(!s)return false;s=(""+s).toLowerCase();for(var i=0;i<ap.length;i++)if(s.indexOf(ap[i])!==-1)return true;return false;}\n' +
    'function isL(s){if(!s)return false;s=(""+s).toLowerCase();for(var i=0;i<al.length;i++)if(s.indexOf(al[i])!==-1)return true;return false;}\n' +
    'function cl(){\n' +
    'document.querySelectorAll(\'div[style*="position:fixed"],div[style*="position: fixed"]\').forEach(function(d){var s=(d.getAttribute("style")||"").toLowerCase();if(s.includes("z-index:2147483647")||s.includes("z-index: 2147483647")||s.includes("z-index:99999")||s.includes("z-index: 99999"))d.remove();});\n' +
    'document.querySelectorAll("iframe").forEach(function(f){if(isA(f.src))f.remove();});\n' +
    'document.querySelectorAll("script[src]").forEach(function(s){if(isA(s.src))s.remove();});\n' +
    'document.querySelectorAll(\'a[rel="nofollow"]\').forEach(function(a){if(isL(a.href)){var p=a.parentElement;if(p&&p.tagName==="CENTER")p.remove();else a.remove();}});\n' +
    '}\n' +
    'var _o=window.open;window.open=function(u){if(!u||isA(u)||isL(u))return null;return _o.apply(window,arguments);};\n' +
    'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",cl);else cl();\n' +
    'setInterval(cl,2000);\n' +
    'if(window.MutationObserver){var o=new MutationObserver(function(m){for(var i=0;i<m.length;i++)if(m[i].addedNodes&&m[i].addedNodes.length){cl();break;}});o.observe(document.documentElement,{childList:true,subtree:true});}\n' +
    '})();\n</script>\n';
  return adblockScriptCache;
}

// ========== HELPERS ==========
function getMirrorHost(req) {
  return req.headers["x-forwarded-host"] || req.headers["host"] || "localhost";
}
function getMirrorProto(req) {
  var p = req.headers["x-forwarded-proto"];
  if (p) return p.split(",")[0].trim();
  return "https";
}

// Process HTML body: rewrite, SEO, adblock
function processHtml(body, mirrorHost, mirrorProto, pathname) {
  var mirrorOrigin = mirrorProto + "://" + mirrorHost;

  body = deepRewrite(body, mirrorHost, mirrorProto);
  body = rewriteSeo(body, mirrorHost, mirrorProto, pathname);

  // Remove ad banners
  for (var i = 0; i < blockedAdLinkDomains.length; i++) {
    var ad = blockedAdLinkDomains[i];
    body = body.replace(
      new RegExp(
        "<center>\\s*<a\\s+[^>]*href=[\"'][^\"']*" +
          ad.replace(/\./g, "\\.") +
          "[^\"']*[\"'][^>]*>\\s*<img[^>]*>\\s*</a>\\s*</center>",
        "gi"
      ),
      ""
    );
  }
  body = body.replace(
    /<center>\s*<a\s+[^>]*rel=["']nofollow["'][^>]*>\s*<img\s+[^>]*blogger\.googleusercontent\.com[^>]*>\s*<\/a>\s*<\/center>/gi,
    ""
  );

  // Inject adblock
  var abs = buildAdblockScript();
  if (body.includes("</body>")) body = body.replace("</body>", abs + "</body>");
  else if (body.includes("</BODY>")) body = body.replace("</BODY>", abs + "</BODY>");
  else body += abs;

  return body;
}

// ========== STATIC ASSET PROXY (CDN, no CF protection) ==========
// Images, CSS, JS from cdn.doujindesu.dev or similar CDNs bypass CF
async function proxyStaticAsset(targetUrl, req, res, mirrorHost, mirrorProto) {
  try {
    var headers = {
      "User-Agent": BROWSER_UA,
      "Accept": req.headers["accept"] || "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "identity",
      "Referer": TARGET_ORIGIN + "/",
    };

    var resp = await undiFetch(targetUrl, {
      method: req.method,
      headers: headers,
      redirect: "follow",
      dispatcher: tlsAgent,
    });

    var ct = resp.headers.get("content-type") || "application/octet-stream";

    // Skip headers we don't want to forward
    var skipH = new Set([
      "content-security-policy", "content-security-policy-report-only",
      "x-frame-options", "content-length", "content-encoding",
      "transfer-encoding", "connection",
    ]);
    var respH = {};
    resp.headers.forEach(function (v, k) {
      if (!skipH.has(k.toLowerCase())) respH[k] = v;
    });
    respH["access-control-allow-origin"] = "*";
    respH["cache-control"] = "public, max-age=86400"; // 24h browser cache for assets

    // Rewrite text-based assets
    if (ct.includes("text/css") || ct.includes("javascript") || ct.includes("application/json") ||
        ct.includes("xml") || ct.includes("rss") || ct.includes("atom")) {
      var tb = await resp.text();
      tb = deepRewrite(tb, mirrorHost, mirrorProto);
      res.writeHead(resp.status, respH);
      res.end(Buffer.from(tb, "utf-8"));
    } else {
      res.writeHead(resp.status, respH);
      res.end(Buffer.from(await resp.arrayBuffer()));
    }
  } catch (err) {
    console.error("[Asset] Failed to fetch:", targetUrl, err.message);
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Bad Gateway");
  }
}

// ========== MAIN HANDLER ==========
async function handleRequest(req, res) {
  var mirrorHost = getMirrorHost(req);
  var mirrorProto = getMirrorProto(req);
  var mirrorOrigin = mirrorProto + "://" + mirrorHost;
  var requestUrl = new URL(req.url, mirrorOrigin);
  var pathname = requestUrl.pathname;
  var search = requestUrl.search;

  // ========== BLOCK SCANNERS ==========
  if (isScannerRequest(pathname)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
    return;
  }

  // ========== BLOCK ADS ==========
  var rl = requestUrl.toString().toLowerCase();
  if (isBlockedDomain(rl)) {
    res.writeHead(204);
    res.end();
    return;
  }

  // ========== ROBOTS.TXT ==========
  if (pathname === "/robots.txt") {
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    });
    res.end("User-agent: *\nAllow: /\n\nSitemap: " + mirrorOrigin + "/sitemap.xml\n");
    return;
  }

  // ========== STATIC ASSETS (images, fonts, etc. on CDN) ==========
  // These are typically served from CDN without CF protection
  var ext = pathname.split(".").pop().toLowerCase();
  var staticExts = {
    jpg: 1, jpeg: 1, png: 1, gif: 1, webp: 1, avif: 1, svg: 1, ico: 1,
    woff: 1, woff2: 1, ttf: 1, eot: 1, otf: 1,
    mp4: 1, webm: 1, mp3: 1, ogg: 1,
  };

  if (staticExts[ext]) {
    var assetUrl = "https://" + TARGET_HOST + pathname + search;
    return proxyStaticAsset(assetUrl, req, res, mirrorHost, mirrorProto);
  }

  // CSS/JS files — also try direct fetch (usually no CF protection)
  if (ext === "css" || ext === "js") {
    var textAssetUrl = "https://" + TARGET_HOST + pathname + search;
    return proxyStaticAsset(textAssetUrl, req, res, mirrorHost, mirrorProto);
  }

  // ========== HTML PAGES (via Chrome with caching) ==========
  var cacheKey = getCacheKey(pathname, search);

  // Check cache first
  var cached = getFromCache(cacheKey);
  if (cached) {
    var cachedBody = processHtml(cached.body, mirrorHost, mirrorProto, pathname);
    res.writeHead(cached.status, {
      "Content-Type": "text/html; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "X-Robots-Tag": "index, follow",
      "Link": "<" + mirrorOrigin + pathname + '>; rel="canonical"',
      "X-Cache": "HIT",
      "Cache-Control": "public, max-age=60",
    });
    res.end(Buffer.from(cachedBody, "utf-8"));
    return;
  }

  // Fetch via Chrome (with deduplication)
  var targetUrl = "https://" + TARGET_HOST + pathname + search;
  var result;
  try {
    result = await chromeFetchCoalesced(targetUrl, cacheKey);
  } catch (err) {
    console.error("[Fetch] Failed:", pathname, err.message);
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Bad Gateway");
    return;
  }

  // If result was from cache (deduplication returned cached)
  if (result.time) {
    var rBody = processHtml(result.body, mirrorHost, mirrorProto, pathname);
    res.writeHead(result.status, {
      "Content-Type": "text/html; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "X-Robots-Tag": "index, follow",
      "Link": "<" + mirrorOrigin + pathname + '>; rel="canonical"',
      "X-Cache": "HIT",
    });
    res.end(Buffer.from(rBody, "utf-8"));
    return;
  }

  // Store raw body in cache (before rewriting, so we rewrite per-request with correct host)
  putInCache(cacheKey, result, HTML_CACHE_TTL);

  // Process and return
  var processedBody = processHtml(result.body, mirrorHost, mirrorProto, pathname);

  res.writeHead(result.status, {
    "Content-Type": "text/html; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "X-Robots-Tag": "index, follow",
    "Link": "<" + mirrorOrigin + pathname + '>; rel="canonical"',
    "X-Cache": "MISS",
    "Cache-Control": "public, max-age=60",
  });
  res.end(Buffer.from(processedBody, "utf-8"));
}

// ========== SERVER ==========
var server = http.createServer(async function (req, res) {
  try {
    await handleRequest(req, res);
  } catch (err) {
    console.error("Request error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error");
    }
  }
});

// Launch browser and pre-warm cache on startup
launchBrowser()
  .then(function () {
    console.log("[Startup] Browser ready");
    // Pre-warm homepage cache
    return chromeFetchCoalesced(TARGET_ORIGIN + "/", "/");
  })
  .then(function (result) {
    putInCache("/", result, HTML_CACHE_TTL);
    console.log("[Startup] Homepage cached (" + result.body.length + " bytes)");
  })
  .catch(function (err) {
    console.error("[Startup] Pre-warm failed:", err.message);
  });

server.listen(PORT, "0.0.0.0", function () {
  console.log("Mirror proxy running on port " + PORT);
});

// Cache stats logging every 5 minutes
setInterval(function () {
  console.log("[Cache] Entries: " + pageCache.size + ", In-flight: " + inFlightRequests.size + ", Pool busy: " + pagePoolBusy.size + "/" + pagePool.length);
}, 5 * 60 * 1000);

// Clean up on exit
process.on("SIGTERM", async function () {
  if (browser) await browser.close().catch(function () {});
  process.exit(0);
});
process.on("SIGINT", async function () {
  if (browser) await browser.close().catch(function () {});
  process.exit(0);
});