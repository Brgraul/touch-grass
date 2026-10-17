import type { ReactNode } from 'react'
import type { AgentTurn, StoredBlock } from '../agent-chat.schema'

export function TurnView({ turn }: { turn: AgentTurn }) {
  return (
    <div className="space-y-3" data-testid="agent-turn">
      {turn.blocks.map((block, index) => <BlockView key={index} block={block} />)}
    </div>
  )
}

function BlockView({ block }: { block: StoredBlock }) {
  switch (block.kind) {
    case 'text':
      return <p className="whitespace-pre-wrap text-sm leading-7">{block.text}</p>
    case 'tool_call':
      return <ToolCall tool={block.tool} input={block.input} />
    case 'tool_result':
      return <ToolResult output={block.output} isError={block.isError} />
    case 'structured_output':
      return <StructuredOutput schema={block.schema} value={block.value} />
    case 'unsupported':
      return <Unsupported storedKind={block.storedKind} storedVersion={block.storedVersion} />
    default: {
      const unhandled: never = block

      return unhandled
    }
  }
}

function Json({ value }: { value: unknown }) {
  return <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words">{JSON.stringify(value, null, 2)}</pre>
}

function BlockCard({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border bg-muted/50 p-3 text-xs">{children}</div>
}

function ToolCall({ tool, input }: { tool: string; input: unknown }) {
  return (
    <details open className="rounded-lg border bg-muted/50 p-3 text-xs">
      <summary className="cursor-pointer font-medium">Tool call · {tool}</summary>
      <Json value={input} />
    </details>
  )
}

function ToolResult({ output, isError }: { output: unknown; isError: boolean }) {
  return (
    <BlockCard>
      <p className={isError ? 'font-medium text-destructive' : 'font-medium'}>{isError ? 'Tool error' : 'Tool result'}</p>
      <Json value={output} />
    </BlockCard>
  )
}

function StructuredOutput({ schema, value }: { schema: string; value: unknown }) {
  return (
    <BlockCard>
      <p className="font-medium">Structured output · {schema}</p>
      <Json value={value} />
    </BlockCard>
  )
}

function Unsupported({ storedKind, storedVersion }: { storedKind: string; storedVersion: number }) {
  return <p className="text-sm text-muted-foreground">Unsupported saved content ({storedKind}, version {storedVersion}).</p>
}
