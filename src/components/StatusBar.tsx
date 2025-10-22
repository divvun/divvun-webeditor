import RetryButton from "./RetryButton.tsx";

export default function StatusBar() {
  return (
    <div className="bg-gray-50 border-t border-gray-200 px-6 py-4">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse">
          </div>
          <div
            id="status-display"
            className="text-sm font-medium text-gray-700"
          >
            <span id="status-text">Ready</span>
          </div>
          <RetryButton />
        </div>
        <div
          id="error-count"
          className="px-3 py-1 bg-gray-100 text-gray-600 text-sm font-medium rounded-full border"
        >
          0 errors
        </div>
      </div>
    </div>
  );
}
