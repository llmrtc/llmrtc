# Support Bot Example

A multi-stage customer support voice assistant demonstrating playbook transitions and tool calling.

## Features

- **Multi-stage playbook** - Greeting, Authentication, Issue Triage, Resolution, Farewell
- **Stage transitions** - Keyword-based, tool-result-based, and turn-count-based transitions
- **Customer tools** - Lookup customers, check orders, create tickets, apply credits
- **Real-time UI** - Shows current stage, tool calls, and stage transitions

## Stages

| Stage | Purpose |
|-------|---------|
| `greeting` | Welcome user, gather initial intent |
| `authentication` | Verify customer identity |
| `issue_triage` | Categorize and understand the issue |
| `resolution` | Use tools to resolve or escalate |
| `farewell` | Summary and goodbye |

## Tools

| Tool | Description |
|------|-------------|
| `lookup_customer` | Find customer by email or phone |
| `check_order_status` | Get order details and tracking |
| `create_ticket` | Escalate to human support |
| `apply_credit` | Issue refund or account credit |

## Setup

1. Copy environment file and add your API keys:
   ```bash
   cp .env.example .env
   # Edit .env with your keys
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open http://localhost:5173 in your browser

## Try It

**Greeting Stage:**
- "Hello" / "Hi there"

**Authentication Stage:**
- "My email is john@example.com"
- "I need help with my order"

**Issue Triage:**
- "I want to check on order 12345"
- "I need a refund"

**Resolution:**
- "Apply a credit to my account"
- "Create a support ticket"

**Farewell:**
- "Thanks for your help"
- "Goodbye"

## Playbook Flow

```
┌─────────────┐
│  Greeting   │
│ (welcome)   │
└──────┬──────┘
       │ keyword: "order", "refund", "help"
       ▼
┌─────────────┐
│Authentication│
│(verify user)│
└──────┬──────┘
       │ tool: lookup_customer success
       ▼
┌─────────────┐
│Issue Triage │
│(categorize) │
└──────┬──────┘
       │ intent detected
       ▼
┌─────────────┐
│ Resolution  │
│(tools/help) │
└──────┬──────┘
       │ issue resolved or escalated
       ▼
┌─────────────┐
│  Farewell   │
│ (goodbye)   │
└─────────────┘
```

## Code Highlights

### Multi-Stage Playbook

```typescript
const playbook: Playbook = {
  stages: [greetingStage, authStage, triageStage, resolutionStage, farewellStage],
  transitions: [
    // Keyword trigger
    { from: 'greeting', condition: { type: 'keyword', keywords: ['order', 'refund'] }, action: { targetStage: 'authentication' } },
    // Tool result trigger
    { from: 'authentication', condition: { type: 'tool_result', tool: 'lookup_customer', check: (r) => r.success }, action: { targetStage: 'issue_triage' } },
    // LLM decision trigger
    { from: '*', condition: { type: 'llm_decision' }, action: { targetStage: 'farewell' } }
  ]
};
```

### Client Stage Display

```typescript
client.on('stageChange', ({ from, to, reason }) => {
  setCurrentStage(to);
  setStageHistory(prev => [...prev, { from, to, reason, time: Date.now() }]);
});
```
