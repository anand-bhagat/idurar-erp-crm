/**
 * Agent API helper — all agent API communication in one place.
 * Uses native fetch for SSE streaming (axios doesn't support ReadableStream well).
 */

import { API_BASE_URL } from '@/config/serverApiConfig';
import storePersist from '@/redux/storePersist';

function getAuthHeaders() {
  const auth = storePersist.get('auth');
  const headers = { 'Content-Type': 'application/json' };
  if (auth && auth.current && auth.current.token) {
    headers['Authorization'] = `Bearer ${auth.current.token}`;
  }
  return headers;
}

/**
 * Check if the user is currently authenticated.
 */
export function isAuthenticated() {
  const auth = storePersist.get('auth');
  return !!(auth && auth.current && auth.current.token);
}

/**
 * Send a message to the agent via SSE streaming.
 *
 * @param {object} params
 * @param {string} [params.message] - User message
 * @param {object} [params.frontendResult] - Frontend tool result to report back
 * @param {string} [params.conversationId] - Existing conversation ID
 * @param {function} params.onStatus - Called with status message string
 * @param {function} params.onTextDelta - Called with text chunk string
 * @param {function} params.onToolResult - Called with tool result object
 * @param {function} params.onFrontendAction - Called with frontend action data
 * @param {function} params.onDone - Called with { conversationId }
 * @param {function} params.onError - Called with error message string
 * @param {AbortSignal} [params.signal] - AbortController signal
 */
export async function sendAgentMessage({
  message,
  frontendResult,
  conversationId,
  onStatus,
  onTextDelta,
  onToolResult,
  onFrontendAction,
  onDone,
  onError,
  signal,
}) {
  const body = {};
  if (message) body.message = message;
  if (frontendResult) body.frontendResult = frontendResult;
  if (conversationId) body.conversationId = conversationId;

  let response;
  try {
    response = await fetch(API_BASE_URL + 'agent/chat?stream=true', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
      credentials: 'include',
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') return;
    onError('Network error. Please check your connection.');
    return;
  }

  if (!response.ok) {
    if (response.status === 401) {
      onError('Session expired. Please log in again.');
    } else if (response.status === 429) {
      onError('Too many requests. Please slow down.');
    } else {
      onError(`Server error (${response.status}). Please try again.`);
    }
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE lines from buffer
      const lines = buffer.split('\n');
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;

        let event;
        try {
          event = JSON.parse(trimmed.slice(6));
        } catch {
          continue;
        }

        switch (event.type) {
          case 'status':
            onStatus(event.message);
            break;
          case 'text_delta':
            onTextDelta(event.content);
            break;
          case 'tool_result':
            onToolResult(event);
            break;
          case 'frontend_action':
            onFrontendAction(event);
            return; // Stop reading — widget handles the action
          case 'error':
            onError(event.message);
            break;
          case 'done':
            onDone({ conversationId: event.conversationId });
            return;
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    onError('Connection interrupted. Please try again.');
  }
}
