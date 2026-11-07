import { describe, it, expect } from 'vitest';
import { renderWakeupPage } from '../lib/lambda/wakeup-page.js';

describe('renderWakeupPage', () => {
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
    expect(html).toContain("fetch('/__wakeup/status?t='");
    expect(html).toContain("attempts === 1 ? '&action=wake' : ''");
    expect(html).toContain("data.state === 'running'");
    expect(html).toContain("data.state === 'starting' || data.state === 'pending'");
    expect(html).toContain("data.state === 'booting'");
    expect(html).toContain('Server ready! Connecting...');
    expect(html).toContain('Spinning up cloud server');
    expect(html).toContain('Mounting S3 storage & starting containers');
    expect(html).toContain('Waking up server');
  });
});
