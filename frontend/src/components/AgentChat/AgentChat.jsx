import { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MessageOutlined,
  CloseOutlined,
  ClearOutlined,
  ExclamationCircleOutlined,
  LockOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import shortid from 'shortid';

import { sendAgentMessage, isAuthenticated } from './agentApi';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import './AgentChat.css';

const SUGGESTED_PROMPTS = [
  'Show my recent invoices',
  'List all clients',
  "What's the payment summary this month?",
  'Go to settings',
];

export default function AgentChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(null);
  const [error, setError] = useState(null);

  const abortRef = useRef(null);
  const navigate = useNavigate();

  const handleToggle = () => {
    setIsOpen((prev) => !prev);
  };

  const handleClose = () => {
    setIsOpen(false);
  };

  const handleEscape = useCallback(
    (e) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    },
    [isOpen]
  );

  const handleClear = () => {
    if (abortRef.current) abortRef.current.abort();
    setMessages([]);
    setConversationId(null);
    setIsLoading(false);
    setCurrentStatus(null);
    setError(null);
  };

  /**
   * Execute a frontend action (navigation, dispatch, ui_control) and report back.
   */
  const handleFrontendAction = useCallback(
    async (actionData) => {
      const { actionType, route, tool, toolCallId } = actionData;
      let result;

      try {
        if (actionType === 'navigate') {
          navigate(route);
          result = { success: true, message: `Navigated to ${route}` };
        } else if (actionType === 'dispatch' || actionType === 'ui_control') {
          // For state dispatch / UI controls, report success
          // (actual Redux dispatch would be wired here if needed)
          result = { success: true, message: `Action "${actionType}" executed` };
        } else {
          result = { success: false, error: `Unknown action type: ${actionType}` };
        }
      } catch (err) {
        result = { success: false, error: err.message };
      }

      // Show status while reporting result back
      setCurrentStatus('\u270D\uFE0F Writing response...');

      // Report result back to engine — continuation of the agentic loop
      const currentConvId = conversationId;
      const abortController = new AbortController();
      abortRef.current = abortController;

      let agentContent = '';
      const agentMsgId = shortid.generate();

      await sendAgentMessage({
        frontendResult: { tool, toolCallId, ...result },
        conversationId: currentConvId,
        signal: abortController.signal,
        onStatus: (msg) => setCurrentStatus(msg),
        onTextDelta: (chunk) => {
          agentContent += chunk;
          setMessages((prev) => {
            const existing = prev.find((m) => m.id === agentMsgId);
            if (existing) {
              return prev.map((m) =>
                m.id === agentMsgId ? { ...m, content: agentContent } : m
              );
            }
            return [
              ...prev,
              { id: agentMsgId, role: 'agent', content: agentContent, timestamp: Date.now() },
            ];
          });
        },
        onToolResult: (tr) => {
          setMessages((prev) => {
            const existing = prev.find((m) => m.id === agentMsgId);
            if (existing) {
              return prev.map((m) =>
                m.id === agentMsgId
                  ? { ...m, toolResults: [...(m.toolResults || []), tr] }
                  : m
              );
            }
            return [
              ...prev,
              { id: agentMsgId, role: 'agent', content: '', toolResults: [tr], timestamp: Date.now() },
            ];
          });
        },
        onFrontendAction: (fa) => handleFrontendAction(fa),
        onDone: ({ conversationId: newConvId }) => {
          if (newConvId) setConversationId(newConvId);
          setIsLoading(false);
          setCurrentStatus(null);
        },
        onError: (msg) => {
          setError(msg);
          setIsLoading(false);
          setCurrentStatus(null);
        },
      });
    },
    [conversationId, navigate]
  );

  /**
   * Send a user message and handle the SSE response stream.
   */
  const handleSend = useCallback(
    async (userMessage) => {
      // Add user message immediately
      const userMsg = {
        id: shortid.generate(),
        role: 'user',
        content: userMessage,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
      setError(null);
      setCurrentStatus(null);

      const abortController = new AbortController();
      abortRef.current = abortController;

      let agentContent = '';
      const agentMsgId = shortid.generate();

      await sendAgentMessage({
        message: userMessage,
        conversationId,
        signal: abortController.signal,
        onStatus: (msg) => setCurrentStatus(msg),
        onTextDelta: (chunk) => {
          // Clear status when text starts arriving
          setCurrentStatus(null);
          agentContent += chunk;
          setMessages((prev) => {
            const existing = prev.find((m) => m.id === agentMsgId);
            if (existing) {
              return prev.map((m) =>
                m.id === agentMsgId ? { ...m, content: agentContent } : m
              );
            }
            return [
              ...prev,
              { id: agentMsgId, role: 'agent', content: agentContent, timestamp: Date.now() },
            ];
          });
        },
        onToolResult: (tr) => {
          setMessages((prev) => {
            const existing = prev.find((m) => m.id === agentMsgId);
            if (existing) {
              return prev.map((m) =>
                m.id === agentMsgId
                  ? { ...m, toolResults: [...(m.toolResults || []), tr] }
                  : m
              );
            }
            return [
              ...prev,
              {
                id: agentMsgId,
                role: 'agent',
                content: '',
                toolResults: [tr],
                timestamp: Date.now(),
              },
            ];
          });
        },
        onFrontendAction: (fa) => handleFrontendAction(fa),
        onDone: ({ conversationId: newConvId }) => {
          if (newConvId) setConversationId(newConvId);
          setIsLoading(false);
          setCurrentStatus(null);
        },
        onError: (msg) => {
          setError(msg);
          setIsLoading(false);
          setCurrentStatus(null);
        },
      });
    },
    [conversationId, handleFrontendAction]
  );

  const handleRetry = () => {
    setError(null);
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg) {
      // Remove the last user message so handleSend can re-add it
      setMessages((prev) => prev.filter((m) => m.id !== lastUserMsg.id));
      handleSend(lastUserMsg.content);
    }
  };

  const handlePromptClick = (prompt) => {
    handleSend(prompt);
  };

  const authenticated = isAuthenticated();

  return (
    <>
      {/* Floating trigger button */}
      <button
        className="agent-chat-trigger"
        onClick={handleToggle}
        title={isOpen ? 'Close chat' : 'Open AI assistant'}
        onKeyDown={handleEscape}
      >
        {isOpen ? <CloseOutlined /> : <MessageOutlined />}
      </button>

      {/* Chat drawer */}
      {isOpen && (
        <div className="agent-chat-drawer" onKeyDown={handleEscape}>
          {/* Header */}
          <div className="agent-chat-header">
            <div className="agent-chat-header-title">
              <RobotOutlined />
              AI Assistant
            </div>
            <div className="agent-chat-header-actions">
              {messages.length > 0 && (
                <button onClick={handleClear} title="Clear conversation">
                  <ClearOutlined />
                </button>
              )}
              <button onClick={handleClose} title="Close">
                <CloseOutlined />
              </button>
            </div>
          </div>

          {/* Login guard */}
          {!authenticated && (
            <div className="agent-chat-login-guard">
              <div className="agent-chat-login-guard-icon">
                <LockOutlined />
              </div>
              <span>Please log in to use the AI assistant.</span>
            </div>
          )}

          {/* Chat content */}
          {authenticated && (
            <>
              {messages.length === 0 && !isLoading ? (
                <div className="agent-chat-empty">
                  <div className="agent-chat-empty-icon">
                    <RobotOutlined />
                  </div>
                  <div className="agent-chat-empty-title">How can I help?</div>
                  <div className="agent-chat-empty-subtitle">
                    Ask me about invoices, clients, payments, or anything else.
                  </div>
                  <div className="agent-chat-prompts">
                    {SUGGESTED_PROMPTS.map((prompt) => (
                      <button
                        key={prompt}
                        className="agent-chat-prompt-btn"
                        onClick={() => handlePromptClick(prompt)}
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <MessageList
                  messages={messages}
                  isLoading={isLoading}
                  currentStatus={currentStatus}
                />
              )}

              {/* Error bar */}
              {error && (
                <div className="agent-chat-error">
                  <ExclamationCircleOutlined />
                  <span>{error}</span>
                  <button onClick={handleRetry}>Retry</button>
                </div>
              )}

              {/* Input */}
              <ChatInput onSend={handleSend} disabled={isLoading || !authenticated} />
            </>
          )}
        </div>
      )}
    </>
  );
}
