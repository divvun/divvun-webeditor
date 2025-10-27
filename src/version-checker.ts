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
  notification.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background-color: #2563eb;
    color: white;
    padding: 1.5rem;
    border-radius: 0.75rem;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
    z-index: 9999;
    max-width: 400px;
    animation: slide-up 0.3s ease-out;
  `;

  notification.innerHTML = `
    <div style="display: flex; gap: 1rem; align-items: flex-start;">
      <div style="flex-shrink: 0;">
        <svg style="width: 24px; height: 24px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
      </div>
      <div style="flex: 1;">
        <h3 style="font-weight: 600; margin-bottom: 0.5rem; font-size: 1.125rem;">New Version Available</h3>
        <p style="font-size: 0.875rem; color: #dbeafe; margin-bottom: 0.25rem;">A new version of the editor is available.</p>
        <p style="font-size: 0.875rem; color: #eff6ff; font-weight: 500; margin-bottom: 1rem;">Your text will be automatically preserved</p>
        <div style="display: flex; gap: 0.5rem;">
          <button id="reload-btn" style="
            padding: 0.5rem 1rem;
            background-color: white;
            color: #2563eb;
            font-weight: 500;
            border-radius: 0.375rem;
            border: none;
            cursor: pointer;
            font-size: 0.875rem;
            transition: background-color 0.2s;
          ">
            Reload Now
          </button>
          <button id="dismiss-btn" style="
            padding: 0.5rem 1rem;
            background-color: #1d4ed8;
            color: white;
            font-weight: 500;
            border-radius: 0.375rem;
            border: none;
            cursor: pointer;
            font-size: 0.875rem;
            transition: background-color 0.2s;
          ">
            Later
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(notification);

  // Add hover effects
  const reloadBtn = notification.querySelector(
    "#reload-btn",
  ) as HTMLButtonElement;
  const dismissBtn = notification.querySelector(
    "#dismiss-btn",
  ) as HTMLButtonElement;

  if (reloadBtn) {
    reloadBtn.addEventListener("mouseenter", () => {
      reloadBtn.style.backgroundColor = "#eff6ff";
    });
    reloadBtn.addEventListener("mouseleave", () => {
      reloadBtn.style.backgroundColor = "white";
    });
    reloadBtn.addEventListener("click", () => {
      // Save editor content before reloading
      if (getEditorContent) {
        const content = getEditorContent();
        VersionChecker.saveEditorContent(content);
      }
      onReload();
    });
  }

  if (dismissBtn) {
    dismissBtn.addEventListener("mouseenter", () => {
      dismissBtn.style.backgroundColor = "#1e40af";
    });
    dismissBtn.addEventListener("mouseleave", () => {
      dismissBtn.style.backgroundColor = "#1d4ed8";
    });
    dismissBtn.addEventListener("click", () => {
      notification.remove();
    });
  }
}
