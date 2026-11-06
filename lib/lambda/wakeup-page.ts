/**
 * Generates the responsive, dark-mode auto-polling HTML splash screen
 * displayed to users while Paperless-NGX is booting up.
 */
export function renderWakeupPage(requestedPath: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Paperless-NGX is Waking Up</title>
  <link rel="icon" type="image/x-icon" href="/favicon.ico">
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #38bdf8;
      --accent: #0ea5e9;
      --border: #334155;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1.5rem;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 1rem;
      padding: 2.5rem 2rem;
      max-width: 480px;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
    }
    .icon {
      width: 64px;
      height: 64px;
      margin: 0 auto 1.5rem;
      color: var(--primary);
      animation: pulse 2s infinite ease-in-out;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 0.75rem;
    }
    p {
      color: var(--text-muted);
      font-size: 0.95rem;
      line-height: 1.5;
      margin-bottom: 1.5rem;
    }
    .progress-bar-container {
      background: var(--border);
      height: 8px;
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 1rem;
      position: relative;
    }
    .progress-bar {
      height: 100%;
      width: 35%;
      background: linear-gradient(90deg, var(--accent), var(--primary));
      border-radius: 4px;
      position: absolute;
      animation: indeterminate 2s infinite ease-in-out;
    }
    .status-text {
      font-size: 0.85rem;
      color: var(--primary);
      font-weight: 500;
      min-height: 1.25rem;
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 0.9; }
      50% { transform: scale(1.08); opacity: 1; }
    }
    @keyframes indeterminate {
      0% { left: -35%; }
      100% { left: 100%; }
    }
  </style>
</head>
<body>
  <div class="card">
    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
      <line x1="16" y1="13" x2="8" y2="13"></line>
      <line x1="16" y1="17" x2="8" y2="17"></line>
      <polyline points="10 9 9 9 8 9"></polyline>
    </svg>
    <h1>Waking Up Paperless-NGX</h1>
    <p>Your on-demand instance was asleep to save cost. The server is spinning up now and will automatically open once ready (~15–25 seconds).</p>
    
    <div class="progress-bar-container">
      <div class="progress-bar"></div>
    </div>
    <div class="status-text" id="status-text">Starting server instance...</div>
  </div>

  <script>
    (function() {
      const statusText = document.getElementById('status-text');
      let attempts = 0;

      async function checkStatus() {
        attempts++;
        try {
          const actionParam = attempts === 1 ? '&action=wake' : '';
          const res = await fetch('/__wakeup/status?t=' + Date.now() + actionParam);
          if (res.ok) {
            const data = await res.json();
            if (data.state === 'running') {
              statusText.textContent = 'Server ready! Connecting...';
              // Reload page once server is warm
              setTimeout(() => {
                globalThis.location.replace('${requestedPath}');
              }, 1200);
              return;
            } else if (data.state === 'starting' || data.state === 'booting' || data.state === 'pending') {
              statusText.textContent = 'Booting containers and mounting storage (' + attempts * 2 + 's)...';
            }
          }
        } catch (e) {
          // Ignore transient network errors while server boots
        }
        setTimeout(checkStatus, 2500);
      }

      // Immediately trigger wakeup via JS and start polling
      setTimeout(checkStatus, 100);
    })();
  </script>
</body>
</html>`;
}

