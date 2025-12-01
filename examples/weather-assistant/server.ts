/**
 * Weather Assistant - Voice + Tool Calling Example
 *
 * Demonstrates VoicePlaybookOrchestrator with tool calling:
 * - Single-stage playbook (no transitions needed)
 * - Three weather tools: get_weather, get_forecast, get_alerts
 * - Real-time tool execution events sent to client
 */

import { config } from 'dotenv';
config();

import {
  LLMRTCServer,
  OpenAILLMProvider,
  OpenAIWhisperProvider,
  ElevenLabsTTSProvider
} from '@metered/llmrtc-backend';

import {
  ToolRegistry,
  defineTool,
  Playbook,
  Stage
} from '@metered/llmrtc-core';

// =============================================================================
// Weather Tools
// =============================================================================

/**
 * Get current weather conditions for a city
 */
const getWeatherTool = defineTool(
  {
    name: 'get_weather',
    description: 'Get the current weather conditions for a specified city',
    parameters: {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          description: 'The city name to get weather for (e.g., "Tokyo", "New York")'
        },
        units: {
          type: 'string',
          enum: ['celsius', 'fahrenheit'],
          description: 'Temperature units (default: celsius)'
        }
      },
      required: ['city']
    }
  },
  async (params: { city: string; units?: 'celsius' | 'fahrenheit' }) => {
    console.log(`[tool] get_weather: ${params.city}`);

    // Simulated weather data
    const weatherData: Record<string, { temp: number; humidity: number; condition: string; wind: number }> = {
      'tokyo': { temp: 22, humidity: 65, condition: 'partly cloudy', wind: 12 },
      'new york': { temp: 18, humidity: 55, condition: 'sunny', wind: 8 },
      'london': { temp: 14, humidity: 80, condition: 'rainy', wind: 20 },
      'paris': { temp: 16, humidity: 70, condition: 'cloudy', wind: 15 },
      'sydney': { temp: 25, humidity: 60, condition: 'sunny', wind: 10 },
      'miami': { temp: 30, humidity: 85, condition: 'humid', wind: 5 },
      'los angeles': { temp: 24, humidity: 45, condition: 'sunny', wind: 7 },
      'chicago': { temp: 12, humidity: 50, condition: 'windy', wind: 25 },
    };

    const cityKey = params.city.toLowerCase();
    const data = weatherData[cityKey] || { temp: 20, humidity: 60, condition: 'clear', wind: 10 };

    // Convert to Fahrenheit if requested
    const temp = params.units === 'fahrenheit'
      ? Math.round(data.temp * 9/5 + 32)
      : data.temp;

    return {
      city: params.city,
      temperature: temp,
      units: params.units === 'fahrenheit' ? 'F' : 'C',
      humidity: data.humidity,
      condition: data.condition,
      windSpeed: data.wind,
      windUnits: 'km/h'
    };
  }
);

/**
 * Get multi-day weather forecast
 */
const getForecastTool = defineTool(
  {
    name: 'get_forecast',
    description: 'Get a multi-day weather forecast for a city',
    parameters: {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          description: 'The city name to get forecast for'
        },
        days: {
          type: 'integer',
          description: 'Number of days to forecast (1-7, default: 3)',
          minimum: 1,
          maximum: 7
        }
      },
      required: ['city']
    }
  },
  async (params: { city: string; days?: number }) => {
    console.log(`[tool] get_forecast: ${params.city}, ${params.days || 3} days`);

    const numDays = Math.min(params.days || 3, 7);
    const conditions = ['sunny', 'partly cloudy', 'cloudy', 'rainy', 'stormy'];
    const forecast = [];

    const today = new Date();
    for (let i = 0; i < numDays; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);

      forecast.push({
        date: date.toISOString().split('T')[0],
        dayName: date.toLocaleDateString('en-US', { weekday: 'long' }),
        high: Math.round(15 + Math.random() * 15),
        low: Math.round(5 + Math.random() * 10),
        condition: conditions[Math.floor(Math.random() * conditions.length)],
        precipitation: Math.round(Math.random() * 100)
      });
    }

    return {
      city: params.city,
      forecast
    };
  }
);

/**
 * Get weather alerts for a city
 */
const getAlertsTool = defineTool(
  {
    name: 'get_alerts',
    description: 'Get active weather alerts for a city',
    parameters: {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          description: 'The city name to check for weather alerts'
        }
      },
      required: ['city']
    }
  },
  async (params: { city: string }) => {
    console.log(`[tool] get_alerts: ${params.city}`);

    // Simulated alerts - only some cities have alerts
    const alerts: Record<string, Array<{ severity: string; title: string; description: string }>> = {
      'miami': [
        {
          severity: 'warning',
          title: 'Hurricane Watch',
          description: 'A hurricane watch is in effect. Monitor local news for updates.'
        }
      ],
      'chicago': [
        {
          severity: 'advisory',
          title: 'Wind Advisory',
          description: 'Strong winds expected. Secure loose outdoor items.'
        }
      ],
      'london': [
        {
          severity: 'advisory',
          title: 'Flood Advisory',
          description: 'Minor flooding possible in low-lying areas due to heavy rain.'
        }
      ]
    };

    const cityKey = params.city.toLowerCase();
    const cityAlerts = alerts[cityKey] || [];

    return {
      city: params.city,
      alertCount: cityAlerts.length,
      alerts: cityAlerts,
      lastUpdated: new Date().toISOString()
    };
  }
);

// =============================================================================
// Playbook Definition
// =============================================================================

const weatherStage: Stage = {
  id: 'weather',
  name: 'Weather Assistant',
  description: 'Help users with weather information',
  systemPrompt: `You are a friendly weather assistant. Help users with weather-related questions.

You have access to these tools:
- get_weather: Get current conditions (temperature, humidity, wind, etc.)
- get_forecast: Get multi-day forecasts (up to 7 days)
- get_alerts: Check for weather alerts and warnings

When a user asks about weather:
1. Use the appropriate tool to get the information
2. Provide a natural, conversational response with the results
3. Offer related suggestions (e.g., "Would you like the forecast for the week?")

Keep responses concise but informative. Include relevant details like humidity and wind when discussing current weather.`,
  tools: [getWeatherTool.definition, getForecastTool.definition, getAlertsTool.definition],
  toolChoice: 'auto',
  twoPhaseExecution: true
};

const weatherPlaybook: Playbook = {
  id: 'weather-assistant',
  name: 'Weather Assistant',
  description: 'Voice-enabled weather assistant with tool calling',
  version: '1.0.0',
  stages: [weatherStage],
  transitions: [], // Single stage - no transitions needed
  initialStage: 'weather',
  globalSystemPrompt: `You are a helpful weather assistant. Be friendly and conversational.
When you don't know the weather for a specific location, use a tool to look it up rather than guessing.`,
  defaultLLMConfig: {
    temperature: 0.7,
    maxTokens: 300
  }
};

// =============================================================================
// Server Setup
// =============================================================================

// Create tool registry
const toolRegistry = new ToolRegistry();
toolRegistry.register(getWeatherTool);
toolRegistry.register(getForecastTool);
toolRegistry.register(getAlertsTool);

console.log('Registered tools:', toolRegistry.names());

// Create and start server
const server = new LLMRTCServer({
  providers: {
    llm: new OpenAILLMProvider({
      apiKey: process.env.OPENAI_API_KEY!,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
    }),
    stt: new OpenAIWhisperProvider({
      apiKey: process.env.OPENAI_API_KEY!
    }),
    tts: new ElevenLabsTTSProvider({
      apiKey: process.env.ELEVENLABS_API_KEY!,
      voiceId: process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'
    })
  },
  port: 8787,
  streamingTTS: true,

  // Enable playbook mode with tools
  playbook: weatherPlaybook,
  toolRegistry
});

// Server event handlers
server.on('listening', ({ host, port }) => {
  console.log(`\n  Weather Assistant`);
  console.log(`  =================`);
  console.log(`  Server running at http://${host}:${port}`);
  console.log(`  Open http://localhost:5173 to use the client`);
  console.log(`\n  Try saying:`);
  console.log(`  - "What's the weather in Tokyo?"`);
  console.log(`  - "Give me the forecast for New York"`);
  console.log(`  - "Are there any weather alerts in Miami?"\n`);
});

server.on('connection', ({ id }) => {
  console.log(`[server] Client connected: ${id}`);
});

server.on('disconnect', ({ id }) => {
  console.log(`[server] Client disconnected: ${id}`);
});

server.on('error', (err) => {
  console.error(`[server] Error:`, err.message);
});

// Start the server
await server.start();
