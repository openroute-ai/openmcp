'use client'

import { ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface McpToolDetailContentProps {
  description: string
  inputSchema: unknown
  outputSchema: unknown
  isDeprecated: boolean
}

export function McpToolDetailContent({
  description,
  inputSchema,
  outputSchema,
  isDeprecated,
}: McpToolDetailContentProps) {
  const [showInput, setShowInput] = useState(true)
  const [showOutput, setShowOutput] = useState(true)

  return (
    <>
      {isDeprecated && (
        <div className='mb-6 rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 text-amber-700 dark:text-amber-400'>
          该工具已标记为弃用，可能在未来版本中移除。
        </div>
      )}
      <section className='mb-8 rounded-lg border border-border bg-card p-6 shadow-sm'>
        <h2 className='mb-4 text-lg font-semibold'>描述</h2>
        <div className='prose dark:prose-invert prose-p:my-4 max-w-none'>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{description || '暂无描述'}</ReactMarkdown>
        </div>
      </section>

      {inputSchema != null && Object.keys(inputSchema as object).length > 0 && (
        <section className='mb-8 rounded-lg border border-border bg-card shadow-sm'>
          <button
            type='button'
            onClick={() => setShowInput(!showInput)}
            className='flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/50'
            aria-expanded={showInput}
          >
            <h2 className='text-lg font-semibold'>输入参数 (input_schema)</h2>
            {showInput ? (
              <ChevronUp className='h-5 w-5 text-muted-foreground' />
            ) : (
              <ChevronDown className='h-5 w-5 text-muted-foreground' />
            )}
          </button>
          {showInput && (
            <div className='border-t border-border p-4'>
              <pre className='overflow-x-auto rounded bg-muted p-4 text-sm'>
                {JSON.stringify(inputSchema, null, 2)}
              </pre>
            </div>
          )}
        </section>
      )}

      {outputSchema != null && Object.keys(outputSchema as object).length > 0 && (
        <section className='mb-8 rounded-lg border border-border bg-card shadow-sm'>
          <button
            type='button'
            onClick={() => setShowOutput(!showOutput)}
            className='flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/50'
            aria-expanded={showOutput}
          >
            <h2 className='text-lg font-semibold'>输出 (output_schema)</h2>
            {showOutput ? (
              <ChevronUp className='h-5 w-5 text-muted-foreground' />
            ) : (
              <ChevronDown className='h-5 w-5 text-muted-foreground' />
            )}
          </button>
          {showOutput && (
            <div className='border-t border-border p-4'>
              <pre className='overflow-x-auto rounded bg-muted p-4 text-sm'>
                {JSON.stringify(outputSchema, null, 2)}
              </pre>
            </div>
          )}
        </section>
      )}
    </>
  )
}
