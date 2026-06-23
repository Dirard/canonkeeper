import { ChevronDown, MessageSquare, Plus } from 'lucide-react';
import styles from './ProjectSidebar.module.css';
import { WorkspaceNav, type WorkspaceArea } from './WorkspaceNav';

export type SidebarSessionStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error' | 'forbidden';

/** Minimal session shape so the shared sidebar stays decoupled from entities. */
export interface SidebarSession {
  id: string;
  title: string;
}

export interface ProjectSidebarProps {
  active: WorkspaceArea;
  activeChatId: string;
  chatNotice?: string;
  canCreateChat?: boolean;
  onChat: () => void;
  onCreateChat: () => void;
  onManuscript: () => void;
  onOpenProjectMenu?: () => void;
  onSelectChat: (chatId: string) => void;
  projectMeta: string;
  projectTitle: string;
  sessions: SidebarSession[];
  sessionStatus: SidebarSessionStatus;
  /** 'sidebar' = the fixed-width desktop rail; 'drawer' = fills a mobile drawer. */
  variant?: 'sidebar' | 'drawer';
}

/**
 * The single project sidebar shared by every workspace surface (library,
 * chat, reader, draft) on desktop AND inside the mobile drawer menus. Project
 * switcher + workspace nav + project chats.
 */
export function ProjectSidebar({
  active,
  activeChatId,
  chatNotice,
  canCreateChat = true,
  onChat,
  onCreateChat,
  onManuscript,
  onOpenProjectMenu,
  onSelectChat,
  projectMeta,
  projectTitle,
  sessions,
  sessionStatus,
  variant = 'sidebar',
}: ProjectSidebarProps) {
  const inner = (
    <>
      <button className={styles.projectButton} disabled={!onOpenProjectMenu} onClick={onOpenProjectMenu} type="button">
        {projectTitle}
        <ChevronDown aria-hidden="true" size={17} />
      </button>
      <p className={styles.projectMeta}>{projectMeta}</p>

      <WorkspaceNav active={active} onChat={onChat} onManuscript={onManuscript} />

      <section className={styles.chats} aria-label="Чаты проекта">
        <div className={styles.sessionHeader}>
          <p className={styles.chatsTitle}>Чаты проекта</p>
          <button aria-label="Новый чат" className={styles.iconButton} disabled={!canCreateChat} onClick={onCreateChat} type="button">
            <Plus aria-hidden="true" size={18} />
          </button>
        </div>
        <div className={styles.sessionList}>
          {sessionStatus === 'loading' ? <p className={styles.muted}>Загружаем чаты...</p> : null}
          {sessionStatus === 'empty' ? <p className={styles.muted}>В проекте пока нет чатов.</p> : null}
          {sessionStatus === 'error' || sessionStatus === 'forbidden' ? (
            <p className={styles.muted}>Не удалось загрузить чаты проекта.</p>
          ) : null}
          {chatNotice ? <p className={styles.muted}>{chatNotice}</p> : null}
          {sessions.map((session) => (
            <button
              aria-current={session.id === activeChatId ? 'page' : undefined}
              className={session.id === activeChatId ? styles.activeSessionButton : styles.sessionButton}
              key={session.id}
              onClick={() => onSelectChat(session.id)}
              type="button"
            >
              <MessageSquare aria-hidden="true" size={17} />
              <span className={styles.sessionTitle}>{session.title}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );

  if (variant === 'drawer') {
    return <div className={styles.sidebarDrawer}>{inner}</div>;
  }
  return (
    <aside className={styles.sidebar} aria-label="Навигация проекта">
      {inner}
    </aside>
  );
}
