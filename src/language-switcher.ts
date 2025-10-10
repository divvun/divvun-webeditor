function getCookie(name: string): string | undefined {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(";").shift();
}

function initLanguageSwitcher(): void {
  const langSelect = document.getElementById(
    "lang-select"
  ) as HTMLSelectElement;
  if (!langSelect) return;

  const savedLang = getCookie("lang");
  const currentLang =
    savedLang ||
    (globalThis.location.pathname.startsWith("/se/")
      ? "se"
      : globalThis.location.pathname.startsWith("/sma/")
      ? "sma"
      : "nb");

  langSelect.value = currentLang;

  langSelect.addEventListener("change", function () {
    const lang = this.value;
    document.cookie = `lang=${lang}; path=/; max-age=31536000`; // 1 year

    // Get current path and remove any language prefix
    let currentPath = globalThis.location.pathname;
    if (currentPath.startsWith("/se/")) {
      currentPath = currentPath.substring(3);
    } else if (currentPath.startsWith("/sma/")) {
      currentPath = currentPath.substring(4);
    }

    // Add new language prefix if not nb
    const newPath = lang === "nb" ? currentPath : "/" + lang + currentPath;
    globalThis.location.href = newPath;
  });
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initLanguageSwitcher);
} else {
  initLanguageSwitcher();
}
