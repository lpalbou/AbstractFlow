import type { ReactNode } from 'react';
import { JsonSchemaEditor } from './JsonSchemaEditor';

export interface JsonSchemaNodeEditorProps {
  nodeId: string;
  schema: unknown;
  onChange: (nextSchema: Record<string, any>) => void;
  label?: string;
  hint?: ReactNode;
}

export function JsonSchemaNodeEditor({ nodeId, schema, onChange, label = 'JSON Schema', hint }: JsonSchemaNodeEditorProps) {
  return (
    <JsonSchemaEditor
      nodeId={nodeId}
      schema={schema}
      onChange={onChange}
      label={label}
      hint={
        hint ?? (
        <>
          Use this node to define a structured output schema for LLM/Agent. Advanced JSON Schema features (e.g.{' '}
          <code>$ref</code>/<code>$defs</code>) may depend on the selected provider.
        </>
        )
      }
    />
  );
}
