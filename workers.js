export default {
  async fetch(request) {
    const url = new URL(request.url);
    const originalHost = url.hostname;
    const originalProto = url.protocol.replace(":", "");
    const originalOrigin = originalProto + "://" + originalHost;
    const targetHost = "doujindesu.tv";
    const sitemapSource = "doujindesu.tv";

    // All source domains to rewrite
    const sourceDomains = [
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

    const isBlockedDomain = (hostOrUrl) => {
      if (!hostOrUrl) return false;
      const s = hostOrUrl.toLowerCase();
      return blockedDomains.some((d) => s === d || s.endsWith("." + d) || s.includes(d));
    };

    // ========== DEEP DOMAIN REWRITING ==========
    const deepRewrite = (text) => {
      let result = text;
      for (const src of sourceDomains) {
        result = result.split("https://" + src).join(originalProto + "://" + originalHost);
        result = result.split("http://" + src).join(originalProto + "://" + originalHost);
        result = result.split("//" + src).join("//" + originalHost);
        result = result.split(src).join(originalHost);
      }
      return result;
    };

    // ========== SEO REWRITING ==========
    const rewriteHtmlForSeo = (body, pathname) => {
      const canonicalUrl = originalOrigin + pathname;
      let b = body;

      // Remove existing canonical
      b = b.replace(/<link\s+[^>]*rel=["']canonical["'][^>]*\/?>/gi, "");
      // Remove existing og:url
      b = b.replace(/<meta\s+[^>]*property=["']og:url["'][^>]*\/?>/gi, "");
      // Remove alternate/hreflang
      b = b.replace(/<link\s+[^>]*rel=["']alternate["'][^>]*hreflang[^>]*\/?>/gi, "");
      // Remove noindex
      b = b.replace(/<meta\s+[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex[^"']*["'][^>]*\/?>/gi, "");
      b = b.replace(/<meta\s+[^>]*content=["'][^"']*noindex[^"']*["'][^>]*name=["']robots["'][^>]*\/?>/gi, "");

      // Rewrite og:image, twitter:image
      b = b.replace(
        /(<meta\s+[^>]*(?:property|name)=["'](?:og:image|og:image:url|og:image:secure_url|twitter:image)[^"']*["'][^>]*content=["'])([^"']+)(["'][^>]*\/?>)/gi,
        (match, before, imgUrl, after) => {
          let nu = imgUrl;
          for (const src of sourceDomains) nu = nu.split(src).join(originalHost);
          return before + nu + after;
        }
      );

      // Rewrite JSON-LD
      b = b.replace(
        /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
        (match, json) => {
          let rw = json;
          for (const src of sourceDomains) {
            rw = rw.split("https://" + src).join(originalOrigin);
            rw = rw.split("http://" + src).join(originalOrigin);
            rw = rw.split(src).join(originalHost);
          }
          return match.replace(json, rw);
        }
      );

      // Inject canonical + og:url + robots meta
      const seoTags =
        '<link rel="canonical" href="' + canonicalUrl + '" />\n' +
        '<meta property="og:url" content="' + canonicalUrl + '" />\n' +
        '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />';
      if (b.match(/<head[^>]*>/i)) {
        b = b.replace(/(<head[^>]*>)/i, "$1\n" + seoTags + "\n");
      }

      // Rewrite form actions
      b = b.replace(
        /(<form\s+[^>]*action=["'])([^"']+)(["'])/gi,
        (m, before, u, after) => {
          let nu = u;
          for (const src of sourceDomains) nu = nu.split(src).join(originalHost);
          return before + nu + after;
        }
      );

      // Rewrite srcset
      b = b.replace(
        /(srcset=["'])([^"']+)(["'])/gi,
        (m, before, ss, after) => {
          let nu = ss;
          for (const src of sourceDomains) nu = nu.split(src).join(originalHost);
          return before + nu + after;
        }
      );

      // Rewrite data-src, data-url, data-lazy-src, data-bg
      b = b.replace(
        /((?:data-src|data-url|data-lazy-src|data-original|data-bg)=["'])([^"']+)(["'])/gi,
        (m, before, u, after) => {
          let nu = u;
          for (const src of sourceDomains) nu = nu.split(src).join(originalHost);
          return before + nu + after;
        }
      );

      // Rewrite inline CSS url()
      b = b.replace(
        /(url\s*\(\s*['"]?)([^)'"]+)(['"]?\s*\))/gi,
        (m, before, u, after) => {
          let nu = u;
          for (const src of sourceDomains) nu = nu.split(src).join(originalHost);
          return before + nu + after;
        }
      );

      return b;
    };

    const requestUrlLower = url.toString().toLowerCase();
    const reqHostLower = url.hostname.toLowerCase();

    // ========== ROBOTS.TXT ==========
    if (url.pathname === "/robots.txt") {
      const body =
        "User-agent: *\nAllow: /\n\nSitemap: " +
        originalOrigin + "/sitemap.xml\n";
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    // ========== SITEMAP (rewrite URLs to mirror domain) ==========
    if (url.pathname === "/sitemap.xml" || url.pathname.startsWith("/sitemap")) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      const sitemapUrl = "https://" + sitemapSource + url.pathname;
      const resp = await fetch(sitemapUrl, {
        method: request.method,
        headers: {
          "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0",
          Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
        },
      });

      let sitemapBody = await resp.text();
      sitemapBody = deepRewrite(sitemapBody);

      return new Response(sitemapBody, {
        status: resp.status,
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // ========== BLOCK LIST ==========
    if (isBlockedDomain(reqHostLower) || isBlockedDomain(requestUrlLower)) {
      return new Response("", { status: 204 });
    }

    if (requestUrlLower.includes("/get/")) {
      const h = url.hostname.toLowerCase();
      if (!h.includes(targetHost) && !h.includes(originalHost)) {
        return new Response("", { status: 204 });
      }
    }

    // ========== REWRITE DESTINATION ==========
    url.hostname = targetHost;

    // ========== HEADERS ==========
    const newHeaders = new Headers(request.headers);
    newHeaders.set("Host", targetHost);
    newHeaders.set("Origin", "https://" + targetHost);
    newHeaders.set("Referer", "https://" + targetHost + "/");
    newHeaders.delete("cf-connecting-ip");
    newHeaders.delete("cf-ray");
    newHeaders.delete("cf-visitor");

    // ========== BUILD REQUEST ==========
    const init = {
      method: request.method,
      headers: newHeaders,
      redirect: "manual",
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
    }

    const modifiedRequest = new Request(url.toString(), init);
    let response = await fetch(modifiedRequest);

    // ========== HANDLE REDIRECT ==========
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      let location = response.headers.get("Location");
      if (location) {
        if (isBlockedDomain(location)) {
          return new Response("", { status: 204 });
        }

        let newLoc;
        try {
          const locUrl = new URL(location, "https://" + targetHost);
          locUrl.hostname = originalHost;
          newLoc = locUrl.toString();
        } catch {
          newLoc = deepRewrite(location);
        }

        const newResponseHeaders = new Headers(response.headers);
        newResponseHeaders.set("Location", newLoc);

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newResponseHeaders,
        });
      }
    }

    // ========== COMMON RESPONSE HEADER CLEANUP ==========
    const buildBaseHeaders = (resp) => {
      const h = new Headers(resp.headers);
      h.delete("Content-Security-Policy");
      h.delete("Content-Security-Policy-Report-Only");
      h.delete("X-Frame-Options");
      h.delete("Content-Length");
      h.delete("Link");
      h.set("Access-Control-Allow-Origin", "*");
      return h;
    };

    const contentType = response.headers.get("Content-Type") || "";
    const pathname = new URL(request.url).pathname;

    // ========== HTML ==========
    if (contentType.includes("text/html")) {
      let body = await response.text();

      // Step 1: Deep rewrite all domain references
      body = deepRewrite(body);

      // Step 2: SEO rewriting
      body = rewriteHtmlForSeo(body, pathname);

      // Step 3: Remove ad banners
      for (const adDomain of blockedAdLinkDomains) {
        const adRegex = new RegExp(
          "<center>\\s*<a\\s+[^>]*href=[\"'][^\"']*" + adDomain.replace(/\./g, "\\.") + "[^\"']*[\"'][^>]*>\\s*<img[^>]*>\\s*</a>\\s*</center>",
          "gi"
        );
        body = body.replace(adRegex, "");
      }
      body = body.replace(
        /<center>\s*<a\s+[^>]*rel=["']nofollow["'][^>]*>\s*<img\s+[^>]*blogger\.googleusercontent\.com[^>]*>\s*<\/a>\s*<\/center>/gi,
        ""
      );

      // Step 4: Inject adblock script
      const adblockScript = `
<style id="proxy-adblock-css">
div[style*="position:fixed"][style*="z-index:2147483647"],
div[style*="position: fixed"][style*="z-index:2147483647"],
div[style*="position:fixed"][style*="z-index:99999"],
div[style*="position: fixed"][style*="z-index:99999"],
iframe[src*="popads"], iframe[src*="popcash"],
iframe[src*="propellerads"], iframe[src*="exoclick"],
iframe[src*="adsterra"], iframe[src*="hilltopads"],
img[src*="frozenpayerpregnant"], img[src*="footbathmockerpurse"], img[src*="pncloudfl"],
script[src*="frozenpayerpregnant"], script[src*="footbathmockerpurse"], script[src*="pncloudfl"],
script[src*="popads"], script[src*="popcash"], script[src*="propellerads"],
script[src*="exoclick"], script[src*="adsterra"], script[src*="hilltopads"],
a[href*="popads"], a[href*="popcash"], a[href*="propellerads"], a[href*="exoclick"], a[href*="adsterra"], a[href*="hilltopads"],
a[href*="linkol.xyz"], a[href*="dw.zeus.fun"], a[href*="gacor.zone"],
a[href*="klik.top"], a[href*="aksesin.top"], a[href*="menujupenta.site"],
a[href*="gacor.vin"], a[href*="cek.to"]{
  display:none !important;
  visibility:hidden !important;
  pointer-events:none !important;
}
center:has(> a[rel="nofollow"] > img.img-responsive){
  display:none !important;
}
</style>
<script id="proxy-adblock-js">
(function(){
  'use strict';
  var adPatterns = ${JSON.stringify(blockedDomains.map(d => d.split(".")[0]))};
  var adLinkPatterns = ${JSON.stringify(blockedAdLinkDomains)};
  function isAd(str){
    if(!str) return false;
    var s = (""+str).toLowerCase();
    for(var i=0;i<adPatterns.length;i++){
      if(s.indexOf(adPatterns[i]) !== -1) return true;
    }
    return false;
  }
  function isAdLink(str){
    if(!str) return false;
    var s = (""+str).toLowerCase();
    for(var i=0;i<adLinkPatterns.length;i++){
      if(s.indexOf(adLinkPatterns[i]) !== -1) return true;
    }
    return false;
  }
  function clean(){
    var divs = document.querySelectorAll('div[style*="position:fixed"], div[style*="position: fixed"]');
    for(var i=0;i<divs.length;i++){
      var d = divs[i];
      var st = (d.getAttribute('style')||'').toLowerCase();
      if(st.includes('z-index:2147483647') || st.includes('z-index: 2147483647') ||
         st.includes('z-index:99999') || st.includes('z-index: 99999')){
        d.remove();
      }
    }
    var ifr = document.querySelectorAll('iframe');
    for(var j=0;j<ifr.length;j++){
      if(isAd(ifr[j].src)) ifr[j].remove();
    }
    var sc = document.querySelectorAll('script[src]');
    for(var k=0;k<sc.length;k++){
      if(isAd(sc[k].src)) sc[k].remove();
    }
    var allLinks = document.querySelectorAll('a[rel="nofollow"]');
    for(var m=0;m<allLinks.length;m++){
      var link = allLinks[m];
      if(isAdLink(link.href)){
        var parent = link.parentElement;
        if(parent && parent.tagName === 'CENTER') parent.remove();
        else link.remove();
      }
    }
  }
  var _open = window.open;
  window.open = function(u){
    if(!u || isAd(u) || isAdLink(u)) return null;
    return _open.apply(window, arguments);
  };
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ clean(); });
  } else clean();
  setInterval(clean, 2000);
  if(window.MutationObserver){
    var obs = new MutationObserver(function(m){
      for(var i=0;i<m.length;i++){
        if(m[i].addedNodes && m[i].addedNodes.length){ clean(); break; }
      }
    });
    obs.observe(document.documentElement, {childList:true, subtree:true});
  }
})();
</script>`;

      if (body.includes("</body>")) {
        body = body.replace("</body>", adblockScript + "</body>");
      } else if (body.includes("</BODY>")) {
        body = body.replace("</BODY>", adblockScript + "</BODY>");
      } else {
        body += adblockScript;
      }

      const newResponseHeaders = buildBaseHeaders(response);

      // Rewrite cookies
      const setCookies = typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : (response.headers.get("Set-Cookie") ? [response.headers.get("Set-Cookie")] : []);

      if (setCookies.length) {
        newResponseHeaders.delete("Set-Cookie");
        for (const c of setCookies) {
          const rewritten = c.replace(/domain=[^;]+/gi, "domain=" + originalHost);
          newResponseHeaders.append("Set-Cookie", rewritten);
        }
      }

      // SEO response headers
      const canonicalUrl = originalOrigin + pathname;
      newResponseHeaders.set("X-Robots-Tag", "index, follow");
      newResponseHeaders.set("Link", "<" + canonicalUrl + '>; rel="canonical"');

      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: newResponseHeaders,
      });
    }

    // ========== CSS ==========
    if (contentType.includes("text/css")) {
      let body = await response.text();
      body = deepRewrite(body);

      const newResponseHeaders = buildBaseHeaders(response);
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: newResponseHeaders,
      });
    }

    // ========== JS / JSON ==========
    if (contentType.includes("javascript") || contentType.includes("application/json")) {
      let body = await response.text();
      body = deepRewrite(body);

      const newResponseHeaders = buildBaseHeaders(response);
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: newResponseHeaders,
      });
    }

    // ========== XML (RSS, ATOM) ==========
    if (contentType.includes("xml") || contentType.includes("rss") || contentType.includes("atom")) {
      let body = await response.text();
      body = deepRewrite(body);

      const newResponseHeaders = buildBaseHeaders(response);
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: newResponseHeaders,
      });
    }

    // ========== OTHER ==========
    const newResponseHeaders = buildBaseHeaders(response);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newResponseHeaders,
    });
  },
};