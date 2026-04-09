import { useRef, useEffect } from 'react'
import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  linkPlugin,
  linkDialogPlugin,
  tablePlugin,
  codeBlockPlugin,
  codeMirrorPlugin,
  markdownShortcutPlugin,
  type MDXEditorMethods
} from '@mdxeditor/editor'
import '@mdxeditor/editor/style.css'
import './MarkdownEditor.css'

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  minHeight?: number
  autoFocus?: boolean
}

export function MarkdownEditor({ value, onChange, placeholder, minHeight = 120, autoFocus }: MarkdownEditorProps) {
  const editorRef = useRef<MDXEditorMethods>(null)

  useEffect(() => {
    if (autoFocus && editorRef.current) {
      editorRef.current.focus()
    }
  }, [autoFocus])

  return (
    <div className="md-editor-wrap" style={{ minHeight }}>
      <MDXEditor
        ref={editorRef}
        markdown={value}
        onChange={onChange}
        placeholder={placeholder}
        contentEditableClassName="md-editor-content"
        plugins={[
          headingsPlugin(),
          listsPlugin(),
          quotePlugin(),
          thematicBreakPlugin(),
          linkPlugin(),
          linkDialogPlugin(),
          tablePlugin(),
          codeBlockPlugin({ defaultCodeBlockLanguage: '' }),
          codeMirrorPlugin({ codeBlockLanguages: { '': 'Plain text', js: 'JavaScript', ts: 'TypeScript', css: 'CSS', html: 'HTML', json: 'JSON', python: 'Python', bash: 'Bash' } }),
          markdownShortcutPlugin()
        ]}
      />
    </div>
  )
}

interface MarkdownRendererProps {
  content: string
  className?: string
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={`md-rendered ${className || ''}`}>
      <MDXEditor
        markdown={content}
        readOnly
        contentEditableClassName="md-editor-content"
        plugins={[
          headingsPlugin(),
          listsPlugin(),
          quotePlugin(),
          thematicBreakPlugin(),
          linkPlugin(),
          tablePlugin(),
          codeBlockPlugin({ defaultCodeBlockLanguage: '' }),
          codeMirrorPlugin({ codeBlockLanguages: { '': 'Plain text', js: 'JavaScript', ts: 'TypeScript', css: 'CSS' } }),
        ]}
      />
    </div>
  )
}
