import { useMemo, useRef, useState } from 'react'
import type { TableInfo } from '@sheetbase-labs/sheetbase-shared'
import { quoteIdent } from '../lib/sql-compile'
import { viewToIbis, viewToPandas, viewToSql, type ViewCodeInput } from '../lib/view-code'

export interface SqlPaneProps {
  enabled: boolean
  dialect?: string
  tables: readonly TableInfo[]
  activeTableId: string
  /** The current view, for "this view as code". */
  code: ViewCodeInput
  onRun(sql: string): Promise<void>
  onOpenTable(id: string): void
  /** Controlled editor text (kept by the host across tables). */
  draft?: string
  onDraft?(sql: string): void
}

type CodeTab = 'sql' | 'ibis' | 'pandas'

function starterSql(table: TableInfo | undefined): string {
  if (!table) return 'SELECT 1'
  const columns = table.fields.slice(0, 6).map((field) => quoteIdent(field.id)).join(', ')
  return `SELECT ${columns || '*'}\nFROM ${quoteIdent(table.id)}\nLIMIT 1000`
}

export function SqlPane(props: SqlPaneProps) {
  const active = props.tables.find((table) => table.id === props.activeTableId)
  const [ownSql, setOwnSql] = useState(() => props.draft ?? starterSql(active))
  const sql = props.draft ?? ownSql
  const setSql = (next: string | ((current: string) => string)) => {
    const value = typeof next === 'function' ? next(sql) : next
    setOwnSql(value)
    props.onDraft?.(value)
  }
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [codeTab, setCodeTab] = useState<CodeTab>('sql')
  const [copied, setCopied] = useState(false)
  const editor = useRef<HTMLTextAreaElement>(null)
  const code = useMemo(() => {
    try {
      return codeTab === 'sql' ? viewToSql(props.code) : codeTab === 'ibis' ? viewToIbis(props.code) : viewToPandas(props.code)
    } catch (caught) {
      return `-- ${caught instanceof Error ? caught.message : String(caught)}`
    }
  }, [codeTab, props.code])
  const history = props.tables.filter((table) => table.kind === 'query')

  async function run() {
    if (running || !props.enabled) return
    setRunning(true)
    setError(null)
    try {
      await props.onRun(sql)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setRunning(false)
    }
  }

  function insert(text: string) {
    const element = editor.current
    if (!element) { setSql((current) => `${current}${text}`); return }
    const start = element.selectionStart
    const end = element.selectionEnd
    const next = `${sql.slice(0, start)}${text}${sql.slice(end)}`
    setSql(next)
    requestAnimationFrame(() => {
      element.focus()
      element.setSelectionRange(start + text.length, start + text.length)
    })
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch { /* Clipboard unavailable (insecure context); the text stays selectable. */ }
  }

  return (
    <div className="sbs-sql">
      <section className="sbs-sql-editor" aria-label="SQL">
        <div className="sbs-section-head">
          <span>Query{props.dialect ? <small> · {props.dialect}</small> : null}</span>
          <span className="sbs-section-actions">
            <button type="button" className="sb-btn subtle" onClick={() => setSql(starterSql(active))}>Reset</button>
            <button type="button" className="sb-btn primary" onClick={run} disabled={!props.enabled || running} title="Run (⌘/Ctrl + Enter)">{running ? 'Running…' : 'Run'}</button>
          </span>
        </div>
        {props.enabled ? (
          <>
            <textarea
              ref={editor}
              className="sbs-code sbs-code--edit"
              spellCheck={false}
              aria-label="SQL query"
              value={sql}
              onChange={(event) => setSql(event.target.value)}
              onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void run() } }}
            />
            <p className="sbs-help">Read-only: one <code>SELECT</code> or <code>WITH</code> query. The result opens as a new table you can explore, filter and chart.</p>
          </>
        ) : (
          <p className="sbs-note">This source doesn’t accept SQL. Use the filter builder, or copy the code below to run elsewhere.</p>
        )}
        {error && <div className="sbs-note sbs-note--error" role="alert">{error}</div>}
      </section>
      {props.enabled && (
        <section className="sbs-sql-schema" aria-label="Tables">
          <div className="sbs-section-head"><span>Tables</span></div>
          <ul className="sbs-schema">
            {props.tables.map((table) => (
              <li key={table.id}>
                <button type="button" className="sbs-schema-table" onClick={() => insert(quoteIdent(table.id))} title="Insert the table name">{table.id}</button>
                <span className="sbs-schema-fields">
                  {table.fields.map((field) => (
                    <button key={field.id} type="button" className="sbs-schema-field" onClick={() => insert(quoteIdent(field.id))} title={`${field.dataType} — insert`}>{field.id}</button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          {history.length > 0 && (
            <>
              <div className="sbs-section-head"><span>Query results</span></div>
              <ul className="sbs-history">
                {history.map((table) => (
                  <li key={table.id}>
                    <button type="button" className={`sb-btn${table.id === props.activeTableId ? ' is-on' : ''}`} onClick={() => props.onOpenTable(table.id)}>{table.label}</button>
                    <span className="sb-muted">{table.rowCount?.toLocaleString() ?? '?'} rows</span>
                    {table.sql && <button type="button" className="sb-btn subtle" onClick={() => setSql(table.sql ?? '')}>Edit</button>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      <section className="sbs-sql-code" aria-label="This view as code">
        <div className="sbs-section-head">
          <span>This view as code</span>
          <span className="sbs-section-actions">
            <span className="sb-segmented" role="tablist" aria-label="Language">
              {(['sql', 'ibis', 'pandas'] as const).map((tab) => (
                <button key={tab} type="button" role="tab" aria-selected={codeTab === tab} className={codeTab === tab ? 'active' : ''} onClick={() => setCodeTab(tab)}>{tab === 'sql' ? 'SQL' : tab === 'ibis' ? 'Ibis' : 'pandas'}</button>
              ))}
            </span>
            <button type="button" className="sb-btn" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
            {codeTab === 'sql' && props.enabled && <button type="button" className="sb-btn" onClick={() => setSql(code)}>Edit as query</button>}
          </span>
        </div>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable code block must be keyboard-focusable to scroll (WCAG 2.1.1) */}
        <pre className="sbs-code" tabIndex={0}>{code}</pre>
      </section>
    </div>
  )
}
