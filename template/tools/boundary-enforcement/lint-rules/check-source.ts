import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { compositionRoot, ignoredDirectories, isPure, pureAgentExports, roleOf, unownedModule, type Diagnostic } from '../policy.ts';
import { brandsDeclaredIn, namesBrand } from './brands.ts';
import { createEnvironmentTypes } from './environment.ts';
import { createResolver, leafOf, moduleOf, moduleSpecifierOf, propertyKey, unwrap } from './resolve.ts';

export const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));

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

const transportNames = new Set(['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport', 'navigator.sendBeacon']);

const clockOrigins = new Set(['global:Date.now', 'global:Math.random']);

const providers = new Set(['OpenAI', 'OpenAIProvider', 'OpenAIChatCompletionsModel', 'OpenAIResponsesModel', 'OpenAIResponsesWSModel']);

// Calls that install a model provider or its credentials for every agent, which only the model adapter may do.
const providerConfiguration = new Set(['setDefaultOpenAIClient', 'setDefaultOpenAIKey', 'setOpenAIAPI', 'setDefaultModelProvider']);

const modelAdapter = 'src/platform/model.server.ts';

const queryPackages = new Set(['@tanstack/react-query', '@tanstack/query-core']);

// The ways to run a mutation outside the shared useMutation wrapper.
const mutationMechanisms = new Set(['useMutation', 'MutationObserver']);

const serverFunctionFactories = new Set(['createServerFn', 'createMiddleware', 'createServerOnlyFn']);

const isMutationMechanism = (origin: string) => queryPackages.has(moduleOf(origin) ?? '') && mutationMechanisms.has(leafOf(origin));

const isProjectModule = (specifier: string) => /^(?:\.|#\/|@\/)/.test(specifier);

let projectBrandCache: ReadonlySet<string> | undefined;

// Brand names declared anywhere under the project's src, read once per process. Repeats until no file adds an alias of a brand another file declares.
export function projectBrands(): ReadonlySet<string> {
  if (projectBrandCache) return projectBrandCache;
  const files = sourceFiles(join(projectRoot, 'src')).flatMap(path => /\.tsx?$/.test(path) ? [[path, readFileSync(path, 'utf8')] as const] : []);
  const brands = new Set<string>();
  let size = -1;

  while (brands.size !== size) {
    size = brands.size;

    for (const [path, source] of files) for (const brand of brandsDeclaredIn(path, source, brands)) brands.add(brand);
  }

  projectBrandCache = brands;

  return brands;
}

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

export function checkSource(path: string, source: string, knownBrands: ReadonlySet<string> = projectBrands()): Diagnostic[] {
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
  const brands = new Set([...knownBrands, ...brandsDeclaredIn(path, source, knownBrands)]);
  const brandPattern = brands.size === 0 ? undefined : new RegExp(`(?<![\\w$])(?:${[...brands].map(brand => brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\w$])`);
  const foldedColors: ts.Node[] = [];

  const report = (rule: string, node: ts.Node, message: string) => {
    diagnostics.push({ rule, path, message, line: parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1 });
  };

  if (path.startsWith('src/') && role === undefined && !new RegExp(unownedModule).test(path)) report('file-role', parsed, 'This module matches no role. Rename it to a role suffix or move it into a role directory');

  // Whether an expression only names an imported binding, so exporting it re-exports another module.
  const isImportedBinding = (node: ts.Node) => {
    const target = unwrap(node);

    return (ts.isIdentifier(target) || ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) && resolver.originOf(target)?.startsWith('import:') === true;
  };

  const mentionsBrand = (node: ts.Node) => brandPattern?.test(node.getText(parsed)) === true;

  const brandOwner = /^src\/platform\/|\.(?:schema|repo\.server)\.ts$/.test(path);

  // `field` is undefined when the whole environment is copied or enumerated.
  const environmentField = (node: ts.Node, field: string | undefined) => {
    if (!path.startsWith('src/') || /\.(?:test|spec)\.tsx?$/.test(path) || path === 'src/platform/env.server.ts') return;

    if (path === compositionRoot && field === 'AGENT_CHAT_WORKFLOW') return;
    report('env-access', node, field === undefined ? 'The environment is copied or enumerated outside its owner' : `Environment field ${field} is read outside its owner`);
  };

  // Pure modules take definitions and error classes from the agent SDK as values, and everything else as types, so they can never run an agent.
  const checkAgentImport = (node: ts.Node, name: string) => {
    if (!pure || !name.startsWith('@openai/') || ts.isImportTypeNode(node)) return;
    const clause = ts.isImportDeclaration(node) ? node.importClause : undefined;

    if (clause?.isTypeOnly) return;
    const bindings = clause?.namedBindings;
    const named = clause !== undefined && clause.name === undefined && bindings !== undefined && ts.isNamedImports(bindings);
    const values = named ? bindings.elements.flatMap(element => element.isTypeOnly ? [] : [(element.propertyName ?? element.name).text]) : undefined;

    if (values === undefined) report('pure-module', node, `Pure module imports ${name} as a whole module. Import ${pureAgentExports.slice(0, 3).join(', ')} or types by name`);
    else for (const value of values.filter(value => !pureAgentExports.includes(value))) report('pure-module', node, `Pure module imports ${value} from ${name}, which runs agents. Import it as a type or move the call to a service`);
  };

  const checkModule = (node: ts.Node, name: string) => {
    if (pure && /^(?:node:|cloudflare:)|\.server(?:\.ts)?$/.test(name)) report('pure-module', node, `Pure module imports runtime ${name}`);

    checkAgentImport(node, name);

    if ((name === 'openai' || name.startsWith('openai/')) && path !== modelAdapter) report('model-adapter', node, 'Only the model adapter imports openai');
  };

  // `origin` is where the referenced value comes from after following aliases, so `const f = fetch` and `{ random } = Math` still resolve.
  const checkReference = (node: ts.Node, origin: string) => {
    const globalName = origin.startsWith('global:') ? origin.slice('global:'.length) : undefined;

    if (view && globalName !== undefined && transportNames.has(globalName)) report('client-data-path', node, 'Views use feature queries rather than direct transport');

    if (isMutationMechanism(origin) && path !== 'src/platform/mutations.ts') report('client-data-path', node, `Only platform/mutations.ts uses ${leafOf(origin)}`);

    if (role !== 'functions' && path.startsWith('src/') && moduleOf(origin)?.startsWith('@tanstack/') && serverFunctionFactories.has(leafOf(origin))) report('server-function', node, `Only functions modules call ${leafOf(origin)}`);

    if (pure && globalName !== undefined && (clockOrigins.has(origin) || pureGlobals.has(globalName))) report('pure-module', node, `Pure module accesses ${globalName}`);

    if (path !== modelAdapter && moduleOf(origin)?.startsWith('@openai/') && providerConfiguration.has(leafOf(origin))) report('model-adapter', node, 'Only the model adapter configures the model provider');
  };

  const checkCall = (node: ts.CallExpression) => {
    const callee = node.expression;
    const origin = resolver.originOf(callee);
    const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';

    if (pure && origin === 'global:Date') report('pure-module', node, 'Pure module reads the current date');

    if (view && ts.isPropertyAccessExpression(callee) && origin === undefined && transportNames.has(name)) report('client-data-path', node, 'Views use feature queries rather than direct transport');

    if (!(origin !== undefined && isMutationMechanism(origin)) && (origin === undefined ? name : leafOf(origin)) === 'useMutation' && path !== 'src/platform/mutations.ts') report('client-data-path', node, 'Only platform/mutations.ts calls useMutation');

    if (!brandOwner && node.typeArguments?.some(type => namesBrand(type, brands)) && callsProjectCode(callee)) report('brand-cast', node, 'Obtain branded values from their owning parser, not a generic helper');
  };

  // A callee declared in this file or imported from this project, which can hide an assertion such as `cast<UserId>(value)`.
  const callsProjectCode = (callee: ts.Expression) => {
    const origin = resolver.originOf(callee);
    const module = origin === undefined ? undefined : moduleOf(origin);

    return origin === undefined || module !== undefined && isProjectModule(module);
  };

  // `auth.admin` and `signInWithPassword`, however the client is reached: `auth['signInWithPassword']`, `const a = client.auth; a.admin`, `const { admin } = client.auth`.
  const checkTestSignIn = (node: ts.Node) => {
    if (path === 'tests/fixtures/test-users.ts') return;
    const members = resolver.memberPath(node);

    if (members.at(-1) === 'signInWithPassword') report('test-sign-in', node, 'Only the test-user fixture performs password sign-in');

    if (members.at(-1) === 'admin' && members.at(-2) === 'auth') report('test-sign-in', node, 'Only the test-user fixture accesses auth.admin');
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
      for (const element of node.name.elements) environmentField(element, element.dotDotDotToken ? undefined : propertyKey(element.propertyName ?? element.name) ?? element.getText(parsed));
    }

    if ((ts.isSpreadAssignment(node) || ts.isSpreadElement(node) || ts.isForInStatement(node)) && environment.isEnvironment(node.expression)) environmentField(node, undefined);

    // A global such as `Object.entries`, `JSON.stringify` or `structuredClone` reads every field of the environment passed to it.
    if (ts.isCallExpression(node) && resolver.originOf(node.expression)?.startsWith('global:') && node.arguments.some(argument => environment.isEnvironment(argument))) environmentField(node, undefined);
  };

  const checkReexport = (node: ts.Node) => {
    const exported = ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
    const importedExport = ts.isExportDeclaration(node) && node.exportClause !== undefined && ts.isNamedExports(node.exportClause) && node.exportClause.elements.some(element => isImportedBinding(element.propertyName ?? element.name));
    const exportedImport = ts.isExportAssignment(node) && isImportedBinding(node.expression) || ts.isVariableStatement(node) && exported && node.declarationList.declarations.some(declaration => declaration.initializer !== undefined && isImportedBinding(declaration.initializer));

    if (ts.isExportDeclaration(node) && node.moduleSpecifier || importedExport || exportedImport) report('no-reexport', node, 'Re-export statements create forbidden barrel modules');
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

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isBindingElement(node)) checkTestSignIn(node);

    checkEnvironment(node);

    if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && !brandOwner && mentionsBrand(node.type)) report('brand-cast', node, 'Obtain branded values from their owning parser');

    if (path.startsWith('src/') && path !== compositionRoot) checkReexport(node);

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

export function checkSources(root = projectRoot): Diagnostic[] {
  return sourceFiles(root).flatMap(path => {
    const local = relative(root, path).split('\\').join('/');

    if (local.startsWith('tools/') || local === 'src/routeTree.gen.ts' || local.endsWith('.d.ts')) return [];

    return checkSource(local, readFileSync(path, 'utf8'));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const diagnostics = checkSources();

  for (const diagnostic of diagnostics) process.stderr.write(`${diagnostic.path}:${diagnostic.line ?? 1} ${diagnostic.rule}: ${diagnostic.message}\n`);

  if (diagnostics.length > 0) process.exitCode = 1;
}
