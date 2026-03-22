import { useEffect, useRef } from 'react';
import MessageBubble from './MessageBubble';
import TypingIndicator from './TypingIndicator';

export default function MessageList({ messages, isLoading, currentStatus }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, currentStatus]);

  return (
    <div className="agent-chat-messages">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      {isLoading && currentStatus && (
        <TypingIndicator statusMessage={currentStatus} />
      )}
      {isLoading && !currentStatus && (
        <TypingIndicator />
      )}
      <div ref={bottomRef} />
    </div>
  );
}
