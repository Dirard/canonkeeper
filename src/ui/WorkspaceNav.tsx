import { MessageSquare, NotebookPen } from 'lucide-react';
import styles from './WorkspaceNav.module.css';

export type WorkspaceArea = 'chat' | 'manuscript';

interface WorkspaceNavProps {
  active: WorkspaceArea;
  onChat: () => void;
  onManuscript: () => void;
}

export function WorkspaceNav({ active, onChat, onManuscript }: WorkspaceNavProps) {
  return (
    <nav aria-label="Рабочая область">
      <p className={styles.sectionLabel}>Рабочая область</p>
      <div className={styles.navList}>
        <button className={active === 'manuscript' ? styles.activeNavButton : styles.navButton} onClick={onManuscript} type="button">
          <NotebookPen aria-hidden="true" size={17} />
          Рукопись
        </button>
        <button className={active === 'chat' ? styles.activeNavButton : styles.navButton} onClick={onChat} type="button">
          <MessageSquare aria-hidden="true" size={17} />
          Чат
        </button>
      </div>
    </nav>
  );
}
