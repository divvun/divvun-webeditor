export default function StatusBar() {
  return (
    <div className="status-bar">
      <div className="status" id="status-display">
        <span id="status-text">Ready</span>
      </div>
      <div className="error-count" id="error-count">
        0 errors
      </div>
    </div>
  );
}