// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const [ghOwner, ghRepo] = (process.env.GITHUB_REPOSITORY || 'plthomasva/paperless-ngx-on-demand').split('/');
const site = process.env.DOCS_SITE || (ghOwner ? `https://${ghOwner}.github.io` : undefined);
const base = process.env.DOCS_BASE || (ghRepo ? `/${ghRepo}` : undefined);
const githubUrl = `https://github.com/${ghOwner}/${ghRepo}`;

export default defineConfig({
  site,
  base,
  integrations: [
    starlight({
      title: 'Paperless-NGX On-Demand',
      description: 'Scale-to-zero Paperless-NGX deployment on AWS with dynamic CloudFront edge routing',
      social: [{ icon: 'github', label: 'GitHub', href: githubUrl }],
      head: [
        {
          tag: 'script',
          attrs: { type: 'module' },
          content: `
            import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';

            let renderSeq = 0;
            const renderAll = async () => {
              const blocks = document.querySelectorAll('pre[data-language="mermaid"], .mermaid-rendered');
              if (blocks.length === 0) return;
              const isDark = document.documentElement.dataset.theme !== 'light';
              mermaid.initialize({ startOnLoad: false, theme: isDark ? 'dark' : 'default' });

              for (const el of blocks) {
                let code = el.dataset?.mermaidCode;
                let target = el;
                if (!code) {
                  const lines = Array.from(el.querySelectorAll('.ec-line')).map(l => l.textContent);
                  code = lines.length > 0 ? lines.join('\\n') : (el.innerText || '');
                  target = el.closest('figure') || el;
                }
                if (!code.trim()) continue;

                try {
                  const seqId = 'mermaid-svg-' + (++renderSeq);
                  const { svg } = await mermaid.render(seqId, code);
                  const container = document.createElement('div');
                  container.className = 'mermaid-rendered';
                  container.dataset.mermaidCode = code;
                  container.style.display = 'flex';
                  container.style.justifyContent = 'center';
                  container.style.margin = '2rem 0';
                  container.innerHTML = svg;
                  target.replaceWith(container);
                } catch (e) {
                  console.error('Mermaid render error:', e);
                }
              }
            };

            if (document.readyState === 'loading') {
              document.addEventListener('DOMContentLoaded', renderAll);
            } else {
              renderAll();
            }
            document.addEventListener('astro:page-load', renderAll);

            const observer = new MutationObserver(mutations => {
              for (const mutation of mutations) {
                if (mutation.attributeName === 'data-theme') {
                  renderAll();
                  break;
                }
              }
            });
            observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
          `,
        },
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Overview & Architecture', slug: 'overview' },
            { label: 'External Prerequisites', slug: 'prerequisites' },
            { label: 'Quickstart & Installation', slug: 'getting-started' },
          ],
        },
        {
          label: 'Architecture & Internals',
          items: [
            { label: 'Scale-to-Zero Watchdog', slug: 'watchdog' },
            { label: 'Storage & S3 Integration', slug: 'storage' },
          ],
        },
        {
          label: 'Operations & Planning',
          items: [
            { label: 'Evidence-Based Cost Analysis', slug: 'cost-analysis' },
            { label: 'Migration from Raspberry Pi / Docker', slug: 'migration' },
            { label: 'Automated CI/CD & Releases', slug: 'automation' },
            { label: 'Community Outreach Drafts', slug: 'community-outreach' },
          ],
        },
      ],
    }),
  ],
});
