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
          ],
        },
      ],
    }),
  ],
});
