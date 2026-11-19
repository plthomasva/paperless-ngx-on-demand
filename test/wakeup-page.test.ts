import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vm from 'node:vm';
import { renderWakeupPage } from '../lib/lambda/wakeup-page.js';

function createSplashDomEnvironment(
  targetPath = '/',
  fetchImpl?: (url: string) => Promise<{ ok: boolean; json: () => Promise<{ state?: string }> }>
) {
  const html = renderWakeupPage(targetPath);
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!scriptMatch) {
    throw new Error('Inline script not found in renderWakeupPage output');
  }

  const statusText = { textContent: 'Starting server instance...' };
  const classListSet = new Set<string>();
  const progressBar = {
    style: { width: '5%' },
    classList: {
      add: (cls: string) => classListSet.add(cls),
      remove: (cls: string) => classListSet.delete(cls),
      contains: (cls: string) => classListSet.has(cls),
    },
  };
  const retryListeners: Array<() => void> = [];
  const retryBtn = {
    hidden: true,
    addEventListener: (event: string, cb: () => void) => {
      if (event === 'click') retryListeners.push(cb);
    },
    click: () => {
      for (const cb of retryListeners) cb();
    },
  };

  const docListeners: Record<string, Array<() => void>> = {};
  const documentMock = {
    hidden: false,
    getElementById: (id: string) => {
      if (id === 'status-text') return statusText;
      if (id === 'progress-bar') return progressBar;
      if (id === 'retry-btn') return retryBtn;
      return null;
    },
    addEventListener: (event: string, cb: () => void) => {
      docListeners[event] = docListeners[event] || [];
      docListeners[event].push(cb);
    },
    dispatchVisibilityChange: (hidden: boolean) => {
      documentMock.hidden = hidden;
      for (const cb of docListeners['visibilitychange'] || []) {
        cb();
      }
    },
  };

  const fetchMock = vi.fn(
    fetchImpl ||
      (async () => ({
        ok: true,
        json: async () => ({ state: 'booting' }),
      }))
  );
  const replaceMock = vi.fn();

  const sandbox: Record<string, unknown> = {
    document: documentMock,
    fetch: fetchMock,
    Date,
    Math,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    location: { replace: replaceMock },
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(scriptMatch[1], sandbox);

  return {
    statusText,
    progressBar,
    retryBtn,
    documentMock,
    fetchMock,
    replaceMock,
  };
}

describe('renderWakeupPage', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders valid path starting with slash', () => {
    const html = renderWakeupPage('/documents/view/42');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>Paperless-NGX is Waking Up</title>');
    expect(html).toContain('href="/favicon.ico"');
    expect(html).toContain('Waking Up Paperless-NGX');
    expect(html).toContain('globalThis.location.replace("/documents/view/42");');
  });

  it('falls back to root slash when requestedPath does not start with slash', () => {
    const html = renderWakeupPage('documents/view/42');
    expect(html).toContain('globalThis.location.replace("/");');
    expect(html).not.toContain('globalThis.location.replace("documents');
  });

  it('falls back to root slash when requestedPath contains newline', () => {
    const html = renderWakeupPage('/documents\n/evil');
    expect(html).toContain('globalThis.location.replace("/");');
  });

  it('falls back to root slash when requestedPath contains carriage return', () => {
    const html = renderWakeupPage('/documents\r/evil');
    expect(html).toContain('globalThis.location.replace("/");');
  });

  it('sanitizes angle brackets to prevent XSS breakout in safeTarget', () => {
    const html = renderWakeupPage('/<script>alert(1)</script>');
    expect(html).toContain('\\u003cscript\\u003ealert(1)\\u003c/script\\u003e');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('contains expected DOM elements and polling script logic', () => {
    const html = renderWakeupPage('/');
    expect(html).toContain('id="progress-bar"');
    expect(html).toContain('id="status-text"');
    expect(html).toContain('id="retry-btn"');
    expect(html).toContain('const POLL_INTERVAL_MS = 5000;');
    expect(html).toContain('const MAX_POLL_DURATION_MS = 15 * 60 * 1000;');
    expect(html).toContain("document.addEventListener('visibilitychange'");
    expect(html).toContain('if (document.hidden)');
    expect(html).toContain("retryBtn.addEventListener('click'");
    expect(html).toContain('Taking longer than usual to wake up. Click below to check again.');
    expect(html).toContain("fetch('/__wakeup/status?t='");
    expect(html).toContain(
      "const needsWake = !lastState || lastState === 'stopped' || lastState === 'stopping';"
    );
    expect(html).toContain("const actionParam = needsWake ? '&action=wake' : '';");
    expect(html).toContain("data.state === 'running'");
    expect(html).toContain("data.state === 'starting' || data.state === 'pending'");
    expect(html).toContain("data.state === 'booting'");
    expect(html).toContain('Server ready! Connecting...');
    expect(html).toContain('Spinning up cloud server');
    expect(html).toContain('Mounting S3 storage & starting containers');
    expect(html).toContain('Waking up server');
  });

  it('polls every 5 seconds while visible and redirects when state becomes running', async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const { fetchMock, replaceMock, statusText, progressBar } = createSplashDomEnvironment(
      '/documents',
      async () => {
        callCount++;
        if (callCount === 1) {
          return { ok: true, json: async () => ({ state: 'starting' }) };
        }
        if (callCount === 2) {
          return { ok: true, json: async () => ({ state: 'booting' }) };
        }
        return { ok: true, json: async () => ({ state: 'running' }) };
      }
    );

    // Initial poll fires at 100ms with &action=wake
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('&action=wake');
    expect(statusText.textContent).toContain('Spinning up cloud server');

    // Does NOT poll at 2s (old interval)
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Polls at 5s without &action=wake since lastState is 'starting'
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).not.toContain('&action=wake');
    expect(statusText.textContent).toContain('Mounting S3 storage & starting containers');

    // Polls at 10s -> 'running' -> redirects after 1s
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(statusText.textContent).toBe('Server ready! Connecting...');
    expect(progressBar.style.width).toBe('100%');

    await vi.advanceTimersByTimeAsync(1000);
    expect(replaceMock).toHaveBeenCalledWith('/documents');
  });

  it('pauses polling while document.hidden is true and resumes when visible again', async () => {
    vi.useFakeTimers();
    const { fetchMock, documentMock } = createSplashDomEnvironment('/');

    // Initial poll at 100ms
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Hide the tab before the 5s timer fires
    documentMock.dispatchVisibilityChange(true);

    // Advance 60 seconds while hidden -> zero additional polls
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Make tab visible again -> resumes polling within 100ms
    documentMock.dispatchVisibilityChange(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops polling after 15 minutes and allows manual retry via Check again button', async () => {
    vi.useFakeTimers();
    const { fetchMock, statusText, retryBtn } = createSplashDomEnvironment('/');

    // Advance 15 minutes (900s = at most 180 polls at 5s intervals)
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000 + 1000);
    const pollsAtGiveUp = fetchMock.mock.calls.length;
    expect(pollsAtGiveUp).toBeLessThanOrEqual(181);
    expect(retryBtn.hidden).toBe(false);
    expect(statusText.textContent).toBe(
      'Taking longer than usual to wake up. Click below to check again.'
    );

    // Advance another 10 hours -> zero additional polls after give-up!
    await vi.advanceTimersByTimeAsync(10 * 60 * 60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(pollsAtGiveUp);

    // Clicking "Check again" hides the button, resets state, and triggers &action=wake
    retryBtn.click();
    await vi.advanceTimersByTimeAsync(100);
    expect(retryBtn.hidden).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(pollsAtGiveUp + 1);
    expect(fetchMock.mock.calls[pollsAtGiveUp][0]).toContain('&action=wake');
  });
});
