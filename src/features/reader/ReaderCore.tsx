import { X } from 'lucide-react';
import { publicApiErrorMessage } from '../../entities/api-errors';
import { type ReaderLocator, type ReaderSourceClient, useReaderSourceChapterQuery } from '../../entities/manuscript/api';
import styles from './ReaderCore.module.css';

interface ReaderCoreProps {
  api: ReaderSourceClient;
  activeParagraphId?: string | null;
  locator: ReaderLocator;
  mode?: 'pane' | 'drawer' | 'fullscreen';
  onClose?: () => void;
  onParagraphSelect?: (locator: ReaderLocator, quote: string) => void;
}

type ReaderStatus = 'loading' | 'ready' | 'error';

export function ReaderCore({ api, activeParagraphId, locator, mode = 'pane', onClose, onParagraphSelect }: ReaderCoreProps) {
  const chapterQuery = useReaderSourceChapterQuery(api, locator.chapterId);
  const chapter = chapterQuery.data ?? null;
  const status: ReaderStatus = chapterQuery.isPending ? 'loading' : chapterQuery.isError ? 'error' : 'ready';
  const error = publicApiErrorMessage(chapterQuery.error, 'Не удалось открыть источник.');

  return (
    <article className={styles.readerCore} data-reader-mode={mode} data-reader-target={locator.paragraphId ?? 'chapter'}>
      <header className={styles.readerHeader}>
        <div>
          <p>{chapter ? `Глава ${chapter.navigation.displayNumber}` : 'Источник'}</p>
          <h2>{chapter ? `Глава ${chapter.navigation.displayNumber}. ${chapter.title}` : 'Открываем главу'}</h2>
        </div>
        {onClose ? (
          <button aria-label="Закрыть читалку" className={styles.closeButton} onClick={onClose} type="button">
            <X aria-hidden="true" size={20} />
          </button>
        ) : null}
      </header>

      <div className={styles.readerBody} role="document">
        {status === 'loading' ? <p className={styles.state}>Открываем источник...</p> : null}
        {status === 'error' ? <p className={styles.state}>{error}</p> : null}
        {status === 'ready' && chapter
          ? chapter.paragraphs.filter((paragraph) => paragraph.kind !== 'heading').map((paragraph) => {
              const isTarget = paragraph.id === (activeParagraphId ?? locator.paragraphId);
              const paragraphLocator: ReaderLocator = {
                ...locator,
                paragraphId: paragraph.id,
                range: {
                  startOffset: 0,
                  endOffset: paragraph.text.length,
                  quote: paragraph.text,
                },
              };
              return (
                <p className={styles.paragraph} data-paragraph-id={paragraph.id} key={paragraph.id}>
                  {onParagraphSelect ? (
                    <button
                      aria-pressed={isTarget}
                      className={styles.paragraphButton}
                      onClick={() => onParagraphSelect(paragraphLocator, paragraph.text)}
                      type="button"
                    >
                      {isTarget ? <mark className={styles.highlight}>{paragraph.text}</mark> : paragraph.text}
                    </button>
                  ) : isTarget ? (
                    <mark className={styles.highlight}>{paragraph.text}</mark>
                  ) : (
                    paragraph.text
                  )}
                </p>
              );
            })
          : null}
      </div>

      {chapter ? (
        <footer className={styles.footer}>
          <span>
            Ревизия <strong>{locator.revision ?? chapter.revision}</strong>
          </span>
          <span>
            {chapter.navigation.position} / {chapter.navigation.total}
          </span>
        </footer>
      ) : null}
    </article>
  );
}
