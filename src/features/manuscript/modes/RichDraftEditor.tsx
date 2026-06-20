import LinkExtension from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { forwardRef, useEffect, useImperativeHandle, useRef, type CSSProperties } from 'react';
import type { FormatAction } from './manuscript-draft-model';
import { draftMarkdownToHtml, editorJsonToDraftMarkdown, normalizeDraftMarkdown } from './manuscript-draft-markdown';
import styles from './RichDraftEditor.module.css';

export interface RichDraftEditorHistoryState {
  canRedo: boolean;
  canUndo: boolean;
}

export interface RichDraftEditorHandle {
  focus: () => void;
  format: (action: FormatAction) => void;
}

interface RichDraftEditorProps {
  ariaLabel: string;
  displaySize: number;
  editable: boolean;
  hint: string;
  onChangeMarkdown: (value: string) => void;
  onHistoryStateChange: (state: RichDraftEditorHistoryState) => void;
  onSave: () => void;
  onSelectionTextChange: (value: string) => void;
  value: string;
}

export const RichDraftEditor = forwardRef<RichDraftEditorHandle, RichDraftEditorProps>(function RichDraftEditor(
  { ariaLabel, displaySize, editable, hint, onChangeMarkdown, onHistoryStateChange, onSave, onSelectionTextChange, value },
  ref,
) {
  const lastIncomingValueRef = useRef(normalizeDraftMarkdown(value));
  const editor = useEditor({
    content: draftMarkdownToHtml(value),
    editable,
    editorProps: {
      attributes: {
        'aria-label': ariaLabel,
        role: 'textbox',
      },
      handleDOMEvents: {
        keydown: (_view, event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            onSave();
            return true;
          }
          return false;
        },
      },
    },
    extensions: [
      StarterKit.configure({
        heading: { levels: [2] },
        link: false,
      }),
      LinkExtension.configure({
        autolink: false,
        openOnClick: false,
        protocols: ['http', 'https', 'canon'],
      }),
      Placeholder.configure({
        emptyEditorClass: 'is-editor-empty',
        placeholder: hint,
      }),
    ],
    immediatelyRender: false,
    onSelectionUpdate: ({ editor: nextEditor }) => {
      onSelectionTextChange(selectionText(nextEditor));
      emitHistoryState(nextEditor, onHistoryStateChange);
    },
    onTransaction: ({ editor: nextEditor }) => {
      emitHistoryState(nextEditor, onHistoryStateChange);
    },
    onUpdate: ({ editor: nextEditor }) => {
      const nextMarkdown = editorJsonToDraftMarkdown(nextEditor.getJSON());
      lastIncomingValueRef.current = nextMarkdown;
      onChangeMarkdown(nextMarkdown);
      onSelectionTextChange(selectionText(nextEditor));
      emitHistoryState(nextEditor, onHistoryStateChange);
    },
  });

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  useEffect(() => {
    if (!editor) return;
    const normalizedValue = normalizeDraftMarkdown(value);
    if (normalizedValue === lastIncomingValueRef.current) return;
    lastIncomingValueRef.current = normalizedValue;
    editor.commands.setContent(draftMarkdownToHtml(normalizedValue), { emitUpdate: false });
    emitHistoryState(editor, onHistoryStateChange);
  }, [editor, onHistoryStateChange, value]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => editor?.chain().focus().run(),
      format: (action) => {
        if (!editor) return;
        runFormatCommand(editor, action);
        emitHistoryState(editor, onHistoryStateChange);
      },
    }),
    [editor, onHistoryStateChange],
  );

  const style = { '--draft-font-size': `${displaySize}px` } as CSSProperties;

  return (
    <div className={styles.shell}>
      <div className={styles.editorRoot} style={style}>
        <EditorContent editor={editor} />
      </div>
      {hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  );
});

function runFormatCommand(editor: Editor, action: FormatAction) {
  if (action === 'undo') {
    editor.chain().focus().undo().run();
    return;
  }
  if (action === 'redo') {
    editor.chain().focus().redo().run();
    return;
  }
  if (action === 'bold') {
    editor.chain().focus().toggleBold().run();
    return;
  }
  if (action === 'italic') {
    editor.chain().focus().toggleItalic().run();
    return;
  }
  if (action === 'heading') {
    editor.chain().focus().toggleHeading({ level: 2 }).run();
    return;
  }
  if (action === 'quote') {
    editor.chain().focus().toggleBlockquote().run();
    return;
  }
  if (action === 'list') {
    editor.chain().focus().toggleBulletList().run();
    return;
  }
  if (action === 'link') {
    if (editor.state.selection.empty) {
      editor.chain().focus().insertContent('<a href="canon://reference">ссылка</a>').run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: 'canon://reference' }).run();
  }
}

function selectionText(editor: Editor) {
  const { from, to } = editor.state.selection;
  if (from === to) return '';
  return editor.state.doc.textBetween(from, to, ' ').trim();
}

function emitHistoryState(editor: Editor, onHistoryStateChange: (state: RichDraftEditorHistoryState) => void) {
  onHistoryStateChange({
    canRedo: editor.can().redo(),
    canUndo: editor.can().undo(),
  });
}
