import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { brandNames, compositionRoot, ignoredDirectories, isPure, roleOf, type Diagnostic } from '../policy.ts';
import { createEnvironmentTypes } from './environment.ts';
import { createResolver, leafOf, moduleOf, moduleSpecifierOf, propertyKey } from './resolve.ts';

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

const transportNames = new Set(['fetch', 'XMLHttpRequest', 'WebSocket']);

const clockOrigins = new Set(['global:Date.now', 'global:Math.random']);

const providers = new Set(['OpenAI', 'OpenAIProvider', 'OpenAIChatCompletionsModel', 'OpenAIResponsesModel', 'OpenAIResponsesWSModel']);

// Calls that install a model provider or its credentials for every agent, which only the model adapter may do.
const providerConfiguration = new Set(['setDefaultOpenAIClient', 'setDefaultOpenAIKey', 'setOpenAIAPI', 'setDefaultModelProvider']);

const modelAdapter = 'src/platform/model.server.ts';

const reactQueryMutation = 'import:@tanstack/react-query#useMutation';

const approvedComment = /^(?:\/\/\/\s*<reference\b|\/[/*]\**\s*(?:SAFETY:\s*\S|WHY:\s*\S|@ts-expect-error\b:?\s*\S|oxlint-disable[\w-]*\s[^\n]*\s--\s+\S))/;

const commentMessage = 'Delete this comment, or encode what it says as a type, test or lint rule. Prefix SAFETY: on a cast, or WHY: for a constraint from an SDK, PostgreSQL or an external API';

const commentText = /\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g;

function unapprovedComments(parsed: ts.SourceFile): Set<number> {
  const positions = new Set<number>();

  const visit = (node: ts.Node) => {
    if (ts.isJSDoc(node)) return;

    if (node.kind <= ts.SyntaxKind.LastToken) {
      for (const match of parsed.text.slice(node.pos, node.getStart(parsed)).matchAll(commentText)) {
        if (!approvedComment.test(match[0])) positions.add(node.pos + match.index);
      }

      return;
    }

    for (const child of node.getChildren(parsed)) visit(child);
  };

  visit(parsed);

  return positions;
}

export function checkSource(path: string, source: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const kind = path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const syntax = ts.transpileModule(source, { fileName: path, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).diagnostics ?? [];

  for (const diagnostic of syntax) {
    if (diagnostic.category === ts.DiagnosticCategory.Error) diagnostics.push({ rule: 'syntax-error', path, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ') });
  }

  if (diagnostics.length > 0) return diagnostics;
  const resolver = createResolver(path, source, kind);
  const environment = createEnvironmentTypes(resolver);
  const parsed = resolver.parsed;
  const role = roleOf(path);
  const pure = isPure(path);
  const view = ['route', 'ui', 'layouts', 'components'].some(candidate => candidate === role);
  const importedNames = new Set<string>();
  const foldedColors: ts.Node[] = [];

  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;

    if (statement.importClause.name) importedNames.add(statement.importClause.name.text);
    const bindings = statement.importClause.namedBindings;

    if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) importedNames.add(element.name.text);
  }

  const report = (rule: string, node: ts.Node, message: string) => {
    diagnostics.push({ rule, path, message, line: parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1 });
  };

  const environmentField = (node: ts.Node, field: string) => {
    if (!path.startsWith('src/') || /\.(?:test|spec)\.tsx?$/.test(path) || path === 'src/platform/env.server.ts') return;

    if (path === compositionRoot && field === 'AGENT_CHAT_WORKFLOW') return;
    report('env-access', node, `Environment field ${field} is read outside its owner`);
  };

  const checkModule = (node: ts.Node, name: string) => {
    if (pure && /^(?:node:|cloudflare:)|\.server(?:\.ts)?$/.test(name)) report('pure-module', node, `Pure module imports runtime ${name}`);

    if ((name === 'openai' || name.startsWith('openai/')) && path !== modelAdapter) report('model-adapter', node, 'Only the model adapter imports openai');
  };

  // `origin` is where the referenced value comes from after following aliases, so `const f = fetch` and `{ random } = Math` still resolve.
  const checkReference = (node: ts.Node, origin: string) => {
    const globalName = origin.startsWith('global:') ? origin.slice('global:'.length) : undefined;

    if (view && globalName !== undefined && transportNames.has(globalName)) report('client-data-path', node, 'Views use feature queries rather than direct transport');

    if (origin === reactQueryMutation && path !== 'src/platform/mutations.ts') report('client-data-path', node, 'Only platform/mutations.ts calls useMutation');

    if (pure && globalName !== undefined && (clockOrigins.has(origin) || pureGlobals.has(globalName))) report('pure-module', node, `Pure module accesses ${globalName}`);

    if (path !== modelAdapter && moduleOf(origin)?.startsWith('@openai/') && providerConfiguration.has(leafOf(origin))) report('model-adapter', node, 'Only the model adapter configures the model provider');
  };

  const checkCall = (node: ts.CallExpression) => {
    const callee = node.expression;
    const origin = resolver.originOf(callee);
    const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';

    if (pure && origin === 'global:Date') report('pure-module', node, 'Pure module reads the current date');

    if (view && ts.isPropertyAccessExpression(callee) && origin === undefined && transportNames.has(name)) report('client-data-path', node, 'Views use feature queries rather than direct transport');

    if (origin !== reactQueryMutation && (origin === undefined ? name : leafOf(origin)) === 'useMutation' && path !== 'src/platform/mutations.ts') report('client-data-path', node, 'Only platform/mutations.ts calls useMutation');

    if (name === 'signInWithPassword' && path !== 'tests/fixtures/test-users.ts') report('test-sign-in', node, 'Only the test-user fixture performs password sign-in');
  };

  const checkConstruction = (node: ts.NewExpression) => {
    const origin = resolver.originOf(node.expression);

    if (pure && origin === 'global:Date' && (node.arguments?.length ?? 0) === 0) report('pure-module', node, 'Pure module reads the current date');

    if (origin !== undefined && providers.has(leafOf(origin)) && path !== modelAdapter) report('model-adapter', node, 'Only the model adapter constructs a provider');
  };

  const checkEnvironment = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && environment.isEnvironment(node.expression)) environmentField(node, node.name.text);

    if (ts.isElementAccessExpression(node) && environment.isEnvironment(node.expression)) environmentField(node, node.argumentExpression.getText(parsed).replace(/['"]/g, ''));

    if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && ts.isObjectBindingPattern(node.name) && environment.readsEnvironment(node)) {
      for (const element of node.name.elements) environmentField(element, propertyKey(element.propertyName ?? element.name) ?? element.getText(parsed));
    }
  };

  const checkStyling = (node: ts.Node) => {
    const concatenation = ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken || ts.isTemplateExpression(node) || ts.isCallExpression(node);

    if (concatenation && !foldedColors.some(root => root.pos <= node.pos && node.end <= root.end) && resolver.stringValues(node)?.some(hasRawColor)) {
      foldedColors.push(node);
      report('styling', node, 'Use theme-token colors instead of raw colors');
    }

    const classText = ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) ? node.text : undefined;

    if (classText !== undefined && hasRawColor(classText) && !foldedColors.some(root => root.pos <= node.pos && node.end <= root.end)) report('styling', node, 'Use theme-token colors instead of raw colors');

    if (ts.isJsxAttribute(node) && node.name.getText(parsed) === 'style' && node.initializer) {
      const value = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer;

      if (value && (ts.isStringLiteralLike(value) || ts.isObjectLiteralExpression(value) && value.properties.some(property => ts.isPropertyAssignment(property) && (ts.isStringLiteralLike(property.initializer) || ts.isNumericLiteral(property.initializer))))) report('styling', node, 'Inline style values must be computed at runtime');
    }
  };

  const visit = (node: ts.Node) => {
    const name = moduleSpecifierOf(node);

    if (name !== undefined) checkModule(node, name);

    if (ts.isIdentifier(node) && resolver.isReference(node) || ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const origin = resolver.originOf(node);

      if (origin !== undefined) checkReference(node, origin);
    }

    if (ts.isCallExpression(node)) checkCall(node);

    if (ts.isNewExpression(node)) checkConstruction(node);

    if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node)) && propertyKey(node.name) === 'queryFn' && role !== 'queries' && path.startsWith('src/')) report('client-data-path', node, 'queryFn belongs in a queries module');

    if (ts.isPropertyAccessExpression(node) && node.name.text === 'admin' && /(?:^|\.)auth$/.test(node.expression.getText(parsed)) && path !== 'tests/fixtures/test-users.ts') report('test-sign-in', node, 'Only the test-user fixture accesses auth.admin');

    checkEnvironment(node);

    if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && !/^src\/platform\/|\.(?:schema|repo\.server)\.ts$/.test(path)) {
      if (brandNames.some(brand => new RegExp(`\\b${brand}\\b`).test(node.type.getText(parsed)))) report('brand-cast', node, 'Obtain branded values from their owning parser');
    }

    if (ts.isExportDeclaration(node) && path.startsWith('src/') && path !== compositionRoot) {
      const importedExport = node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.some(element => importedNames.has((element.propertyName ?? element.name).text));

      if (node.moduleSpecifier || importedExport) report('no-reexport', node, 'Re-export statements create forbidden barrel modules');
    }

    if (view) checkStyling(node);

    ts.forEachChild(node, visit);
  };

  visit(parsed);

  if (path.startsWith('src/') && path !== 'src/routeTree.gen.ts' && path !== 'src/platform/database.types.ts') {
    for (const position of unapprovedComments(parsed)) {
      diagnostics.push({ rule: 'comment-marker', path, line: parsed.getLineAndCharacterOfPosition(position).line + 1, message: commentMessage });
    }
  }

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
