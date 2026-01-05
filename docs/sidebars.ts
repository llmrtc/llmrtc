import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: 'doc',
      label: 'LLMRTC',
      id: 'intro'
    },
    {
      type: 'category',
      label: 'Getting Started',
      items: [
        'getting-started/overview',
        'getting-started/installation',
        'getting-started/backend-quickstart',
        'getting-started/web-client-quickstart',
        'getting-started/tool-calling-quickstart',
        'getting-started/local-only-stack'
      ]
    },
    {
      type: 'category',
      label: 'Tutorials',
      items: [
        'tutorials/build-voice-assistant',
        'tutorials/add-vision',
        'tutorials/voice-with-tools'
      ]
    },
    {
      type: 'category',
      label: 'Concepts',
      items: [
        'concepts/architecture',
        'concepts/conversations-and-sessions',
        'concepts/orchestrator',
        'concepts/providers',
        'concepts/audio-and-vad',
        'concepts/vision-and-attachments',
        'concepts/tool-calling',
        'concepts/playbooks',
        'concepts/streaming-and-latency'
      ]
    },
    {
      type: 'category',
      label: 'Backend',
      items: [
        'backend/overview',
        'backend/cli',
        'backend/library',
        'backend/configuration',
        'backend/environment-variables',
        'backend/networking-and-turn',
        'backend/voice-playbook',
        'backend/deployment',
        'backend/observability-and-hooks',
        'backend/security'
      ]
    },
    {
      type: 'category',
      label: 'Web Client',
      items: [
        'web-client/overview',
        'web-client/installation',
        'web-client/connection-lifecycle',
        'web-client/audio',
        'web-client/video-and-vision',
        'web-client/events',
        'web-client/ui-patterns'
      ]
    },
    {
      type: 'category',
      label: 'Core SDK',
      items: [
        'core-sdk/overview',
        'core-sdk/types',
        'core-sdk/conversation-orchestrator',
        'core-sdk/custom-providers',
        'core-sdk/tools',
        'core-sdk/hooks-and-metrics',
        'core-sdk/playbooks',
        'core-sdk/testing-and-mocking'
      ]
    },
    {
      type: 'category',
      label: 'Playbooks',
      items: [
        'playbooks/overview',
        'playbooks/defining-playbooks',
        'playbooks/text-agents',
        'playbooks/voice-agents-with-tools',
        'playbooks/examples'
      ]
    },
    {
      type: 'category',
      label: 'Providers',
      items: [
        'providers/overview',
        'providers/openai',
        'providers/anthropic',
        'providers/google-gemini',
        'providers/aws-bedrock',
        'providers/openrouter',
        'providers/lmstudio',
        'providers/elevenlabs',
        'providers/local-ollama',
        'providers/local-faster-whisper',
        'providers/local-piper',
        'providers/local-llava'
      ]
    },
    {
      type: 'category',
      label: 'Recipes',
      items: [
        'recipes/minimal-voice-assistant',
        'recipes/multi-provider-routing',
        'recipes/local-only-assistant',
        'recipes/support-bot',
        'recipes/weather-assistant',
        'recipes/observability-and-metrics'
      ]
    },
    {
      type: 'category',
      label: 'Operations',
      items: [
        'operations/monitoring',
        'operations/logging-and-metrics',
        'operations/scaling-and-performance',
        'operations/troubleshooting',
        'operations/faq'
      ]
    },
    {
      type: 'category',
      label: 'Protocol',
      items: [
        'protocol/overview',
        'protocol/connection-lifecycle',
        'protocol/message-types',
        'protocol/message-flows',
        'protocol/error-codes'
      ]
    },
    {
      type: 'category',
      label: 'Meta',
      items: [
        'meta/changelog',
        'meta/migration-guides',
        'meta/contributing',
        'meta/testing-and-e2e',
        'meta/release-process',
        'meta/license'
      ]
    }
  ]
};

export default sidebars;
