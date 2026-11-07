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
            const renderMermaid = async () => {
              const codeBlocks = document.querySelectorAll('pre[data-language="mermaid"], pre > code.language-mermaid');
              if (codeBlocks.length === 0) return;
              const isDark = document.documentElement.dataset.theme !== 'light';
              mermaid.initialize({ startOnLoad: false, theme: isDark ? 'dark' : 'default' });
              for (const [i, el] of codeBlocks.entries()) {
                const target = el.tagName === 'CODE' ? el.parentElement : el;
                const code = el.textContent || '';
                try {
                  const { svg } = await mermaid.render('mermaid-svg-' + i, code);
                  const wrapper = document.createElement('div');
                  wrapper.className = 'mermaid-container';
                  wrapper.style.display = 'flex';
                  wrapper.style.justifyContent = 'center';
                  wrapper.style.margin = '1.5rem 0';
                  wrapper.innerHTML = svg;
                  target.replaceWith(wrapper);
                } catch (err) {
                  console.error('Mermaid rendering error:', err);
                }
              }
            };
            if (document.readyState === 'loading') {
              document.addEventListener('DOMContentLoaded', renderMermaid);
            } else {
              renderMermaid();
            }
            document.addEventListener('astro:page-load', renderMermaid);
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
