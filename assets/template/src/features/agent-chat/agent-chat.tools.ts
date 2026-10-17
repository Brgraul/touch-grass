import { tool } from '@openai/agents';
import { z } from 'zod';
import type { JsonValue } from '@/platform/ids';

export function evaluate(expression: string): number {
  if (expression.length > 4_096) throw new Error('Expression exceeds 4096 characters');
  const tokens = expression.match(/\d+(?:\.\d*)?|\.\d+|[()+\-*/]|\s+|./gu)?.filter((token) => !/^\s+$/u.test(token)) ?? [];
  let index = 0;
  let depth = 0;

  function primary(): number {
    depth += 1;

    if (depth > 64) throw new Error('Expression is nested too deeply');
    const token = tokens[index++];
    let value: number;

    if (token === '+' || token === '-') value = (token === '-' ? -1 : 1) * primary();
    else if (token === '(') {
      value = sum();

      if (tokens[index++] !== ')') throw new Error('Expected closing parenthesis');
    } else {
      if (!token || !/^(?:\d+(?:\.\d*)?|\.\d+)$/u.test(token)) throw new Error('Expected a decimal number');
      value = Number(token);
    }

    depth -= 1;

    return value;
  }

  function product(): number {
    let value = primary();

    while (tokens[index] === '*' || tokens[index] === '/') {
      const operation = tokens[index++];
      const right = primary();

      if (operation === '/' && right === 0) throw new Error('Division by zero');
      value = operation === '*' ? value * right : value / right;
    }

    return value;
  }

  function sum(): number {
    let value = product();

    while (tokens[index] === '+' || tokens[index] === '-') {
      const operation = tokens[index++];
      const right = product();
      value = operation === '+' ? value + right : value - right;
    }

    return value;
  }

  const result = sum();

  if (index !== tokens.length) throw new Error('Unexpected token');

  if (!Number.isFinite(result)) throw new Error('Result is not finite');

  return result;
}

export const TOOL_ERROR_OUTPUT = JSON.stringify({ error: 'The tool could not complete. Check its name and arguments and try again.' });

const MAX_TOOL_OUTPUT_BYTES = 16_384;

export function pureTool<Fields extends Record<string, z.ZodType>>(definition: {
  name: string;
  description: string;
  parameters: z.ZodObject<Fields>;
  run: (input: z.output<z.ZodObject<Fields>>) => JsonValue;
}) {
  return tool({
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    execute: (input) => {
      const output = JSON.stringify(definition.run(input));

      if (new TextEncoder().encode(output).byteLength > MAX_TOOL_OUTPUT_BYTES) throw new Error('Tool output exceeds 16 KB');

      return output;
    },
    errorFunction: () => TOOL_ERROR_OUTPUT,
  });
}

export const calculate = pureTool({
  name: 'calculate',
  description: 'Evaluate arithmetic with decimal numbers, parentheses, addition, subtraction, multiplication and division.',
  parameters: z.object({ expression: z.string() }).strict(),
  run: ({ expression }) => ({ value: evaluate(expression) }),
});

export const TOOLS = [calculate];
