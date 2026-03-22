export default function TypingIndicator({ statusMessage }) {
  return (
    <div className="agent-typing-indicator">
      <div className="agent-typing-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <span>{statusMessage || 'Thinking...'}</span>
    </div>
  );
}
