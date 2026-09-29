import { useState, useRef, useEffect } from 'react';
import { Brain, X, Send, ChevronDown } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useFleet } from '../context/FleetContext';
import { answerAriaLocal, buildAriaRemoteContext, type AriaSnapshot } from '../lib/ariaAssistant';

const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY;

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `You are BPL Analyst — embedded fleet intelligence for Best Practices Limited (BPL).

Be sharp and brief. 3-5 sentences max unless the question genuinely demands more. Lead with the most important fact. Use specific names, numbers, and vehicles from the data. Never pad or repeat yourself.

Cite standards (FMCSA BASICs, FRSC Nigeria, ISO 39001) only when directly relevant. If data is missing say "not available in current view — check [section]."`;

function parseInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`/g;
  let last = 0, key = 0, match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1] !== undefined)
      parts.push(<strong key={key++} style={{ fontWeight: 700, color: 'var(--cd-text)' }}>{match[1]}</strong>);
    else if (match[2] !== undefined)
      parts.push(<em key={key++} style={{ fontStyle: 'italic', opacity: 0.85 }}>{match[2]}</em>);
    else if (match[3] !== undefined)
      parts.push(<code key={key++} style={{ fontFamily: 'monospace', fontSize: '0.88em', background: 'rgba(0,120,212,0.12)', padding: '1px 5px', borderRadius: 4 }}>{match[3]}</code>);
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function renderMessage(content: string): React.ReactNode {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];
  let listType: 'ul' | 'ol' = 'ul';

  const flushList = (key: number) => {
    if (!listItems.length) return;
    const Tag = listType;
    elements.push(
      <Tag key={`list-${key}`} style={{ margin: '4px 0 6px', paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {listItems}
      </Tag>
    );
    listItems = [];
  };

  lines.forEach((line, i) => {
    if (line.trim() === '') {
      flushList(i);
      if (elements.length > 0) elements.push(<div key={`gap-${i}`} style={{ height: 5 }} />);
      return;
    }
    // Headings
    const h3 = line.match(/^###\s+(.*)/);
    const h2 = line.match(/^#{1,2}\s+(.*)/);
    if (h3) {
      flushList(i);
      elements.push(<div key={i} style={{ fontSize: 11, fontWeight: 800, color: 'var(--bpl-blue)', textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 10, marginBottom: 2 }}>{parseInline(h3[1])}</div>);
      return;
    }
    if (h2) {
      flushList(i);
      elements.push(<div key={i} style={{ fontSize: 13, fontWeight: 700, color: 'var(--cd-text)', marginTop: 8, marginBottom: 3 }}>{parseInline(h2[1])}</div>);
      return;
    }
    // Bullet
    const bullet = line.match(/^[-*]\s+(.*)/);
    if (bullet) {
      listType = 'ul';
      listItems.push(
        <li key={i} style={{ display: 'flex', gap: 7, alignItems: 'flex-start', fontSize: 'inherit' }}>
          <span style={{ color: 'var(--bpl-blue)', fontWeight: 700, marginTop: 1, flexShrink: 0 }}>·</span>
          <span style={{ lineHeight: 1.55 }}>{parseInline(bullet[1])}</span>
        </li>
      );
      return;
    }
    // Numbered list
    const num = line.match(/^(\d+)\.\s+(.*)/);
    if (num) {
      listType = 'ol';
      listItems.push(
        <li key={i} style={{ display: 'flex', gap: 7, alignItems: 'flex-start', fontSize: 'inherit' }}>
          <span style={{ color: 'var(--bpl-blue)', fontWeight: 700, minWidth: 18, flexShrink: 0 }}>{num[1]}.</span>
          <span style={{ lineHeight: 1.55 }}>{parseInline(num[2])}</span>
        </li>
      );
      return;
    }
    // Paragraph
    flushList(i);
    elements.push(<div key={i} style={{ lineHeight: 1.6 }}>{parseInline(line)}</div>);
  });

  flushList(lines.length);
  return <>{elements}</>;
}

const PAGE_LABELS: Record<string, string> = {
  '/': 'Dashboard',
  '/drivers': 'Driver Management',
  '/incidents': 'Incident Intelligence',
  '/safety': 'Safety',
  '/aria': 'BPL Analyst Intelligence',
  '/reports': 'Reports & Reviews',
  '/trips': 'Journey Management',
  '/trips/dispatch': 'Dispatch',
  '/settings': 'Settings',
};

const LOCAL_THINK_MS_MIN = 600;
const LOCAL_THINK_MS_MAX = 1100;
const LOCAL_STREAM_TICK_MS = 30;
/** Caps stream length so long local answers still finish in ~2s. */
const LOCAL_STREAM_MAX_TICKS = 60;

const SUGGESTED_PROMPTS = [
  'Which driver needs attention most urgently right now?',
  'What are the top safety risks this week?',
  'Summarise current fleet status.',
  'What actions should I take today?',
];

export default function ARIAChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const location = useLocation();
  const { fleetSafetyScore, fleetScoreDelta, redAlertCount, vaultRecords, metadata, events, notifications, insights, driverDistance } = useFleet();

  const currentPage = PAGE_LABELS[location.pathname] || location.pathname;
  const watTime = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Lagos', hour12: false });

  const snapshot = (): AriaSnapshot => ({
    page: currentPage,
    watTime,
    score: fleetSafetyScore,
    scoreDelta: fleetScoreDelta,
    metadata,
    redAlertCount,
    events,
    notifications,
    vaultRecords,
    insights,
    driverDistance,
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  /** Local answers get the same thinking + streaming feel as model replies. */
  const playLocalAnswer = async (content: string) => {
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    await sleep(LOCAL_THINK_MS_MIN + Math.random() * (LOCAL_THINK_MS_MAX - LOCAL_THINK_MS_MIN));
    const tokens = content.match(/\S+\s*|\s+/g) ?? [content];
    const perTick = Math.max(1, Math.ceil(tokens.length / LOCAL_STREAM_MAX_TICKS));
    let shown = '';
    for (let i = 0; i < tokens.length; i += perTick) {
      shown += tokens.slice(i, i + perTick).join('');
      setStreamingContent(shown);
      await sleep(LOCAL_STREAM_TICK_MS);
    }
    setMessages(prev => [...prev, { role: 'assistant', content }]);
    setStreamingContent('');
    setLoading(false);
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: Message = { role: 'user', content: text.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setStreamingContent('');

    const snap = snapshot();
    const local = answerAriaLocal(text, snap);
    if (local) {
      await playLocalAnswer(local);
      return;
    }

    const history = messages.slice(-2).map(m => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          system: SYSTEM_PROMPT,
          stream: true,
          messages: [
            ...history,
            { role: 'user', content: buildAriaRemoteContext(text.trim(), snap) },
          ],
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `BPL Analyst encountered an error: ${err || res.statusText}. Please check your API key configuration.`,
        }]);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) return;

      let fullContent = '';
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              fullContent += parsed.delta.text;
              setStreamingContent(fullContent);
            }
          } catch {}
        }
      }

      setMessages(prev => [...prev, { role: 'assistant', content: fullContent }]);
      setStreamingContent('');
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Unable to reach BPL Analyst at this moment. Check network connectivity and API configuration.',
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  };

  return (
    <>
      {/* FAB */}
      <button
        className="bpl-aria-fab"
        onClick={() => setOpen(o => !o)}
        title="Open BPL Analyst"
        style={{ bottom: open ? 'calc(100vh - 40px)' : 28 }}
      >
        {open ? <ChevronDown size={22} /> : <Brain size={22} />}
      </button>

      {/* Drawer */}
      <div className={`bpl-aria-drawer${open ? ' open' : ''}`}>
        {/* Header */}
        <div className="bpl-aria-drawer-header">
          <div className="bpl-aria-drawer-title">
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: 'rgba(0,120,212,0.3)',
              border: '1px solid rgba(0,120,212,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Brain size={16} color="#60b4ff" />
            </div>
            <div>
              <div className="bpl-aria-name">BPL Analyst</div>
              <div className="bpl-aria-tagline">Fleet Intelligence</div>
            </div>
          </div>
          <button className="bpl-aria-close" onClick={() => setOpen(false)}>
            <X size={18} />
          </button>
        </div>

        {/* Context strip */}
        <div style={{
          padding: '8px 16px',
          background: 'var(--cd-surface-2)',
          borderBottom: '1px solid var(--cd-border)',
          display: 'flex',
          gap: 12,
          fontSize: 11,
          color: 'var(--cd-text-muted)',
        }}>
          <span>Score: <strong style={{ color: fleetSafetyScore >= 80 ? '#16a34a' : fleetSafetyScore >= 60 ? '#d97706' : fleetSafetyScore >= 45 ? '#e05c2a' : '#CC0000' }}>{fleetSafetyScore}/100</strong></span>
          <span>Active: <strong style={{ color: 'var(--cd-text)' }}>{metadata.moving}</strong></span>
          {redAlertCount > 0 && <span style={{ color: '#CC0000' }}>Red Alerts: <strong>{redAlertCount}</strong></span>}
          <span style={{ marginLeft: 'auto' }}>{currentPage}</span>
        </div>

        {/* Messages */}
        <div className="bpl-aria-messages">
          {messages.length === 0 && !loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 12,
                  background: 'var(--bpl-blue-soft)',
                  border: '1px solid rgba(0,120,212,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 12px',
                }}>
                  <Brain size={22} color="var(--bpl-blue)" />
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--cd-text)', marginBottom: 4, fontFamily: 'var(--cd-font-display)' }}>
                  BPL Analyst is ready
                </div>
                <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', lineHeight: 1.5 }}>
                  Ask me anything about the fleet — drivers, incidents, safety, compliance.
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {SUGGESTED_PROMPTS.map(p => (
                  <button
                    key={p}
                    onClick={() => sendMessage(p)}
                    style={{
                      padding: '9px 12px', textAlign: 'left',
                      background: 'var(--cd-surface-2)',
                      border: '1px solid var(--cd-border)',
                      borderRadius: 8, cursor: 'pointer',
                      fontSize: 12, color: 'var(--cd-text)',
                      fontFamily: 'var(--cd-font-body)',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bpl-blue-soft)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'var(--cd-surface-2)')}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`bpl-aria-msg bpl-aria-msg-${msg.role === 'assistant' ? 'aria' : 'user'}`}>
              {msg.role === 'assistant' && (
                <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', marginBottom: 3, fontWeight: 600 }}>BPL Analyst</div>
              )}
              <div className={`bpl-aria-bubble bpl-aria-bubble-${msg.role === 'assistant' ? 'aria' : 'user'}`}>
                {msg.role === 'assistant' ? renderMessage(msg.content) : msg.content}
              </div>
            </div>
          ))}

          {loading && streamingContent && (
            <div className="bpl-aria-msg bpl-aria-msg-aria">
              <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', marginBottom: 3, fontWeight: 600 }}>BPL Analyst</div>
              <div className="bpl-aria-bubble bpl-aria-bubble-aria">
                {renderMessage(streamingContent)}
                <span style={{ display: 'inline-block', width: 7, height: 13, background: 'var(--bpl-blue)', borderRadius: 2, marginLeft: 2, verticalAlign: 'text-bottom', animation: 'aria-typing 0.8s ease infinite' }} />
              </div>
            </div>
          )}

          {loading && !streamingContent && (
            <div className="bpl-aria-msg bpl-aria-msg-aria">
              <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', marginBottom: 3, fontWeight: 600 }}>BPL Analyst</div>
              <div className="bpl-aria-bubble bpl-aria-bubble-aria bpl-aria-bubble-typing">
                <div className="bpl-aria-typing-dot" />
                <div className="bpl-aria-typing-dot" />
                <div className="bpl-aria-typing-dot" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="bpl-aria-input-area">
          <textarea
            ref={textareaRef}
            className="bpl-aria-input"
            placeholder="Ask BPL Analyst anything about the fleet..."
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            rows={1}
            style={{ height: 40 }}
          />
          <button
            className="bpl-aria-send"
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading}
            title="Send"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </>
  );
}
