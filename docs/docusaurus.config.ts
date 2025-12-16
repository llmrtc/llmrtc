import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';

const config: Config = {
  title: 'LLMRTC Docs',
  tagline: 'Build real-time voice & vision AI with WebRTC + LLMs',
  url: 'https://www.llmrtc.org',
  baseUrl: '/',
  onBrokenLinks: 'throw',
  scripts: [
    {
      src: 'https://data.nextpath.co/script.js',
      defer: true,
      'data-website-id': '99f14850-1e2f-4cf8-a650-0bc9d6417e9c',
    },
  ],
  headTags: [
    {
      tagName: 'link',
      attributes: {
        rel: 'apple-touch-icon',
        sizes: '180x180',
        href: '/img/apple-touch-icon.png',
      },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'icon',
        type: 'image/png',
        sizes: '32x32',
        href: '/img/favicon-32x32.png',
      },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'icon',
        type: 'image/png',
        sizes: '16x16',
        href: '/img/favicon-16x16.png',
      },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'manifest',
        href: '/manifest.json',
      },
    },
    {
      tagName: 'meta',
      attributes: {
        name: 'theme-color',
        content: '#18E0FF',
      },
    },
  ],
  markdown: {
    mermaid: true,
  },
  themes: ['@docusaurus/theme-mermaid'],
  favicon: 'img/favicon.svg',
  organizationName: 'llmrtc',
  projectName: 'llmrtc',
  i18n: {
    defaultLocale: 'en',
    locales: ['en']
  },
  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/',
          editUrl: 'https://github.com/llmrtc/llmrtc/edit/main/docs/'
        },
        blog: {
          showReadingTime: true,
          routeBasePath: '/blog'
        },
        theme: {
          customCss: './src/css/custom.css'
        }
      }
    ]
  ],
  themeConfig: {
    image: 'img/og-image.png',
    navbar: {
      title: 'LLMRTC',
      logo: {
        alt: 'LLMRTC Logo',
        src: 'img/logo.svg'
      },
      items: [
        {to: '/', label: 'Docs', position: 'left'},
        {to: '/recipes/minimal-voice-assistant', label: 'Examples', position: 'left'},
        {to: '/providers/overview', label: 'Providers', position: 'left'},
        {to: '/protocol/overview', label: 'Protocol', position: 'left'},
        {to: '/operations/troubleshooting', label: 'Troubleshooting', position: 'left'},
        {href: 'https://github.com/llmrtc/llmrtc', label: 'GitHub', position: 'right'}
      ]
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {label: 'Getting Started', to: '/getting-started/overview'},
            {label: 'Backend', to: '/backend/overview'},
            {label: 'Web Client', to: '/web-client/overview'}
          ]
        },
        {
          title: 'Guides',
          items: [
            {label: 'Recipes', to: '/recipes/minimal-voice-assistant'},
            {label: 'Operations', to: '/operations/troubleshooting'},
            {label: 'Providers', to: '/providers/overview'}
          ]
        },
        {
          title: 'Community',
          items: [
            {label: 'GitHub', href: 'https://github.com/llmrtc/llmrtc'},
            {label: 'Issues', href: 'https://github.com/llmrtc/llmrtc/issues'}
          ]
        }
      ],
      copyright: `© ${new Date().getFullYear()} Metered.ca`
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula
    }
  }
};

export default config;
