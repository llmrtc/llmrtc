---
title: Security
---

Security considerations for deploying LLMRTC in production environments.

---

## API Key Management

### Storage

Never hardcode API keys. Use environment variables or a secrets manager:

```bash
# Environment variables
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export ELEVENLABS_API_KEY=xi-...
```

```typescript
// Load from environment
const server = new LLMRTCServer({
  providers: {
    llm: new OpenAILLMProvider({
      apiKey: process.env.OPENAI_API_KEY!  // Never hardcode
    })
  }
});
```

### Secret Managers

For production, use a secrets manager:

```typescript
// AWS Secrets Manager
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

async function getSecrets() {
  const client = new SecretsManagerClient({ region: 'us-east-1' });
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: 'llmrtc/api-keys' })
  );
  return JSON.parse(response.SecretString!);
}

const secrets = await getSecrets();
const server = new LLMRTCServer({
  providers: {
    llm: new OpenAILLMProvider({ apiKey: secrets.OPENAI_API_KEY })
  }
});
```

### Key Rotation

When rotating keys:
1. Deploy new key to secrets manager
2. Restart server instances
3. Revoke old key

---

## Authentication

LLMRTC doesn't include authentication—implement it in your application:

### JWT Authentication

```typescript
import { LLMRTCServer } from '@metered/llmrtc-backend';
import { verify } from 'jsonwebtoken';

const server = new LLMRTCServer({ providers });
const app = server.getApp();

// Middleware to verify JWT
app.use('*', async (c, next) => {
  // Skip health check
  if (c.req.path === '/health') {
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing token' }, 401);
  }

  const token = authHeader.substring(7);
  try {
    const payload = verify(token, process.env.JWT_SECRET!);
    c.set('user', payload);
    await next();
  } catch {
    return c.json({ error: 'Invalid token' }, 401);
  }
});
```

### WebSocket Authentication

WebSocket connections need special handling:

```typescript
// Option 1: Query parameter token
// Client connects to: ws://server:8787?token=eyJ...

// Option 2: First message authentication
// Client sends auth message immediately after connect

// Option 3: Pre-authenticated ticket
app.post('/api/tickets', async (c) => {
  const user = c.get('user');
  const ticket = crypto.randomUUID();
  await redis.setex(`ticket:${ticket}`, 30, JSON.stringify(user));
  return c.json({ ticket });
});

// Client connects with ticket, server validates on connect
```

### Session Correlation

Map LLMRTC sessions to your user accounts:

```typescript
const userSessions = new Map<string, string>();  // sessionId -> userId

server.on('connection', ({ id }) => {
  // Look up pre-authenticated user from ticket or token
  const userId = getUserFromConnection(id);
  userSessions.set(id, userId);
});

server.on('disconnect', ({ id }) => {
  userSessions.delete(id);
});
```

---

## Network Security

### TLS/HTTPS

Always use TLS in production:

```nginx
# nginx.conf
server {
    listen 443 ssl http2;
    server_name voice.example.com;

    ssl_certificate /etc/letsencrypt/live/voice.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/voice.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }
}
```

### CORS Configuration

Restrict allowed origins:

```typescript
const server = new LLMRTCServer({
  providers,
  cors: {
    origin: ['https://app.example.com', 'https://admin.example.com'],
    credentials: true,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization']
  }
});
```

### Firewall Rules

Only expose necessary ports:

```bash
# Allow HTTPS and WSS
ufw allow 443/tcp

# Allow WebRTC media (if not using TURN)
ufw allow 10000:20000/udp

# Block direct access to backend port
ufw deny 8787/tcp
```

---

## Rate Limiting

Prevent abuse with rate limiting:

### At the Gateway

```nginx
# nginx.conf
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

server {
    location / {
        limit_req zone=api burst=20 nodelay;
        proxy_pass http://127.0.0.1:8787;
    }
}
```

### Per-User Limits

```typescript
import { RateLimiter } from 'limiter';

const userLimiters = new Map<string, RateLimiter>();

app.use('*', async (c, next) => {
  const userId = c.get('user')?.id;
  if (!userId) return next();

  let limiter = userLimiters.get(userId);
  if (!limiter) {
    limiter = new RateLimiter({
      tokensPerInterval: 60,
      interval: 'minute'
    });
    userLimiters.set(userId, limiter);
  }

  if (await limiter.removeTokens(1) < 0) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  await next();
});
```

### Concurrent Session Limits

```typescript
const activeSessions = new Map<string, Set<string>>();  // userId -> sessionIds
const MAX_SESSIONS_PER_USER = 3;

server.on('connection', ({ id }) => {
  const userId = getUserId(id);
  const sessions = activeSessions.get(userId) || new Set();

  if (sessions.size >= MAX_SESSIONS_PER_USER) {
    // Disconnect oldest or reject new connection
    const oldest = sessions.values().next().value;
    disconnectSession(oldest);
    sessions.delete(oldest);
  }

  sessions.add(id);
  activeSessions.set(userId, sessions);
});
```

---

## Data Protection

### PII in Transcripts

Transcripts may contain personally identifiable information:

```typescript
server.hooks = {
  onSTTEnd: (ctx, result) => {
    // Log transcript without PII
    const sanitized = redactPII(result.text);
    logger.info({ sessionId: ctx.sessionId, transcript: sanitized });

    // Store securely if needed
    if (shouldStore()) {
      await encryptAndStore(ctx.sessionId, result.text);
    }
  }
};
```

### Data Retention

Define retention policies:

```typescript
// Automatic cleanup
setInterval(async () => {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;  // 30 days
  await db.query('DELETE FROM transcripts WHERE created_at < ?', [cutoff]);
}, 24 * 60 * 60 * 1000);  // Daily
```

### Encryption at Rest

Encrypt sensitive data:

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

function encrypt(text: string, key: Buffer): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}
```

---

## Input Validation

### Tool Arguments

Validate tool arguments before execution:

```typescript
import { z } from 'zod';

const BookingSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  partySize: z.number().int().min(1).max(20)
});

const bookingTool = defineTool({
  name: 'book_table',
  parameters: { /* JSON Schema */ },
  execute: async (args) => {
    const validated = BookingSchema.parse(args);
    return await bookTable(validated);
  }
});
```

### Prompt Injection

Guard against prompt injection:

```typescript
function sanitizeUserInput(text: string): string {
  // Remove potential injection patterns
  return text
    .replace(/\[SYSTEM\]/gi, '')
    .replace(/ignore previous instructions/gi, '')
    .slice(0, 1000);  // Length limit
}
```

---

## Audit Logging

Log security-relevant events:

```typescript
const auditLog = {
  logConnection(sessionId: string, userId: string, ip: string) {
    logger.info({
      event: 'connection',
      sessionId,
      userId,
      ip,
      timestamp: new Date().toISOString()
    });
  },

  logToolExecution(sessionId: string, tool: string, args: unknown) {
    logger.info({
      event: 'tool_execution',
      sessionId,
      tool,
      argsHash: hash(JSON.stringify(args)),
      timestamp: new Date().toISOString()
    });
  },

  logError(sessionId: string, error: Error) {
    logger.error({
      event: 'error',
      sessionId,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }
};
```

---

## Related Documentation

- [Deployment](deployment) - Production deployment guide
- [Configuration](configuration) - Server options
- [Observability & Hooks](observability-and-hooks) - Monitoring and logging
