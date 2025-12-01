/**
 * Support Bot - Multi-Stage Playbook Example
 *
 * Demonstrates VoicePlaybookOrchestrator with:
 * - Multi-stage playbook (greeting → auth → triage → resolution → farewell)
 * - Multiple transition types (keyword, tool result, LLM decision)
 * - Customer support tools for lookup, orders, tickets, and credits
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
// Simulated Database
// =============================================================================

interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  tier: 'standard' | 'premium' | 'enterprise';
  accountStatus: 'active' | 'suspended' | 'pending';
  balance: number;
}

interface Order {
  orderId: string;
  customerId: string;
  status: 'processing' | 'shipped' | 'delivered' | 'cancelled';
  items: Array<{ name: string; quantity: number; price: number }>;
  total: number;
  eta?: string;
  tracking?: string;
}

const customers: Record<string, Customer> = {
  'john@example.com': {
    id: 'cust_001',
    name: 'John Smith',
    email: 'john@example.com',
    phone: '555-0101',
    tier: 'premium',
    accountStatus: 'active',
    balance: 150.00
  },
  'jane@example.com': {
    id: 'cust_002',
    name: 'Jane Doe',
    email: 'jane@example.com',
    phone: '555-0102',
    tier: 'standard',
    accountStatus: 'active',
    balance: 0
  },
  '555-0101': {
    id: 'cust_001',
    name: 'John Smith',
    email: 'john@example.com',
    phone: '555-0101',
    tier: 'premium',
    accountStatus: 'active',
    balance: 150.00
  }
};

const orders: Record<string, Order> = {
  'ORD-12345': {
    orderId: 'ORD-12345',
    customerId: 'cust_001',
    status: 'shipped',
    items: [
      { name: 'Wireless Headphones', quantity: 1, price: 79.99 },
      { name: 'USB-C Cable', quantity: 2, price: 12.99 }
    ],
    total: 105.97,
    eta: '2024-01-20',
    tracking: 'TRK-ABC123456'
  },
  'ORD-67890': {
    orderId: 'ORD-67890',
    customerId: 'cust_002',
    status: 'processing',
    items: [
      { name: 'Smart Watch', quantity: 1, price: 299.99 }
    ],
    total: 299.99
  }
};

// Session context to track authenticated customer
let sessionCustomer: Customer | null = null;

// =============================================================================
// Support Tools
// =============================================================================

const lookupCustomerTool = defineTool(
  {
    name: 'lookup_customer',
    description: 'Find a customer by email or phone number to verify their identity',
    parameters: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Customer email address'
        },
        phone: {
          type: 'string',
          description: 'Customer phone number'
        }
      }
    }
  },
  async (params: { email?: string; phone?: string }) => {
    console.log(`[tool] lookup_customer:`, params);

    const key = params.email?.toLowerCase() || params.phone;
    if (!key) {
      return { success: false, error: 'Please provide email or phone number' };
    }

    const customer = customers[key];
    if (!customer) {
      return { success: false, error: 'Customer not found' };
    }

    // Store in session
    sessionCustomer = customer;

    return {
      success: true,
      id: customer.id,
      name: customer.name,
      tier: customer.tier,
      accountStatus: customer.accountStatus
    };
  }
);

const checkOrderStatusTool = defineTool(
  {
    name: 'check_order_status',
    description: 'Look up the status of an order by order ID',
    parameters: {
      type: 'object',
      properties: {
        orderId: {
          type: 'string',
          description: 'The order ID (e.g., ORD-12345)'
        }
      },
      required: ['orderId']
    }
  },
  async (params: { orderId: string }) => {
    console.log(`[tool] check_order_status: ${params.orderId}`);

    // Normalize order ID
    const orderId = params.orderId.toUpperCase().replace(/\s/g, '');
    const order = orders[orderId];

    if (!order) {
      return {
        success: false,
        error: `Order ${params.orderId} not found`
      };
    }

    return {
      success: true,
      orderId: order.orderId,
      status: order.status,
      items: order.items.map(i => `${i.quantity}x ${i.name}`).join(', '),
      total: `$${order.total.toFixed(2)}`,
      eta: order.eta || 'N/A',
      tracking: order.tracking || 'Not yet available'
    };
  }
);

const createTicketTool = defineTool(
  {
    name: 'create_ticket',
    description: 'Create a support ticket to escalate to human agents',
    parameters: {
      type: 'object',
      properties: {
        customerId: {
          type: 'string',
          description: 'Customer ID'
        },
        summary: {
          type: 'string',
          description: 'Brief summary of the issue'
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Ticket priority level'
        }
      },
      required: ['summary', 'priority']
    }
  },
  async (params: { customerId?: string; summary: string; priority: 'low' | 'medium' | 'high' }) => {
    console.log(`[tool] create_ticket:`, params);

    const ticketId = `TKT-${Date.now().toString(36).toUpperCase()}`;
    const customerId = params.customerId || sessionCustomer?.id || 'unknown';

    const responseTime: Record<string, string> = {
      'low': '48 hours',
      'medium': '24 hours',
      'high': '4 hours'
    };

    return {
      success: true,
      ticketId,
      customerId,
      summary: params.summary,
      priority: params.priority,
      estimatedResponse: responseTime[params.priority],
      message: `Ticket ${ticketId} created. A support agent will contact you within ${responseTime[params.priority]}.`
    };
  }
);

const applyCreditTool = defineTool(
  {
    name: 'apply_credit',
    description: 'Apply a credit or refund to customer account',
    parameters: {
      type: 'object',
      properties: {
        customerId: {
          type: 'string',
          description: 'Customer ID'
        },
        amount: {
          type: 'number',
          description: 'Credit amount in dollars',
          minimum: 0.01,
          maximum: 500
        },
        reason: {
          type: 'string',
          description: 'Reason for the credit'
        }
      },
      required: ['amount', 'reason']
    }
  },
  async (params: { customerId?: string; amount: number; reason: string }) => {
    console.log(`[tool] apply_credit:`, params);

    const customerId = params.customerId || sessionCustomer?.id;
    if (!customerId) {
      return { success: false, error: 'Customer not verified. Please verify identity first.' };
    }

    // Find and update customer balance
    const customer = Object.values(customers).find(c => c.id === customerId);
    if (customer) {
      customer.balance += params.amount;
    }

    return {
      success: true,
      customerId,
      creditAmount: `$${params.amount.toFixed(2)}`,
      reason: params.reason,
      newBalance: customer ? `$${customer.balance.toFixed(2)}` : 'N/A',
      message: `Credit of $${params.amount.toFixed(2)} applied to account.`
    };
  }
);

// =============================================================================
// Playbook Stages
// =============================================================================

const greetingStage: Stage = {
  id: 'greeting',
  name: 'Greeting',
  description: 'Welcome the customer and understand their intent',
  systemPrompt: `You are a friendly customer support agent. Welcome the customer warmly and ask how you can help them today.

Keep greetings brief and professional. Ask one clear question about what they need help with.

Example: "Hello! Welcome to our support line. How can I assist you today?"`,
  maxTurns: 2
};

const authenticationStage: Stage = {
  id: 'authentication',
  name: 'Authentication',
  description: 'Verify customer identity',
  systemPrompt: `You need to verify the customer's identity before helping with their account.

Ask for their email address or phone number to look them up in the system. Use the lookup_customer tool to verify them.

Be polite and explain why you need this information (for security purposes).

Once verified, confirm their name and proceed to understand their issue.`,
  tools: [lookupCustomerTool.definition],
  toolChoice: 'auto',
  twoPhaseExecution: true
};

const issueTriageStage: Stage = {
  id: 'issue_triage',
  name: 'Issue Triage',
  description: 'Understand and categorize the customer issue',
  systemPrompt: `The customer is now verified. Understand their issue in detail.

Common issues:
- Order status inquiries
- Refund requests
- Product questions
- Account issues
- Complaints

Ask clarifying questions if needed. Once you understand the issue, you can help resolve it.

You have access to check_order_status to look up orders.`,
  tools: [checkOrderStatusTool.definition],
  toolChoice: 'auto',
  twoPhaseExecution: true
};

const resolutionStage: Stage = {
  id: 'resolution',
  name: 'Resolution',
  description: 'Resolve the customer issue or escalate',
  systemPrompt: `Help resolve the customer's issue using the available tools.

Available actions:
- check_order_status: Look up order details
- apply_credit: Issue refunds or credits (up to $500)
- create_ticket: Escalate complex issues to human agents

For simple issues like order status, provide the information directly.
For refund requests, you can apply credits up to $50 without escalation.
For complex issues or amounts over $50, create a support ticket.

Always confirm the resolution with the customer before concluding.`,
  tools: [
    checkOrderStatusTool.definition,
    applyCreditTool.definition,
    createTicketTool.definition
  ],
  toolChoice: 'auto',
  twoPhaseExecution: true
};

const farewellStage: Stage = {
  id: 'farewell',
  name: 'Farewell',
  description: 'Summarize and say goodbye',
  systemPrompt: `The interaction is concluding. Provide a brief summary of what was accomplished:
- Any orders checked
- Credits applied
- Tickets created

Thank the customer for contacting support and wish them a good day.
Ask if there's anything else before ending the call.

Keep it brief and warm.`
};

// =============================================================================
// Playbook Definition
// =============================================================================

const supportPlaybook: Playbook = {
  id: 'support-bot',
  name: 'Customer Support Bot',
  description: 'Multi-stage customer support with tools and transitions',
  version: '1.0.0',

  stages: [greetingStage, authenticationStage, issueTriageStage, resolutionStage, farewellStage],

  transitions: [
    // Greeting → Authentication: when user mentions support topics
    {
      id: 'greeting-to-auth',
      from: 'greeting',
      condition: {
        type: 'keyword',
        keywords: ['order', 'refund', 'help', 'problem', 'issue', 'account', 'purchase', 'delivery', 'track']
      },
      action: { targetStage: 'authentication' }
    },

    // Greeting → Authentication: after max turns
    {
      id: 'greeting-timeout',
      from: 'greeting',
      condition: { type: 'max_turns', count: 2 },
      action: { targetStage: 'authentication' },
      priority: -1
    },

    // Authentication → Issue Triage: when customer is verified
    {
      id: 'auth-to-triage',
      from: 'authentication',
      condition: {
        type: 'keyword',
        keywords: ['order', 'refund', 'status', 'check', 'where', 'tracking', 'credit']
      },
      action: { targetStage: 'issue_triage' }
    },

    // Authentication → Issue Triage: after verification attempts
    {
      id: 'auth-timeout',
      from: 'authentication',
      condition: { type: 'max_turns', count: 4 },
      action: { targetStage: 'issue_triage' },
      priority: -1
    },

    // Issue Triage → Resolution: when issue is understood
    {
      id: 'triage-to-resolution',
      from: 'issue_triage',
      condition: {
        type: 'keyword',
        keywords: ['refund', 'credit', 'cancel', 'escalate', 'ticket', 'agent', 'help']
      },
      action: { targetStage: 'resolution' }
    },

    // Issue Triage → Resolution: after max turns
    {
      id: 'triage-timeout',
      from: 'issue_triage',
      condition: { type: 'max_turns', count: 4 },
      action: { targetStage: 'resolution' },
      priority: -1
    },

    // Resolution → Farewell: when user is satisfied
    {
      id: 'resolution-to-farewell',
      from: 'resolution',
      condition: {
        type: 'keyword',
        keywords: ['thanks', 'thank you', 'bye', 'goodbye', 'great', 'perfect', 'done', 'that\'s all', 'nothing else']
      },
      action: { targetStage: 'farewell' }
    },

    // Resolution → Farewell: after max turns
    {
      id: 'resolution-timeout',
      from: 'resolution',
      condition: { type: 'max_turns', count: 6 },
      action: { targetStage: 'farewell' },
      priority: -1
    },

    // LLM can decide to end conversation from any stage
    {
      id: 'llm-farewell',
      from: '*',
      condition: { type: 'llm_decision' },
      action: { targetStage: 'farewell' },
      description: 'LLM can transition to farewell when appropriate',
      priority: -2
    }
  ],

  initialStage: 'greeting',

  globalSystemPrompt: `You are a helpful customer support agent for an online store.
Be professional, empathetic, and efficient.
Always verify customer identity before accessing account information.
If you cannot resolve an issue, offer to escalate to a human agent.`,

  defaultLLMConfig: {
    temperature: 0.7,
    maxTokens: 400
  }
};

// =============================================================================
// Server Setup
// =============================================================================

// Create tool registry
const toolRegistry = new ToolRegistry();
toolRegistry.register(lookupCustomerTool);
toolRegistry.register(checkOrderStatusTool);
toolRegistry.register(createTicketTool);
toolRegistry.register(applyCreditTool);

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

  // Enable playbook mode
  playbook: supportPlaybook,
  toolRegistry
});

// Server event handlers
server.on('listening', ({ host, port }) => {
  console.log(`\n  Support Bot`);
  console.log(`  ===========`);
  console.log(`  Server running at http://${host}:${port}`);
  console.log(`  Open http://localhost:5173 to use the client`);
  console.log(`\n  Test customers:`);
  console.log(`  - john@example.com (premium tier)`);
  console.log(`  - jane@example.com (standard tier)`);
  console.log(`\n  Test orders:`);
  console.log(`  - ORD-12345 (shipped)`);
  console.log(`  - ORD-67890 (processing)\n`);
});

server.on('connection', ({ id }) => {
  console.log(`[server] Client connected: ${id}`);
  // Reset session for new connections
  sessionCustomer = null;
});

server.on('disconnect', ({ id }) => {
  console.log(`[server] Client disconnected: ${id}`);
  sessionCustomer = null;
});

server.on('error', (err) => {
  console.error(`[server] Error:`, err.message);
});

// Start the server
await server.start();
