/* Entry point. */
(function () {
  const start = () => {
    if (!window.Decimal || !window.MD || !MD.core) {
      document.getElementById("content").textContent = "Market Desk couldn't load its decimal-math library from the CDN, so it won't calculate anything rather than risk wrong numbers. Reload the page to try again.";
      return;
    }
    MD.app.boot().catch((e) => { console.error(e); document.getElementById("content").textContent = "Market Desk failed to start: " + (e && e.message); });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
