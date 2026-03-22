import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ToolResultRenderer from './ToolResultRenderer';

export default function MessageBubble({ message }) {
  if (message.role === 'user') {
    return (
      <div className="agent-chat-bubble agent-chat-bubble-user">
        {message.content}
      </div>
    );
  }

  if (message.role === 'error') {
    return (
      <div className="agent-chat-bubble agent-chat-bubble-error">
        {message.content}
      </div>
    );
  }

  // Agent message
  return (
    <div className="agent-chat-bubble agent-chat-bubble-agent">
      {message.content && (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          }}
        >
          {message.content}
        </ReactMarkdown>
      )}
      {message.toolResults &&
        message.toolResults.map((result, idx) => (
          <ToolResultRenderer key={idx} result={result} />
        ))}
    </div>
  );
}
