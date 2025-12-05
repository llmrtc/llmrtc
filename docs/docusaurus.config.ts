import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';

const config: Config = {
  title: 'LLMRTC Docs',
  tagline: 'Build real-time voice & vision AI with WebRTC + LLMs',
  url: 'https://metered.ai',
  baseUrl: '/',
  onBrokenLinks: 'throw',
  markdown: {
    mermaid: true,
  },
  themes: ['@docusaurus/theme-mermaid'],
  favicon: 'img/logo.svg',
  organizationName: 'metered',
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
          editUrl: 'https://github.com/metered/llmrtc/edit/main/docs/'
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
    image: 'img/logo.svg',
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
        {href: 'https://github.com/metered/llmrtc', label: 'GitHub', position: 'right'}
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
            {label: 'GitHub', href: 'https://github.com/metered/llmrtc'},
            {label: 'Issues', href: 'https://github.com/metered/llmrtc/issues'}
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
