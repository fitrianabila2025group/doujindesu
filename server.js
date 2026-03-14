const http = require("http");
const { fetch: undiFetch, Agent } = require("undici");
const puppeteer = require("puppeteer-core");

const PORT = process.env.PORT || 3000;
const TARGET_HOST = "doujindesu.tv";
const TARGET_ORIGIN = "https://" + TARGET_HOST;
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || "/usr/bin/chromium-browser";

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const SOURCE_DOMAINS = [
  "doujindesu.tv",
  "www.doujindesu.tv",
];

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
  return blockedDomains.some(function (d) { return s === d || s.endsWith("." + d) || s.includes(d); });
}

// ========== CHROME TLS AGENT ==========
var CHROME_CIPHERS = [
  "TLS_AES_128_GCM_SHA256", "TLS_AES_256_GCM_SHA384",
  "TLS_CHACHA20_POLY1305_SHA256",
  "ECDHE-ECDSA-AES128-GCM-SHA256", "ECDHE-RSA-AES128-GCM-SHA256",
  "ECDHE-ECDSA-AES256-GCM-SHA384", "ECDHE-RSA-AES256-GCM-SHA384",
  "ECDHE-ECDSA-CHACHA20-POLY1305", "ECDHE-RSA-CHACHA20-POLY1305",
  "ECDHE-RSA-AES128-SHA", "ECDHE-RSA-AES256-SHA",
  "AES128-GCM-SHA256", "AES256-GCM-SHA384", "AES128-SHA", "AES256-SHA",
].join(":");

var tlsAgent = new Agent({
  allowH2: true,
  connect: {
    ciphers: CHROME_CIPHERS,
    ecdhCurve: "X25519:P-256:P-384",
    sigalgs: "ecdsa_secp256r1_sha256:rsa_pss_rsae_sha256:rsa_pkcs1_sha256:ecdsa_secp384r1_sha384:rsa_pss_rsae_sha384:rsa_pkcs1_sha384:rsa_pss_rsae_sha512:rsa_pkcs1_sha512",
    minVersion: "TLSv1.2",
    maxVersion: "TLSv1.3",
    rejectUnauthorized: true,
  },
});

// ========== CLOUDFLARE COOKIE MANAGER ==========
// Uses headless Chrome to solve Cloudflare challenges and extract cookies
var cfCookies = "";
var cfCookieExpiry = 0;
var cfRefreshing = false;
var cfRefreshPromise = null;
var browser = null;

async function launchBrowser() {
  if (browser) return browser;
  console.log("[Chrome] Launching headless browser...");
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
  console.log("[Chrome] Browser launched successfully");
  return browser;
}

async function solveCfChallenge() {
  console.log("[CF] Solving Cloudflare challenge via headless Chrome...");
  var b = await launchBrowser();
  var page = await b.newPage();

  try {
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
    });

    // Navigate to site - Chrome will automatically solve CF challenge
    await page.goto(TARGET_ORIGIN, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Wait extra time for CF challenge JS to complete
    await new Promise(function (r) { setTimeout(r, 5000); });

    // Check if still on challenge page, wait more
    var pageContent = await page.content();
    if (pageContent.includes("challenge-platform") || pageContent.includes("Just a moment")) {
      console.log("[CF] Challenge page detected, waiting longer...");
      await new Promise(function (r) { setTimeout(r, 10000); });
    }

    // Extract all cookies
    var cookies = await page.cookies();
    var cookieStr = cookies.map(function (c) { return c.name + "=" + c.value; }).join("; ");

    var hasCfClearance = cookies.some(function (c) { return c.name === "cf_clearance"; });

    if (hasCfClearance) {
      console.log("[CF] Got cf_clearance cookie successfully!");
    } else {
      console.log("[CF] No cf_clearance found, using all cookies anyway. Cookie names:", cookies.map(function (c) { return c.name; }).join(", "));
    }

    cfCookies = cookieStr;
    // Refresh every 10 minutes (cf_clearance usually lasts 15-30 min)
    cfCookieExpiry = Date.now() + 10 * 60 * 1000;

    console.log("[CF] Cookies obtained: " + cookies.length + " cookies");
    return cookieStr;
  } catch (err) {
    console.error("[CF] Challenge solve failed:", err.message);
    return cfCookies; // return old cookies if any
  } finally {
    await page.close().catch(function () {});
  }
}

async function getCfCookies() {
  // Return cached cookies if still valid
  if (cfCookies && Date.now() < cfCookieExpiry) {
    return cfCookies;
  }

  // Prevent multiple simultaneous refreshes
  if (cfRefreshing) {
    return cfRefreshPromise;
  }

  cfRefreshing = true;
  cfRefreshPromise = solveCfChallenge().finally(function () {
    cfRefreshing = false;
    cfRefreshPromise = null;
  });

  return cfRefreshPromise;
}

// Force refresh (called when we detect CF block on a response)
async function forceRefreshCfCookies() {
  cfCookieExpiry = 0;
  return getCfCookies();
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

  // Remove old canonical, og:url, hreflang, noindex
  body = body.replace(/<link\s+[^>]*rel=["']canonical["'][^>]*\/?>/gi, "");
  body = body.replace(/<meta\s+[^>]*property=["']og:url["'][^>]*\/?>/gi, "");
  body = body.replace(/<link\s+[^>]*rel=["']alternate["'][^>]*hreflang[^>]*\/?>/gi, "");
  body = body.replace(/<meta\s+[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex[^"']*["'][^>]*\/?>/gi, "");
  body = body.replace(/<meta\s+[^>]*content=["'][^"']*noindex[^"']*["'][^>]*name=["']robots["'][^>]*\/?>/gi, "");

  // Rewrite og:image, twitter:image
  body = body.replace(
    /(<meta\s+[^>]*(?:property|name)=["'](?:og:image|og:image:url|og:image:secure_url|twitter:image)[^"']*["'][^>]*content=["'])([^"']+)(["'][^>]*\/?>)/gi,
    function (m, before, url, after) {
      for (var i = 0; i < SOURCE_DOMAINS.length; i++) url = url.split(SOURCE_DOMAINS[i]).join(mirrorHost);
      return before + url + after;
    }
  );

  // Rewrite JSON-LD
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

  // Inject canonical + og:url + robots
  var tags =
    '<link rel="canonical" href="' + canonical + '" />\n' +
    '<meta property="og:url" content="' + canonical + '" />\n' +
    '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />';
  if (body.match(/<head[^>]*>/i)) {
    body = body.replace(/(<head[^>]*>)/i, "$1\n" + tags + "\n");
  }

  // Rewrite srcset, data-src, form actions, inline CSS url()
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
function buildAdblockScript() {
  return '\n<style id="proxy-adblock-css">\n' +
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
function collectBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    req.on("data", function (c) { chunks.push(c); });
    req.on("end", function () { resolve(Buffer.concat(chunks)); });
    req.on("error", reject);
  });
}

// ========== MAIN HANDLER ==========
async function handleRequest(req, res) {
  var mirrorHost = getMirrorHost(req);
  var mirrorProto = getMirrorProto(req);
  var mirrorOrigin = mirrorProto + "://" + mirrorHost;
  var requestUrl = new URL(req.url, mirrorOrigin);
  var pathname = requestUrl.pathname;

  // ========== ROBOTS.TXT ==========
  if (pathname === "/robots.txt") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" });
    res.end("User-agent: *\nAllow: /\n\nSitemap: " + mirrorOrigin + "/sitemap.xml\n");
    return;
  }

  // ========== SITEMAP ==========
  if (pathname === "/sitemap.xml" || pathname.startsWith("/sitemap")) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end("Method Not Allowed");
      return;
    }
    var cookies = await getCfCookies();
    var sResp;
    try {
      sResp = await undiFetch("https://" + TARGET_HOST + pathname, {
        dispatcher: tlsAgent,
        headers: {
          "Host": TARGET_HOST,
          "User-Agent": BROWSER_UA,
          "Accept": "application/xml,text/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "identity",
          "Referer": TARGET_ORIGIN + "/",
          "Cookie": cookies,
        },
      });
    } catch (e) {
      res.writeHead(502);
      res.end("Bad Gateway");
      return;
    }
    var sBody = await sResp.text();
    sBody = deepRewrite(sBody, mirrorHost, mirrorProto);
    res.writeHead(sResp.status, {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(sBody);
    return;
  }

  // ========== BLOCK CHECK ==========
  var rl = requestUrl.toString().toLowerCase();
  if (isBlockedDomain(requestUrl.hostname.toLowerCase()) || isBlockedDomain(rl)) {
    res.writeHead(204); res.end(); return;
  }
  if (rl.includes("/get/")) {
    var hh = requestUrl.hostname.toLowerCase();
    if (!hh.includes(TARGET_HOST) && !hh.includes(mirrorHost)) {
      res.writeHead(204); res.end(); return;
    }
  }

  // ========== GET CF COOKIES ==========
  var cookies = await getCfCookies();

  // ========== BUILD UPSTREAM REQUEST ==========
  var targetUrl = new URL(requestUrl.toString());
  targetUrl.hostname = TARGET_HOST;
  targetUrl.protocol = "https:";

  var fetchHeaders = {
    "Host": TARGET_HOST,
    "User-Agent": BROWSER_UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
    "Accept-Encoding": "identity",
    "Referer": TARGET_ORIGIN + "/",
    "Cookie": cookies,
    "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  };

  // Merge visitor cookies with CF cookies
  if (req.headers["cookie"]) {
    fetchHeaders["Cookie"] = cookies + "; " + req.headers["cookie"];
  }

  var fetchOpts = {
    method: req.method,
    headers: fetchHeaders,
    redirect: "manual",
    dispatcher: tlsAgent,
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    var bodyBuf = await collectBody(req);
    if (bodyBuf.length > 0) fetchOpts.body = bodyBuf;
  }

  var response;
  try {
    response = await undiFetch(targetUrl.toString(), fetchOpts);
  } catch (err) {
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Bad Gateway");
    return;
  }

  // ========== DETECT CF CHALLENGE & RETRY WITH FRESH COOKIES ==========
  var cfMitigated = response.headers.get("cf-mitigated") || "";
  if (
    (response.status === 403 || response.status === 503) &&
    (cfMitigated.toLowerCase() === "challenge" || (response.headers.get("server") || "").includes("cloudflare"))
  ) {
    console.log("[CF] Challenge detected on " + pathname + " (status " + response.status + "), refreshing cookies...");
    var freshCookies = await forceRefreshCfCookies();
    fetchHeaders["Cookie"] = freshCookies + (req.headers["cookie"] ? "; " + req.headers["cookie"] : "");
    fetchOpts.headers = fetchHeaders;

    try {
      response = await undiFetch(targetUrl.toString(), fetchOpts);
    } catch (err) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Bad Gateway");
      return;
    }

    // If STILL challenged, use Chrome directly for this page
    cfMitigated = response.headers.get("cf-mitigated") || "";
    if (
      (response.status === 403 || response.status === 503) &&
      (cfMitigated.toLowerCase() === "challenge" || (response.headers.get("server") || "").includes("cloudflare"))
    ) {
      console.log("[CF] Still challenged after cookie refresh, using Chrome directly for: " + pathname);
      return await handleViaBrowser(req, res, targetUrl.toString(), mirrorHost, mirrorProto, pathname);
    }
  }

  // ========== HANDLE REDIRECT ==========
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    var loc = response.headers.get("location");
    if (loc) {
      if (isBlockedDomain(loc)) { res.writeHead(204); res.end(); return; }
      var newLoc;
      try {
        var lu = new URL(loc, TARGET_ORIGIN);
        lu.hostname = mirrorHost;
        lu.protocol = mirrorProto + ":";
        newLoc = lu.toString();
      } catch (e) {
        newLoc = deepRewrite(loc, mirrorHost, mirrorProto);
      }
      var rh = {};
      response.headers.forEach(function (v, k) { rh[k] = v; });
      rh["location"] = newLoc;
      res.writeHead(response.status, rh);
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
  }

  // ========== RESPONSE HEADERS ==========
  var skipH = new Set([
    "content-security-policy", "content-security-policy-report-only",
    "x-frame-options", "content-length", "content-encoding",
    "transfer-encoding", "connection", "link",
  ]);
  var respH = {};
  response.headers.forEach(function (v, k) {
    if (!skipH.has(k.toLowerCase())) respH[k] = v;
  });
  respH["access-control-allow-origin"] = "*";

  var ct = response.headers.get("content-type") || "";

  // ========== HTML ==========
  if (ct.includes("text/html")) {
    var body = await response.text();
    body = deepRewrite(body, mirrorHost, mirrorProto);
    body = rewriteSeo(body, mirrorHost, mirrorProto, pathname);

    // Remove ad banners
    for (var ad of blockedAdLinkDomains) {
      body = body.replace(new RegExp(
        "<center>\\s*<a\\s+[^>]*href=[\"'][^\"']*" + ad.replace(/\./g, "\\.") + "[^\"']*[\"'][^>]*>\\s*<img[^>]*>\\s*</a>\\s*</center>", "gi"
      ), "");
    }
    body = body.replace(/<center>\s*<a\s+[^>]*rel=["']nofollow["'][^>]*>\s*<img\s+[^>]*blogger\.googleusercontent\.com[^>]*>\s*<\/a>\s*<\/center>/gi, "");

    // Inject adblock
    var abs = buildAdblockScript();
    if (body.includes("</body>")) body = body.replace("</body>", abs + "</body>");
    else if (body.includes("</BODY>")) body = body.replace("</BODY>", abs + "</BODY>");
    else body += abs;

    // Rewrite cookies
    var sc = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
    if (sc.length) {
      delete respH["set-cookie"];
      respH["set-cookie"] = sc.map(function (c) { return c.replace(/domain=[^;]+/gi, "domain=" + mirrorHost); });
    }

    respH["content-type"] = "text/html; charset=utf-8";
    respH["x-robots-tag"] = "index, follow";
    respH["link"] = "<" + mirrorOrigin + pathname + '>; rel="canonical"';

    res.writeHead(response.status, respH);
    res.end(Buffer.from(body, "utf-8"));
    return;
  }

  // ========== CSS / JS / JSON / XML ==========
  if (ct.includes("text/css") || ct.includes("javascript") || ct.includes("application/json") ||
      ct.includes("xml") || ct.includes("rss") || ct.includes("atom")) {
    var tb = await response.text();
    tb = deepRewrite(tb, mirrorHost, mirrorProto);
    res.writeHead(response.status, respH);
    res.end(Buffer.from(tb, "utf-8"));
    return;
  }

  // ========== BINARY ==========
  res.writeHead(response.status, respH);
  res.end(Buffer.from(await response.arrayBuffer()));
}

// ========== FALLBACK: DIRECT CHROME FETCH ==========
// When undici+cookies fails, use Chrome directly to fetch the page
async function handleViaBrowser(req, res, url, mirrorHost, mirrorProto, pathname) {
  var b = await launchBrowser();
  var page = await b.newPage();
  try {
    var resp = await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(function (r) { setTimeout(r, 3000); });

    var body = await page.content();
    body = deepRewrite(body, mirrorHost, mirrorProto);
    body = rewriteSeo(body, mirrorHost, mirrorProto, pathname);

    // Remove ads
    for (var ad of blockedAdLinkDomains) {
      body = body.replace(new RegExp(
        "<center>\\s*<a\\s+[^>]*href=[\"'][^\"']*" + ad.replace(/\./g, "\\.") + "[^\"']*[\"'][^>]*>\\s*<img[^>]*>\\s*</a>\\s*</center>", "gi"
      ), "");
    }

    var abs = buildAdblockScript();
    if (body.includes("</body>")) body = body.replace("</body>", abs + "</body>");
    else body += abs;

    // Update stored cookies from this page visit
    var pageCookies = await page.cookies();
    cfCookies = pageCookies.map(function (c) { return c.name + "=" + c.value; }).join("; ");
    cfCookieExpiry = Date.now() + 10 * 60 * 1000;

    var status = resp ? resp.status() : 200;
    res.writeHead(status, {
      "Content-Type": "text/html; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "X-Robots-Tag": "index, follow",
      "Link": "<" + mirrorProto + "://" + mirrorHost + pathname + '>; rel="canonical"',
    });
    res.end(Buffer.from(body, "utf-8"));
  } catch (err) {
    console.error("[Chrome] Direct fetch failed:", err.message);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Bad Gateway");
    }
  } finally {
    await page.close().catch(function () {});
  }
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

// Pre-solve CF challenge on startup
getCfCookies().then(function () {
  console.log("[Startup] CF cookies ready");
}).catch(function (err) {
  console.error("[Startup] CF cookie pre-fetch failed:", err.message);
});

server.listen(PORT, "0.0.0.0", function () {
  console.log("Mirror proxy running on port " + PORT);
});

// Clean up browser on exit
process.on("SIGTERM", async function () {
  if (browser) await browser.close().catch(function () {});
  process.exit(0);
});
process.on("SIGINT", async function () {
  if (browser) await browser.close().catch(function () {});
  process.exit(0);
});