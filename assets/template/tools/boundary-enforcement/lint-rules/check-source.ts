import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { brandNames, compositionRoot, ignoredDirectories, isPure, roleOf, type Diagnostic } from '../policy.ts';

const pureGlobals = new Set(['fetch', 'caches', 'XMLHttpRequest', 'WebSocket', 'navigator', 'localStorage', 'sessionStorage', 'process', 'globalThis', 'performance', 'setTimeout', 'setInterval', 'queueMicrotask', 'crypto']);

const paletteNames = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|mauve|olive|mist|taupe';

// Every Tailwind utility that takes a color: `border-t-`, `divide-`, `ring-offset-`, and the rest.
const colorUtilities = 'bg|text|border(?:-[xytrblse])?|divide|ring(?:-offset)?|inset-ring|outline|fill|stroke|decoration|shadow|inset-shadow|drop-shadow|text-shadow|from|via|to|accent|caret|placeholder';

// A palette shade, `white` or `black`, with or without an opacity suffix: `bg-zinc-900`, `text-white`, `bg-black/50`.
const rawColorClass = new RegExp(`^(?:${colorUtilities})-(?:(?:${paletteNames})-\\d{2,3}|white|black)(?:/.+)?$`);

const colorLiteral = String.raw`#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(`;

// An arbitrary value that carries a color anywhere inside: `bg-[#fff]`, `text-[rgb(0,0,0)]`, `shadow-[0_0_4px_#000]`, `[color:#fff]`.
const arbitraryColorClass = new RegExp(`^(?:(?:${colorUtilities})-)?\\[[^\\]]*(?:${colorLiteral})`, 'i');

const hex = /#[0-9a-f]{3}(?:[0-9a-f]{3})?(?:[0-9a-f]{2})?\b/i;

// Drops the variants (`hover:`, `dark:`, `data-[state=open]:`) and the important marker, leaving the utility.
function utilityOf(className: string): string {
  let depth = 0;
  let start = 0;

  for (const [index, character] of [...className].entries()) {
    if (character === '[') depth += 1;
    else if (character === ']') depth -= 1;
    else if (character === ':' && depth === 0) start = index + 1;
  }

  return className.slice(start).replace(/^!|!$/g, '');
}

function hasRawColor(text: string): boolean {
  if (hex.test(text)) return true;

  return text.split(/\s+/).some(className => {
    const utility = utilityOf(className);

    return rawColorClass.test(utility) || arbitraryColorClass.test(utility);
  });
}

export function checkSource(path: string, source: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const syntax = ts.transpileModule(source, { fileName: path, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).diagnostics ?? [];

  for (const diagnostic of syntax) {
    if (diagnostic.category === ts.DiagnosticCategory.Error) diagnostics.push({ rule: 'syntax-error', path, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ') });
  }

  if (diagnostics.length > 0) return diagnostics;
  const role = roleOf(path);
  const pure = isPure(path);
  const view = ['route', 'ui', 'layouts', 'components'].some(candidate => candidate === role);
  const importedNames = new Set<string>();

  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;

    if (statement.importClause.name) importedNames.add(statement.importClause.name.text);
    const bindings = statement.importClause.namedBindings;

    if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) importedNames.add(element.name.text);
  }

  const providers = new Set(['OpenAI', 'OpenAIProvider', 'OpenAIChatCompletionsModel']);

  const report = (rule: string, node: ts.Node, message: string) => {
    diagnostics.push({ rule, path, message, line: parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1 });
  };

  const isEnvironment = (node: ts.Node) => ts.isIdentifier(node) && node.text === 'env' || ts.isPropertyAccessExpression(node) && node.name.text === 'env';

  const environmentField = (node: ts.Node, field: string) => {
    if (!path.startsWith('src/') || /\.(?:test|spec)\.tsx?$/.test(path) || path === 'src/platform/env.server.ts') return;

    if (path === compositionRoot && field === 'AGENT_CHAT_WORKFLOW') return;
    report('env-access', node, `Environment field ${field} is read outside its owner`);
  };

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const name = node.moduleSpecifier.text;

      if (pure && /^(?:node:|cloudflare:)|\.server(?:\.ts)?$/.test(name)) report('pure-module', node, `Pure module imports runtime ${name}`);

      if (name === 'openai' || name.startsWith('openai/')) {
        if (path !== 'src/platform/model.server.ts') report('model-adapter', node, 'Only the model adapter imports openai');
      }

      if (node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
        for (const imported of node.importClause.namedBindings.elements) {
          if (providers.has((imported.propertyName ?? imported.name).text)) providers.add(imported.name.text);
        }
      }
    }

    if (pure && ts.isIdentifier(node) && pureGlobals.has(node.text)) {
      const propertyName = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;
      const declarationName = (ts.isPropertySignature(node.parent) || ts.isPropertyAssignment(node.parent)) && node.parent.name === node;

      if (!propertyName && !declarationName) report('pure-module', node, `Pure module accesses ${node.text}`);
    }

    if (pure && ts.isPropertyAccessExpression(node)) {
      if (node.expression.getText(parsed) === 'Date' && node.name.text === 'now' || node.expression.getText(parsed) === 'Math' && node.name.text === 'random') report('pure-module', node, `Pure module accesses ${node.getText(parsed)}`);
    }

    if (pure && ts.isNewExpression(node) && node.expression.getText(parsed) === 'Date' && (node.arguments?.length ?? 0) === 0) report('pure-module', node, 'Pure module reads the current date');

    if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : '';

      if (view && ['fetch', 'XMLHttpRequest', 'WebSocket'].includes(name)) report('client-data-path', node, 'Views use feature queries rather than direct transport');

      if (name === 'useMutation' && path !== 'src/platform/mutations.ts') report('client-data-path', node, 'Only platform/mutations.ts calls useMutation');

      if (name === 'signInWithPassword' && path !== 'tests/fixtures/test-users.ts') report('test-sign-in', node, 'Only the test-user fixture performs password sign-in');
    }

    if (view && ts.isNewExpression(node) && ['XMLHttpRequest', 'WebSocket'].includes(node.expression.getText(parsed))) report('client-data-path', node, 'Views cannot construct transports');

    if ((ts.isPropertyAssignment(node) || ts.isMethodDeclaration(node)) && node.name.getText(parsed).replace(/['"]/g, '') === 'queryFn' && role !== 'queries' && path.startsWith('src/')) report('client-data-path', node, 'queryFn belongs in a queries module');

    if (ts.isNewExpression(node) && providers.has(node.expression.getText(parsed)) && path !== 'src/platform/model.server.ts') report('model-adapter', node, 'Only the model adapter constructs a provider');

    if (ts.isPropertyAccessExpression(node)) {
      if (isEnvironment(node.expression)) environmentField(node, node.name.text);

      if (node.name.text === 'admin' && /(?:^|\.)auth$/.test(node.expression.getText(parsed)) && path !== 'tests/fixtures/test-users.ts') report('test-sign-in', node, 'Only the test-user fixture accesses auth.admin');
    }

    if (ts.isElementAccessExpression(node) && isEnvironment(node.expression)) environmentField(node, node.argumentExpression.getText(parsed).replace(/['"]/g, ''));

    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && isEnvironment(node.initializer)) {
      for (const element of node.name.elements) environmentField(element, (element.propertyName ?? element.name).getText(parsed));
    }

    if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && !/^src\/platform\/|\.(?:schema|repo\.server)\.ts$/.test(path)) {
      if (brandNames.some(brand => new RegExp(`\\b${brand}\\b`).test(node.type.getText(parsed)))) report('brand-cast', node, 'Obtain branded values from their owning parser');
    }

    if (ts.isExportDeclaration(node) && path.startsWith('src/') && path !== compositionRoot) {
      const importedExport = node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.some(element => importedNames.has((element.propertyName ?? element.name).text));

      if (node.moduleSpecifier || importedExport) report('no-reexport', node, 'Re-export statements create forbidden barrel modules');
    }

    const classText = ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) ? node.text : undefined;

    if (view && classText !== undefined && hasRawColor(classText)) report('styling', node, 'Use theme-token colors instead of raw colors');

    if (view && ts.isJsxAttribute(node) && node.name.getText(parsed) === 'style' && node.initializer) {
      const value = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer;

      if (value && (ts.isStringLiteralLike(value) || ts.isObjectLiteralExpression(value) && value.properties.some(property => ts.isPropertyAssignment(property) && (ts.isStringLiteralLike(property.initializer) || ts.isNumericLiteral(property.initializer))))) report('styling', node, 'Inline style values must be computed at runtime');
    }

    ts.forEachChild(node, visit);
  };

  visit(parsed);

  return diagnostics;
}

export function sourceFiles(root: string): string[] {
  const files: string[] = [];

  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (ignoredDirectories.includes(entry.name) || entry.name === '.agents' || entry.name === '.audit') continue;
      const path = join(directory, entry.name);

      if (entry.isDirectory()) walk(path);
      else if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) files.push(path);
    }
  };

  walk(root);

  return files;
}

export function checkSources(root: string): Diagnostic[] {
  return sourceFiles(root).flatMap(path => {
    const local = relative(root, path).split('\\').join('/');

    if (local.startsWith('tools/') || local === 'src/routeTree.gen.ts' || local.endsWith('.d.ts')) return [];

    return checkSource(local, readFileSync(path, 'utf8'));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const diagnostics = checkSources(process.cwd());

  for (const diagnostic of diagnostics) process.stderr.write(`${diagnostic.path}:${diagnostic.line ?? 1} ${diagnostic.rule}: ${diagnostic.message}\n`);

  if (diagnostics.length > 0) process.exitCode = 1;
}
