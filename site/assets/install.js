(function () {
  "use strict";

  var node = document.getElementById("bbn-release");
  if (!node) return;
  var data;
  try {
    data = JSON.parse(node.textContent);
  } catch (error) {
    return;
  }
  if (!data || !data.assets || !data.assets.windows || !data.assets.macos || !data.assets.linux) return;

  var labels = {
    windows: "ดาวน์โหลด Windows x64",
    macos: "ดาวน์โหลด macOS arm64",
    linux: "ดาวน์โหลด Linux amd64"
  };

  function bytes(size) {
    return String(size).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " ไบต์";
  }

  function detect() {
    var ua = navigator.userAgent || "";
    var touchMac = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    if (/Android|iPhone|iPad|iPod/i.test(ua) || touchMac) return "";
    var platform = "";
    if (navigator.userAgentData && navigator.userAgentData.platform) {
      platform = navigator.userAgentData.platform;
    }
    if (platform === "Windows" || /Windows/i.test(ua)) return "windows";
    if (platform === "macOS" || /Macintosh|Mac OS X/i.test(ua)) return "macos";
    if (platform === "Linux" || /Linux/i.test(ua)) return "linux";
    return "";
  }

  function textFor(key) {
    if (key === "tag") return data.tag;
    var assetKey = key.split("-").slice(1).join("-");
    var asset = data.assets[assetKey];
    if (!asset) return null;
    if (key.indexOf("sha-") === 0) return asset.sha256;
    if (key.indexOf("size-") === 0) return bytes(asset.size);
    if (key.indexOf("name-") === 0) return asset.name;
    if (key.indexOf("verify-") === 0) return asset.verify;
    if (key.indexOf("line-") === 0) return asset.arch + " · " + data.tag + " · " + bytes(asset.size);
    return null;
  }

  function hrefFor(key) {
    if (key === "notes") return data.notes_url;
    if (key === "sums") return data.sums_url;
    var asset = data.assets[key];
    return asset ? asset.url : "";
  }

  document.querySelectorAll("[data-release]").forEach(function (item) {
    var value = textFor(item.getAttribute("data-release"));
    if (value) item.textContent = value;
  });
  document.querySelectorAll("[data-release-href]").forEach(function (item) {
    var value = hrefFor(item.getAttribute("data-release-href"));
    if (value) item.setAttribute("href", value);
  });

  var os = detect();
  document.body.setAttribute("data-detected", os || "unknown");
  document.querySelectorAll("[data-os]").forEach(function (item) {
    var mine = item.getAttribute("data-os") === os;
    item.classList.toggle("is-this", mine);
    var chip = item.querySelector("[data-chip]");
    if (chip) chip.hidden = !mine;
  });

  var primary = document.getElementById("primary-download");
  var meta = document.getElementById("primary-meta");
  var asset = os ? data.assets[os] : null;
  if (primary && asset) {
    primary.href = asset.url;
    primary.textContent = labels[os];
  }
  if (meta) {
    meta.textContent = asset
      ? data.tag + " · " + bytes(asset.size) + " · เครื่องนี้"
      : "เบราว์เซอร์ไม่ได้บอก Windows, macOS หรือ Linux ให้เลือกไฟล์ด้านล่าง รุ่น " + data.tag;
  }

  document.querySelectorAll(".actions [data-os]").forEach(function (item) {
    var mine = item.getAttribute("data-os") === os;
    item.classList.toggle("secondary", !mine);
    item.style.order = mine ? "0" : "1";
  });

  var live = document.getElementById("copy-status");
  document.querySelectorAll("[data-copy]").forEach(function (button) {
    button.addEventListener("click", function () {
      var source = document.getElementById(button.getAttribute("data-copy"));
      var text = source ? source.textContent.trim() : "";
      if (!text || !live) return;
      var done = function () { live.textContent = "คัดลอกแล้ว"; };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done).catch(function () { fallback(text, done); });
      } else {
        fallback(text, done);
      }
    });
  });

  function fallback(text, done) {
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("aria-hidden", "true");
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    done();
  }
})();
