import { type FormEvent } from 'react';
import { Check, MessageSquare, Quote, Send, X } from 'lucide-react';
import type { AgentSuggestion } from '../../../entities/manuscript/api';
import styles from './ManuscriptEditorAgentPanel.module.css';

type AgentPanelStatus = 'idle' | 'loading' | 'error';

interface ManuscriptEditorAgentPanelProps {
  canEdit: boolean;
  composerValue: string;
  draftTitle: string;
  notice: string;
  pendingActionId: string | null;
  requesting: boolean;
  selectedExcerpt: string;
  status: AgentPanelStatus;
  suggestions: AgentSuggestion[];
  onApprove: (suggestion: AgentSuggestion) => void;
  onChangeComposer: (value: string) => void;
  onReject: (suggestion: AgentSuggestion) => void;
  onSendMessage: (event: FormEvent<HTMLFormElement>) => void;
}

const kindLabels: Record<AgentSuggestion['kind'], string> = {
  punctuation: 'Пунктуация',
  canon_consistency: 'Канон',
  style: 'Стиль',
  continuity: 'Непрерывность',
  rewrite: 'Переписать',
};

export function ManuscriptEditorAgentPanel({
  canEdit,
  composerValue,
  draftTitle,
  notice,
  pendingActionId,
  requesting,
  selectedExcerpt,
  status,
  suggestions,
  onApprove,
  onChangeComposer,
  onReject,
  onSendMessage,
}: ManuscriptEditorAgentPanelProps) {
  const pending = suggestions.filter((suggestion) => suggestion.status === 'pending');

  return (
    <section className={styles.panel} aria-label="Редакторский чат">
      <div className={styles.contextCard}>
        <p className={styles.kicker}>Редакторский агент</p>
        <div className={styles.titleRow}>
          <strong>{draftTitle}</strong>
          <MessageSquare aria-hidden="true" size={16} />
        </div>
        <p className={styles.contextText}>Работает с текущей главой и выделенным фрагментом. Чаты саги открываются отдельно на странице «Чат».</p>
        {selectedExcerpt ? (
          <figure className={styles.selection}>
            <figcaption className={styles.selectionLabel}>
              <Quote aria-hidden="true" size={13} />
              Выделенный фрагмент
            </figcaption>
            <p className={styles.selectionText}>{selectedExcerpt}</p>
          </figure>
        ) : (
          <p className={styles.selectionHint}>Выделите фрагмент в рукописи, чтобы агент работал с точным местом текста.</p>
        )}
      </div>

      <p className={styles.kicker}>Предложения агента</p>

      <div className={styles.thread} aria-label="Предложения редактора">
        {status === 'loading' ? <p className={styles.notice}>Загружаем предложения...</p> : null}
        {status === 'error' ? <p className={styles.notice}>{notice || 'Предложения агента недоступны.'}</p> : null}
        {status === 'idle' && pending.length === 0 && !requesting ? (
          <p className={styles.notice}>Активных предложений нет. Опишите правку ниже — агент вернёт точечный дифф.</p>
        ) : null}
        {requesting ? <p className={styles.notice}>Готовлю предложение...</p> : null}
        {pending.map((suggestion) => {
          const diff = suggestion.diffs[0];
          const busy = pendingActionId === suggestion.id;
          return (
            <article className={styles.suggestionCard} key={suggestion.id}>
              <p className={styles.kicker}>{kindLabels[suggestion.kind]}</p>
              <strong className={styles.suggestionTitle}>{suggestion.title}</strong>
              <p className={styles.contextText}>{suggestion.rationale}</p>
              {diff ? (
                <p className={styles.diff}>
                  <span className={styles.remove}>- {diff.before}</span>
                  <span className={styles.add}>+ {diff.after}</span>
                </p>
              ) : null}
              <div className={styles.actions}>
                <button className={styles.rejectButton} disabled={!canEdit || busy} onClick={() => onReject(suggestion)} type="button">
                  <X aria-hidden="true" size={15} />
                  Отклонить
                </button>
                <button className={styles.applyButton} disabled={!canEdit || busy} onClick={() => onApprove(suggestion)} type="button">
                  <Check aria-hidden="true" size={15} />
                  Применить
                </button>
              </div>
            </article>
          );
        })}
        {status !== 'error' && notice ? <p className={styles.notice}>{notice}</p> : null}
      </div>

      <form className={styles.composer} onSubmit={onSendMessage}>
        <input
          aria-label="Сообщение редакторскому агенту"
          disabled={!canEdit}
          onChange={(event) => onChangeComposer(event.target.value)}
          placeholder={canEdit ? 'Попросите проверить сцену...' : 'У вас доступ только для чтения'}
          value={composerValue}
        />
        <button aria-label="Отправить редакторскому агенту" className={styles.sendButton} disabled={!canEdit || !composerValue.trim() || requesting} type="submit">
          <Send aria-hidden="true" size={17} />
        </button>
      </form>
    </section>
  );
}
