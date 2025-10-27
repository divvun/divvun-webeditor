/**
 * Version Checker - Detects when a new version is available
 */

const STORAGE_KEY = "divvun-editor-content-backup";
const RESTORE_FLAG_KEY = "divvun-editor-restore-pending";

export class VersionChecker {
  private currentVersion: string | null = null;
  private checkInterval: number = 5 * 60 * 1000; // Check every 5 minutes
  private intervalId: number | null = null;

  constructor() {
    this.currentVersion = this.extractVersion();
  }

  /**
   * Extract version from script tags
   */
  private extractVersion(): string | null {
    const scripts = document.querySelectorAll('script[src*="?v="]');
    for (const script of scripts) {
      const match = script.getAttribute("src")?.match(/v=([^&]+)/);
      if (match) {
        return match[1];
      }
    }
    return null;
  }

  /**
   * Save editor content to localStorage before reload
   */
  static saveEditorContent(content: string): void {
    try {
      localStorage.setItem(STORAGE_KEY, content);
      localStorage.setItem(RESTORE_FLAG_KEY, "true");
      console.log("💾 Editor content saved for version upgrade");
    } catch (error) {
      console.error("Failed to save editor content:", error);
    }
  }

  /**
   * Check if there's content to restore after a version upgrade
   */
  static hasContentToRestore(): boolean {
    return localStorage.getItem(RESTORE_FLAG_KEY) === "true";
  }

  /**
   * Restore editor content from localStorage after version upgrade
   */
  static restoreEditorContent(): string | null {
    try {
      const content = localStorage.getItem(STORAGE_KEY);
      // Clear the restore flag and saved content
      localStorage.removeItem(RESTORE_FLAG_KEY);
      if (content) {
        console.log("♻️ Editor content restored after version upgrade");
        // Keep the backup for a bit in case of issues
        setTimeout(() => {
          localStorage.removeItem(STORAGE_KEY);
        }, 60000); // Clear after 1 minute
      }
      return content;
    } catch (error) {
      console.error("Failed to restore editor content:", error);
      return null;
    }
  }

  /**
   * Check if a new version is available
   */
  async checkForUpdate(): Promise<boolean> {
    try {
      // Fetch the HTML page with cache-busting
      const response = await fetch("/", {
        cache: "no-cache",
        headers: {
          "Cache-Control": "no-cache",
        },
      });

      if (!response.ok) {
        return false;
      }

      const html = await response.text();

      // Extract version from the HTML
      const match = html.match(/v=([a-z0-9]+)/);
      const latestVersion = match ? match[1] : null;

      if (
        latestVersion && this.currentVersion &&
        latestVersion !== this.currentVersion
      ) {
        console.log(
          `🆕 New version available: ${latestVersion} (current: ${this.currentVersion})`,
        );
        return true;
      }

      return false;
    } catch (error) {
      console.error("Error checking for updates:", error);
      return false;
    }
  }

  /**
   * Start periodic version checking
   */
  startChecking(onUpdateAvailable: () => void): void {
    // Check immediately
    this.checkForUpdate().then((hasUpdate) => {
      if (hasUpdate) {
        onUpdateAvailable();
      }
    });

    // Then check periodically
    this.intervalId = setInterval(async () => {
      const hasUpdate = await this.checkForUpdate();
      if (hasUpdate) {
        onUpdateAvailable();
      }
    }, this.checkInterval);
  }

  /**
   * Stop checking for updates
   */
  stopChecking(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Reload the page to get the new version
   */
  reloadPage(): void {
    globalThis.location.reload();
  }
}

/**
 * Show a notification to the user about a new version
 */
export function showUpdateNotification(
  onReload: () => void,
  getEditorContent?: () => string,
): void {
  const notification = document.createElement("div");
  notification.className =
    "fixed bottom-4 right-4 bg-blue-600 text-white px-6 py-4 rounded-lg shadow-2xl z-50 max-w-sm animate-slide-up";
  notification.innerHTML = `
    <div class="flex items-start gap-3">
      <div class="flex-shrink-0">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
      </div>
      <div class="flex-1">
        <h3 class="font-semibold mb-1">New Version Available</h3>
        <p class="text-sm text-blue-100 mb-1">A new version of the editor is available.</p>
        <p class="text-sm text-blue-50 font-medium mb-3">Your text will be automatically preserved</p>
        <div class="flex gap-2">
          <button id="reload-btn" class="px-4 py-1.5 bg-white text-blue-600 font-medium rounded hover:bg-blue-50 transition-colors text-sm">
            Reload Now
          </button>
          <button id="dismiss-btn" class="px-4 py-1.5 bg-blue-700 text-white font-medium rounded hover:bg-blue-800 transition-colors text-sm">
            Later
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(notification);

  // Handle reload button
  notification.querySelector("#reload-btn")?.addEventListener("click", () => {
    // Save editor content before reloading
    if (getEditorContent) {
      const content = getEditorContent();
      VersionChecker.saveEditorContent(content);
    }
    onReload();
  });

  // Handle dismiss button
  notification.querySelector("#dismiss-btn")?.addEventListener("click", () => {
    notification.remove();
  });
}
