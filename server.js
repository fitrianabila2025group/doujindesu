const http = require("http");

const PORT = process.env.PORT || 3000;
const TARGET_HOST = "doujindesu.tv";
const SITEMAP_SOURCE = "doujindesu.tv";

// Realistic browser User-Agent
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// All source domains that need rewriting to the mirror domain
const SOURCE_DOMAINS = [
  "doujindesu.tv",
  "www.doujindesu.tv",
];

// ========== BLOCK LIST ==========
const blockedDomains = [
  "frozenpayerpregnant.com",
  "footbathmockerpurse.com",
  "pncloudfl.com",
  "popads.net",
  "popcash.net",
  "propellerads.com",
  "exoclick.com",
  "juicyads.com",
  "clickadu.com",
  "adsterra.com",
  "bidgear.com",
  "trafficjunky.com",
  "hilltopads.net",
  "pushame.com",
  "notix.io",
];

const blockedAdLinkDomains = [
  "linkol.xyz",
  "dw.zeus.fun",
  "gacor.zone",
  "klik.top",
  "aksesin.top",
  "menujupenta.site",
  "gacor.vin",
  "cek.to",
];

function isBlockedDomain(hostOrUrl) {
  if (!hostOrUrl) return false;
  const s = hostOrUrl.toLowerCase();
  return blockedDomains.some(
    (d) => s === d || s.endsWith("." + d) || s.includes(d)
  );
}

// ========== DEEP DOMAIN REWRITING ==========
function deepRewriteDomains(text, mirrorHost, mirrorProto) {
  let result = text;
  for (const src of SOURCE_DOMAINS) {
    result = result.split("https://" + src).join(mirrorProto + "://" + mirrorHost);
    result = result.split("http://" + src).join(mirrorProto + "://" + mirrorHost);
    result = result.split("//" + src).join("//" + mirrorHost);
    result = result.split(src).join(mirrorHost);
  }
  return result;
}

// ========== CANONICAL & SEO TAG REWRITING ==========
function rewriteHtmlForSeo(body, mirrorHost, mirrorProto, pathname) {
  const mirrorOrigin = mirrorProto + "://" + mirrorHost;
  const canonicalUrl = mirrorOrigin + pathname;

  // Remove ALL existing canonical tags
  body = body.replace(/<link\s+[^>]*rel=["']canonical["'][^>]*\/?>/gi, "");

  // Remove ALL existing og:url meta tags
  body = body.replace(/<meta\s+[^>]*property=["']og:url["'][^>]*\/?>/gi, "");

  // Remove existing alternate/hreflang links
  body = body.replace(/<link\s+[^>]*rel=["']alternate["'][^>]*hreflang[^>]*\/?>/gi, "");

  // Remove any noindex meta robots from original
  body = body.replace(
    /<meta\s+[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex[^"']*["'][^>]*\/?>/gi,
    ""
  );
  body = body.replace(
    /<meta\s+[^>]*content=["'][^"']*noindex[^"']*["'][^>]*name=["']robots["'][^>]*\/?>/gi,
    ""
  );

  // Rewrite og:image, twitter:image URLs
  body = body.replace(
    /(<meta\s+[^>]*(?:property|name)=["'](?:og:image|og:image:url|og:image:secure_url|twitter:image)[^"']*["'][^>]*content=["'])([^"']+)(["'][^>]*\/?>)/gi,
    function (match, before, url, after) {
      var newUrl = url;
      for (var i = 0; i < SOURCE_DOMAINS.length; i++) {
        newUrl = newUrl.split(SOURCE_DOMAINS[i]).join(mirrorHost);
      }
      return before + newUrl + after;
    }
  );

  // Rewrite JSON-LD structured data
  body = body.replace(
    /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    function (match, jsonContent) {
      var rewritten = jsonContent;
      for (var i = 0; i < SOURCE_DOMAINS.length; i++) {
        rewritten = rewritten.split("https://" + SOURCE_DOMAINS[i]).join(mirrorOrigin);
        rewritten = rewritten.split("http://" + SOURCE_DOMAINS[i]).join(mirrorOrigin);
        rewritten = rewritten.split(SOURCE_DOMAINS[i]).join(mirrorHost);
      }
      return match.replace(jsonContent, rewritten);
    }
  );

  // Inject fresh canonical + og:url + robots meta into <head>
  var seoTags =
    '<link rel="canonical" href="' + canonicalUrl + '" />\n' +
    '<meta property="og:url" content="' + canonicalUrl + '" />\n' +
    '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />';

  if (body.match(/<head[^>]*>/i)) {
    body = body.replace(/(<head[^>]*>)/i, "$1\n" + seoTags + "\n");
  }

  // Rewrite form action URLs
  body = body.replace(
    /(<form\s+[^>]*action=["'])([^"']+)(["'])/gi,
    function (match, before, url, after) {
      var newUrl = url;
      for (var i = 0; i < SOURCE_DOMAINS.length; i++) {
        newUrl = newUrl.split(SOURCE_DOMAINS[i]).join(mirrorHost);
      }
      return before + newUrl + after;
    }
  );

  // Rewrite srcset attributes
  body = body.replace(
    /(srcset=["'])([^"']+)(["'])/gi,
    function (match, before, srcset, after) {
      var newSrcset = srcset;
      for (var i = 0; i < SOURCE_DOMAINS.length; i++) {
        newSrcset = newSrcset.split(SOURCE_DOMAINS[i]).join(mirrorHost);
      }
      return before + newSrcset + after;
    }
  );

  // Rewrite data-src, data-url, data-lazy-src, data-bg attributes
  body = body.replace(
    /((?:data-src|data-url|data-lazy-src|data-original|data-bg)=["'])([^"']+)(["'])/gi,
    function (match, before, url, after) {
      var newUrl = url;
      for (var i = 0; i < SOURCE_DOMAINS.length; i++) {
        newUrl = newUrl.split(SOURCE_DOMAINS[i]).join(mirrorHost);
      }
      return before + newUrl + after;
    }
  );

  // Rewrite inline CSS url() references
  body = body.replace(
    /(url\s*\(\s*['"]?)([^)'"]+)(['"]?\s*\))/gi,
    function (match, before, url, after) {
      var newUrl = url;
      for (var i = 0; i < SOURCE_DOMAINS.length; i++) {
        newUrl = newUrl.split(SOURCE_DOMAINS[i]).join(mirrorHost);
      }
      return before + newUrl + after;
    }
  );

  return body;
}

// ========== ROBOTS.TXT ==========
function generateRobotsTxt(mirrorHost, mirrorProto) {
  return (
    "User-agent: *\n" +
    "Allow: /\n" +
    "\n" +
    "Sitemap: " + mirrorProto + "://" + mirrorHost + "/sitemap.xml\n"
  );
}

// ========== ADBLOCK SCRIPT ==========
function buildAdblockScript() {
  return '\n<style id="proxy-adblock-css">\n' +
'div[style*="position:fixed"][style*="z-index:2147483647"],\n' +
'div[style*="position: fixed"][style*="z-index:2147483647"],\n' +
'div[style*="position:fixed"][style*="z-index:99999"],\n' +
'div[style*="position: fixed"][style*="z-index:99999"],\n' +
'iframe[src*="popads"], iframe[src*="popcash"],\n' +
'iframe[src*="propellerads"], iframe[src*="exoclick"],\n' +
'iframe[src*="adsterra"], iframe[src*="hilltopads"],\n' +
'img[src*="frozenpayerpregnant"], img[src*="footbathmockerpurse"], img[src*="pncloudfl"],\n' +
'script[src*="frozenpayerpregnant"], script[src*="footbathmockerpurse"], script[src*="pncloudfl"],\n' +
'script[src*="popads"], script[src*="popcash"], script[src*="propellerads"],\n' +
'script[src*="exoclick"], script[src*="adsterra"], script[src*="hilltopads"],\n' +
'a[href*="popads"], a[href*="popcash"], a[href*="propellerads"], a[href*="exoclick"], a[href*="adsterra"], a[href*="hilltopads"],\n' +
'a[href*="linkol.xyz"], a[href*="dw.zeus.fun"], a[href*="gacor.zone"],\n' +
'a[href*="klik.top"], a[href*="aksesin.top"], a[href*="menujupenta.site"],\n' +
'a[href*="gacor.vin"], a[href*="cek.to"]{\n' +
'  display:none !important;\n' +
'  visibility:hidden !important;\n' +
'  pointer-events:none !important;\n' +
'}\n' +
'center:has(> a[rel="nofollow"] > img.img-responsive){\n' +
'  display:none !important;\n' +
'}\n' +
'</style>\n' +
'<script id="proxy-adblock-js">\n' +
'(function(){\n' +
'  "use strict";\n' +
'  var adPatterns = ' + JSON.stringify(blockedDomains.map(function(d){ return d.split(".")[0]; })) + ';\n' +
'  var adLinkPatterns = ' + JSON.stringify(blockedAdLinkDomains) + ';\n' +
'  function isAd(str){\n' +
'    if(!str) return false;\n' +
'    var s = (""+str).toLowerCase();\n' +
'    for(var i=0;i<adPatterns.length;i++){\n' +
'      if(s.indexOf(adPatterns[i]) !== -1) return true;\n' +
'    }\n' +
'    return false;\n' +
'  }\n' +
'  function isAdLink(str){\n' +
'    if(!str) return false;\n' +
'    var s = (""+str).toLowerCase();\n' +
'    for(var i=0;i<adLinkPatterns.length;i++){\n' +
'      if(s.indexOf(adLinkPatterns[i]) !== -1) return true;\n' +
'    }\n' +
'    return false;\n' +
'  }\n' +
'  function clean(){\n' +
'    var divs = document.querySelectorAll(\'div[style*="position:fixed"], div[style*="position: fixed"]\');\n' +
'    for(var i=0;i<divs.length;i++){\n' +
'      var d = divs[i];\n' +
'      var st = (d.getAttribute("style")||"").toLowerCase();\n' +
'      if(st.includes("z-index:2147483647") || st.includes("z-index: 2147483647") ||\n' +
'         st.includes("z-index:99999") || st.includes("z-index: 99999")){\n' +
'        d.remove();\n' +
'      }\n' +
'    }\n' +
'    var ifr = document.querySelectorAll("iframe");\n' +
'    for(var j=0;j<ifr.length;j++){\n' +
'      if(isAd(ifr[j].src)) ifr[j].remove();\n' +
'    }\n' +
'    var sc = document.querySelectorAll("script[src]");\n' +
'    for(var k=0;k<sc.length;k++){\n' +
'      if(isAd(sc[k].src)) sc[k].remove();\n' +
'    }\n' +
'    var allLinks = document.querySelectorAll(\'a[rel="nofollow"]\');\n' +
'    for(var m=0;m<allLinks.length;m++){\n' +
'      var link = allLinks[m];\n' +
'      if(isAdLink(link.href)){\n' +
'        var parent = link.parentElement;\n' +
'        if(parent && parent.tagName === "CENTER") parent.remove();\n' +
'        else link.remove();\n' +
'      }\n' +
'    }\n' +
'  }\n' +
'  var _open = window.open;\n' +
'  window.open = function(u){\n' +
'    if(!u || isAd(u) || isAdLink(u)) return null;\n' +
'    return _open.apply(window, arguments);\n' +
'  };\n' +
'  if(document.readyState === "loading"){\n' +
'    document.addEventListener("DOMContentLoaded", function(){ clean(); });\n' +
'  } else clean();\n' +
'  setInterval(clean, 2000);\n' +
'  if(window.MutationObserver){\n' +
'    var obs = new MutationObserver(function(m){\n' +
'      for(var i=0;i<m.length;i++){\n' +
'        if(m[i].addedNodes && m[i].addedNodes.length){ clean(); break; }\n' +
'      }\n' +
'    });\n' +
'    obs.observe(document.documentElement, {childList:true, subtree:true});\n' +
'  }\n' +
'})();\n' +
'</script>\n';
}

// ========== HELPERS ==========
function getOriginalHost(req) {
  return req.headers["x-forwarded-host"] || req.headers["host"] || "localhost";
}

function getOriginalProtocol(req) {
  var proto = req.headers["x-forwarded-proto"];
  if (proto) return proto.split(",")[0].trim();
  return "https";
}

function collectRequestBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    req.on("data", function (chunk) { chunks.push(chunk); });
    req.on("end", function () { resolve(Buffer.concat(chunks)); });
    req.on("error", reject);
  });
}

// ========== MAIN HANDLER ==========
async function handleRequest(req, res) {
  var mirrorHost = getOriginalHost(req);
  var mirrorProto = getOriginalProtocol(req);
  var mirrorOrigin = mirrorProto + "://" + mirrorHost;
  var requestUrl = new URL(req.url, mirrorOrigin);
  var pathname = requestUrl.pathname;
  var requestUrlLower = requestUrl.toString().toLowerCase();
  var reqHostLower = requestUrl.hostname.toLowerCase();

  // ========== ROBOTS.TXT ==========
  if (pathname === "/robots.txt") {
    var robotsBody = generateRobotsTxt(mirrorHost, mirrorProto);
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    });
    res.end(robotsBody);
    return;
  }

  // ========== SITEMAP (rewrite URLs to mirror domain) ==========
  if (pathname === "/sitemap.xml" || pathname.startsWith("/sitemap")) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "Content-Type": "text/plain" });
      res.end("Method Not Allowed");
      return;
    }

    var sitemapUrl = "https://" + SITEMAP_SOURCE + pathname;
    var sitemapResp;
    try {
      sitemapResp = await fetch(sitemapUrl, {
        method: req.method,
        headers: {
          "User-Agent": BROWSER_UA,
          "Accept": "application/xml,text/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": "https://" + TARGET_HOST + "/",
        },
      });
    } catch (e) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Bad Gateway");
      return;
    }

    var sitemapBody = await sitemapResp.text();
    sitemapBody = deepRewriteDomains(sitemapBody, mirrorHost, mirrorProto);

    res.writeHead(sitemapResp.status, {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(sitemapBody);
    return;
  }

  // ========== BLOCK LIST CHECK ==========
  if (isBlockedDomain(reqHostLower) || isBlockedDomain(requestUrlLower)) {
    res.writeHead(204);
    res.end();
    return;
  }

  if (requestUrlLower.includes("/get/")) {
    var h = requestUrl.hostname.toLowerCase();
    if (!h.includes(TARGET_HOST) && !h.includes(mirrorHost)) {
      res.writeHead(204);
      res.end();
      return;
    }
  }

  // ========== BUILD UPSTREAM REQUEST ==========
  var targetUrl = new URL(requestUrl.toString());
  targetUrl.hostname = TARGET_HOST;
  targetUrl.protocol = "https:";

  // Headers that should not be forwarded
  var skipRequestHeaders = new Set([
    "host", "origin", "referer",
    "cf-connecting-ip", "cf-ray", "cf-visitor", "cf-ipcountry", "cf-worker",
    "x-forwarded-for", "x-forwarded-proto", "x-forwarded-host",
    "x-real-ip", "x-request-id",
    "connection", "transfer-encoding",
    "via", "forwarded",
  ]);

  // Build headers that look like a real browser
  var fetchHeaders = {
    "Host": TARGET_HOST,
    "User-Agent": BROWSER_UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
    "Accept-Encoding": "identity",
    "Referer": "https://" + TARGET_HOST + "/",
    "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  };

  // Copy cookies from visitor (important for session)
  if (req.headers["cookie"]) {
    fetchHeaders["Cookie"] = req.headers["cookie"];
  }

  var fetchOptions = {
    method: req.method,
    headers: fetchHeaders,
    redirect: "manual",
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    var bodyBuffer = await collectRequestBody(req);
    if (bodyBuffer.length > 0) {
      fetchOptions.body = bodyBuffer;
    }
  }

  var response;
  try {
    response = await fetch(targetUrl.toString(), fetchOptions);
  } catch (err) {
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Bad Gateway");
    return;
  }

  // ========== HANDLE REDIRECT ==========
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    var location = response.headers.get("location");
    if (location) {
      if (isBlockedDomain(location)) {
        res.writeHead(204);
        res.end();
        return;
      }

      var newLoc;
      try {
        var locUrl = new URL(location, "https://" + TARGET_HOST);
        locUrl.hostname = mirrorHost;
        locUrl.protocol = mirrorProto + ":";
        newLoc = locUrl.toString();
      } catch (e) {
        newLoc = deepRewriteDomains(location, mirrorHost, mirrorProto);
      }

      var respHeaders = {};
      response.headers.forEach(function (value, key) {
        respHeaders[key] = value;
      });
      respHeaders["location"] = newLoc;

      res.writeHead(response.status, respHeaders);
      var redirectBody = await response.arrayBuffer();
      res.end(Buffer.from(redirectBody));
      return;
    }
  }

  // ========== RESPONSE HEADER CLEANUP ==========
  var skipResponseHeaders = new Set([
    "content-security-policy",
    "content-security-policy-report-only",
    "x-frame-options",
    "content-length",
    "content-encoding",
    "transfer-encoding",
    "connection",
    "link",
  ]);

  var responseHeaders = {};
  response.headers.forEach(function (value, key) {
    if (!skipResponseHeaders.has(key.toLowerCase())) {
      responseHeaders[key] = value;
    }
  });
  responseHeaders["access-control-allow-origin"] = "*";

  var contentType = response.headers.get("content-type") || "";

  // ========== HTML ==========
  if (contentType.includes("text/html")) {
    var body = await response.text();

    // Step 1: Deep rewrite all source domain references
    body = deepRewriteDomains(body, mirrorHost, mirrorProto);

    // Step 2: SEO tag rewriting (canonical, og:url, robots, JSON-LD, etc.)
    body = rewriteHtmlForSeo(body, mirrorHost, mirrorProto, pathname);

    // Step 3: Remove ad banners
    for (var adDomain of blockedAdLinkDomains) {
      var adRegex = new RegExp(
        "<center>\\s*<a\\s+[^>]*href=[\"'][^\"']*" +
          adDomain.replace(/\./g, "\\.") +
          "[^\"']*[\"'][^>]*>\\s*<img[^>]*>\\s*</a>\\s*</center>",
        "gi"
      );
      body = body.replace(adRegex, "");
    }
    body = body.replace(
      /<center>\s*<a\s+[^>]*rel=["']nofollow["'][^>]*>\s*<img\s+[^>]*blogger\.googleusercontent\.com[^>]*>\s*<\/a>\s*<\/center>/gi,
      ""
    );

    // Step 4: Inject adblock script
    var adblockScript = buildAdblockScript();
    if (body.includes("</body>")) {
      body = body.replace("</body>", adblockScript + "</body>");
    } else if (body.includes("</BODY>")) {
      body = body.replace("</BODY>", adblockScript + "</BODY>");
    } else {
      body += adblockScript;
    }

    // Step 5: Rewrite Set-Cookie domains
    var setCookies = response.headers.getSetCookie
      ? response.headers.getSetCookie()
      : [];

    if (setCookies.length) {
      delete responseHeaders["set-cookie"];
      var rewritten = setCookies.map(function (c) {
        return c.replace(/domain=[^;]+/gi, "domain=" + mirrorHost);
      });
      responseHeaders["set-cookie"] = rewritten;
    }

    // Step 6: Set proper SEO response headers
    var canonicalUrl = mirrorOrigin + pathname;
    responseHeaders["content-type"] = "text/html; charset=utf-8";
    responseHeaders["x-robots-tag"] = "index, follow";
    responseHeaders["link"] = "<" + canonicalUrl + '>; rel="canonical"';

    var buf = Buffer.from(body, "utf-8");
    res.writeHead(response.status, responseHeaders);
    res.end(buf);
    return;
  }

  // ========== CSS ==========
  if (contentType.includes("text/css")) {
    var cssBody = await response.text();
    cssBody = deepRewriteDomains(cssBody, mirrorHost, mirrorProto);

    res.writeHead(response.status, responseHeaders);
    res.end(Buffer.from(cssBody, "utf-8"));
    return;
  }

  // ========== JAVASCRIPT / JSON ==========
  if (contentType.includes("javascript") || contentType.includes("application/json")) {
    var jsBody = await response.text();
    jsBody = deepRewriteDomains(jsBody, mirrorHost, mirrorProto);

    res.writeHead(response.status, responseHeaders);
    res.end(Buffer.from(jsBody, "utf-8"));
    return;
  }

  // ========== XML (RSS, ATOM, other sitemaps) ==========
  if (contentType.includes("xml") || contentType.includes("rss") || contentType.includes("atom")) {
    var xmlBody = await response.text();
    xmlBody = deepRewriteDomains(xmlBody, mirrorHost, mirrorProto);

    res.writeHead(response.status, responseHeaders);
    res.end(Buffer.from(xmlBody, "utf-8"));
    return;
  }

  // ========== OTHER (binary passthrough) ==========
  res.writeHead(response.status, responseHeaders);
  var arrayBuf = await response.arrayBuffer();
  res.end(Buffer.from(arrayBuf));
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

server.listen(PORT, "0.0.0.0", function () {
  console.log("Mirror proxy running on port " + PORT);
});