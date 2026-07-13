import { Fragment, type RefObject } from 'react';
import { MarkdownRenderer } from '../MarkdownRenderer';
import { formatElapsed } from './assistantActivity';
import { turnSeparatorFor, type AssistantMessage } from './assistantMessages';

interface AssistantMessageListProps {
  messages: AssistantMessage[];
  messagesEndRef: RefObject<HTMLDivElement>;
}

function separatorText(turn: number, ts?: number, durationSeconds?: number, changes?: number): string {
  const parts: string[] = [`turn ${turn}`];
  if (ts) {
    const date = new Date(ts);
    parts.unshift(`${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`);
  }
  if (typeof durationSeconds === 'number' && durationSeconds > 0) {
    parts.push(`done in ${formatElapsed(durationSeconds)}`);
    if (typeof changes === 'number' && changes > 0) parts.push(`${changes} change${changes === 1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}

/** Conversation transcript of the assistant drawer (pure render). */
export function AssistantMessageList({ messages, messagesEndRef }: AssistantMessageListProps) {
  return (
    <div className="assistant-messages">
      {messages.map((message, index) => {
        const separator = turnSeparatorFor(messages, index);
        return (
          <Fragment key={message.id}>
            {separator ? (
              <div className="assistant-turn-separator" role="separator">
                <span>{separatorText(separator.turn, separator.ts, separator.durationSeconds, separator.changes)}</span>
              </div>
            ) : null}
            <div className={`assistant-message ${message.role}`}>
              {message.role === 'user' ? (
                // User prose renders literal: a request containing '#' or '*'
                // must never be reinterpreted as markup.
                <div className="assistant-user-text">{message.content}</div>
              ) : (
                <MarkdownRenderer markdown={message.content} className="assistant-markdown" />
              )}
            </div>
          </Fragment>
        );
      })}
      <div ref={messagesEndRef} aria-hidden="true" />
    </div>
  );
}
