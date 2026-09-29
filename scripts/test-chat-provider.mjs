/**
 * Smoke test: send one BPL Analyst chat turn the same way the chat box does
 * (system prompt + last 2 messages + narrow fleet context, streamed reply).
 * Usage: node scripts/test-chat-provider.mjs <groq|gemini> [model]
 */
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter(l => /^\s*[A-Z0-9_]+\s*=/.test(l))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);
const getEnv = k => process.env[k] || env[k];

const TIMEOUT_MS = 30_000;
const MAX_OUTPUT_TOKENS = 400;

const SYSTEM_PROMPT = `You are BPL Analyst — embedded fleet intelligence for Best Practices Limited (BPL).

Be sharp and brief. 3-5 sentences max unless the question genuinely demands more. Lead with the most important fact. Use specific names, numbers, and vehicles from the data. Never pad or repeat yourself.

Cite standards (FMCSA BASICs, FRSC Nigeria, ISO 39001) only when directly relevant. If data is missing say "not available in current view — check [section]."`;

const history = [
  { role: 'user', content: 'Which driver should I watch out for?' },
  {
    role: 'assistant',
    content: '**AJIBADE TAIWO** has the highest 30-day incident count in the current view: **6** (Overspeeding×4, Overspeed Tiered×2). Last event 28/09/2026, 11:35:12. Next in line: RAHEEM ADETUMBI (3), BAKARE DELE NURUDEEN (2).',
  },
];

const question = 'Compare AJIBADE TAIWO with RAHEEM ADETUMBI — who is the bigger coaching priority and why?';

const context = `BPL ANALYST NARROW CONTEXT — 28/09/2026, 16:20:00 (Lagos, WAT)
Score 71/100 (-3 vs prior 30 days) | vehicles 142 moving 38 idle 12 | red 2 | open vault 3 | page Driver Management | 28/09/2026, 16:20:00 WAT
=== DRIVER AJIBADE TAIWO ===
  AJIBADE TAIWO: 6 incidents (Overspeeding×4, Overspeed Tiered×2) | last: 28/09/2026, 11:35:12
  28/09/2026, 11:35:12 | Overspeeding | KJA-412XA | Lagos-Ibadan Expressway, Mowe
  27/09/2026, 17:02:40 | Overspeed Tiered | KJA-412XA | Lagos-Ibadan Expressway, Magboro
  25/09/2026, 09:14:05 | Overspeeding | KJA-412XA | Sagamu Interchange
  22/09/2026, 14:48:31 | Overspeeding | KJA-412XA | Ewekoro Plant Road
=== OPEN VAULT ===
  [HIGH] AJIBADE TAIWO | KJA-412XA | Overspeed | in_review
  [MEDIUM] RAHEEM ADETUMBI | LSD-118KT | Harsh Braking | open
=== RED ALERTS ===
  [RED] AJIBADE TAIWO | KJA-412XA | 84 km/h vs 60 km/h limit
=== MOST INCIDENTS (30d) — highest risk, not best ===
  AJIBADE TAIWO: 6 incidents (Overspeeding×4, Overspeed Tiered×2) | last: 28/09/2026, 11:35:12
  RAHEEM ADETUMBI: 3 incidents (Harsh Braking×2, Overspeeding×1) | last: 26/09/2026, 08:10:44
  BAKARE DELE NURUDEEN: 2 incidents (Harsh Acceleration×2) | last: 24/09/2026, 19:22:03
=== LOWEST EVENT RATE (21/09/2026–28/09/2026, ≥100 km) — best ===
  OLUWASEUN ADEBAYO: 1,240 km, 0 events (0.00/100 km)
  CHUKWUDI OKAFOR: 980 km, 0 events (0.00/100 km)
  MUSA IBRAHIM: 1,105 km, 1 events (0.09/100 km)

---

User question: ${question}`;

const PROVIDERS = {
  groq: {
    keyName: 'GROQ_API_KEY',
    defaultModel: 'openai/gpt-oss-120b',
    request: (key, model) => ({
      url: 'https://api.groq.com/openai/v1/chat/completions',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: {
        model,
        stream: true,
        max_completion_tokens: MAX_OUTPUT_TOKENS,
        reasoning_effort: 'low',
        include_reasoning: false,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...history,
          { role: 'user', content: context },
        ],
      },
    }),
    parse: data => ({
      text: data.choices?.[0]?.delta?.content || '',
      finish: data.choices?.[0]?.finish_reason || null,
      usage: data.x_groq?.usage || data.usage || null,
    }),
    usageLine: u => `prompt: ${u.prompt_tokens}, reply: ${u.completion_tokens}, reasoning: ${u.completion_tokens_details?.reasoning_tokens ?? '—'}, total: ${u.total_tokens}`,
  },
  gemini: {
    keyName: 'GEMINI_API_KEY',
    defaultModel: 'gemini-3.5-flash-lite',
    request: (key, model) => ({
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          ...history.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          { role: 'user', parts: [{ text: context }] },
        ],
        generationConfig: {
          maxOutputTokens: Number(getEnv('GEMINI_MAX_OUTPUT_TOKENS')) || MAX_OUTPUT_TOKENS,
          ...(getEnv('GEMINI_THINKING_LEVEL') ? { thinkingConfig: { thinkingLevel: getEnv('GEMINI_THINKING_LEVEL') } } : {}),
          ...(getEnv('GEMINI_THINKING_BUDGET') ? { thinkingConfig: { thinkingBudget: Number(getEnv('GEMINI_THINKING_BUDGET')) } } : {}),
        },
      },
    }),
    parse: data => ({
      text: data.candidates?.[0]?.content?.parts?.filter(p => !p.thought).map(p => p.text || '').join('') || '',
      finish: data.candidates?.[0]?.finishReason || null,
      usage: data.usageMetadata || null,
    }),
    usageLine: u => `prompt: ${u.promptTokenCount}, reply: ${u.candidatesTokenCount ?? 0}, thinking: ${u.thoughtsTokenCount ?? 0}, total: ${u.totalTokenCount}`,
  },
};

const providerName = (process.argv[2] || 'groq').toLowerCase();
const provider = PROVIDERS[providerName];
if (!provider) {
  console.error(`Unknown provider "${providerName}". Use: ${Object.keys(PROVIDERS).join(' | ')}`);
  process.exit(1);
}
const key = getEnv(provider.keyName);
if (!key) {
  console.error(`${provider.keyName} missing from .env`);
  process.exit(1);
}
const model = process.argv[3] || provider.defaultModel;
const { url, headers, body } = provider.request(key, model);

console.log(`Provider: ${providerName} | model: ${model}`);
const t0 = Date.now();
const res = await fetch(url, {
  method: 'POST',
  headers,
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(TIMEOUT_MS),
}).catch(err => {
  console.error(`No response within ${TIMEOUT_MS / 1000}s (${err.name})`);
  process.exit(1);
});

const limitHeaders = [...res.headers].filter(([k]) => /ratelimit|quota|retry/i.test(k));
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${await res.text()}`);
  if (limitHeaders.length) console.error('Rate-limit headers:', Object.fromEntries(limitHeaders));
  process.exit(1);
}

let firstTokenMs = null;
let usage = null;
let finish = null;
const decoder = new TextDecoder();
let buf = '';
for await (const chunk of res.body) {
  buf += decoder.decode(chunk, { stream: true });
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6).trim();
    if (!payload || payload === '[DONE]') continue;
    const out = provider.parse(JSON.parse(payload));
    if (out.text) {
      if (firstTokenMs == null) firstTokenMs = Date.now() - t0;
      process.stdout.write(out.text);
    }
    if (out.usage) usage = out.usage;
    if (out.finish) finish = out.finish;
  }
}

console.log('\n\n---');
console.log(`First token: ${firstTokenMs ?? '—'} ms | total: ${Date.now() - t0} ms | finish: ${finish}`);
if (usage) console.log(`Tokens — ${provider.usageLine(usage)}`);
if (limitHeaders.length) console.log('Rate-limit headers:', Object.fromEntries(limitHeaders));
