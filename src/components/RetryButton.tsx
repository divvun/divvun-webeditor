export default function RetryButton() {
  return (
    <button
      type="button"
      id="retry-button"
      className="hidden ml-2 px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium rounded transition-colors"
      title="Retry grammar check"
    >
      Retry
    </button>
  );
}
