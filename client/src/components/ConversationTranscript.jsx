import { formatDuration } from '../utils/format.js';

export default function ConversationTranscript({
  segments,
  assistantName = 'Victor',
  contactName = '',
}) {
  if (!Array.isArray(segments) || segments.length === 0) return null;

  return (
    <ol className="conversation-transcript" aria-label="Gesprächsverlauf">
      {segments.map((segment, index) => {
        const isAssistant = segment.role === 'agent';
        return (
          <li
            key={segment.id || `${segment.timeInCallSecs}-${index}`}
            className={`transcript-turn ${isAssistant ? 'assistant' : 'contact'}`}
          >
            <div className="transcript-meta">
              <strong>{isAssistant ? assistantName : contactName || 'Gesprächspartner'}</strong>
              {segment.timeInCallSecs > 0 ? (
                <span>{formatDuration(segment.timeInCallSecs)}</span>
              ) : null}
            </div>
            <p>{segment.message}</p>
          </li>
        );
      })}
    </ol>
  );
}
