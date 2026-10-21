import ts from 'typescript';

const globalObjects = new Set(['global:globalThis', 'global:window', 'global:self']);

const maxDepth = 8;

const maxValues = 64;

export type Origin = string;

export type Resolver = {
  parsed: ts.SourceFile;
  /** Where an expression comes from, as `global:Date.now` or `import:openai#OpenAI`, following aliases, destructuring and namespace members. */
  originOf: (node: ts.Node) => Origin | undefined;
  /** Every string an expression can evaluate to when all its parts are literals or constants. */
  stringValues: (node: ts.Node) => string[] | undefined;
  /** Whether an identifier reads a value, rather than naming a property, a declaration or a type. */
  isReference: (node: ts.Identifier) => boolean;
  symbolOf: (node: ts.Node) => ts.Symbol | undefined;
  /** The property names an expression or binding reaches through local aliases, rooted at the first name this file cannot follow: `const a = c.auth; a.admin` is `c.auth.admin`. */
  memberPath: (node: ts.Node) => string[];
};

export function unwrap(node: ts.Node): ts.Node {
  let current = node;

  while (ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isTypeAssertionExpression(current)) current = current.expression;

  return current;
}

export function leafOf(origin: Origin): string {
  return origin.slice(Math.max(origin.lastIndexOf('#'), origin.lastIndexOf('.'), origin.lastIndexOf(':')) + 1);
}

export function moduleOf(origin: Origin): string | undefined {
  return /^import:([^#]*)#/.exec(origin)?.[1];
}

export function moduleSpecifierOf(node: ts.Node): string | undefined {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) return node.moduleSpecifier.text;

  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteralLike(node.moduleReference.expression)) return node.moduleReference.expression.text;

  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) return node.argument.literal.text;
  const argument = ts.isCallExpression(node) ? node.arguments[0] : undefined;

  if (ts.isCallExpression(node) && argument && ts.isStringLiteralLike(argument) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) return argument.text;

  return undefined;
}

export function propertyKey(name: ts.PropertyName | ts.BindingName | ts.Expression): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;

  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text;

  return undefined;
}

function member(base: Origin | undefined, name: string): Origin | undefined {
  if (base === undefined) return undefined;

  if (globalObjects.has(base)) return `global:${name}`;

  if (base.startsWith('import:') && base.endsWith('#*')) return `${base.slice(0, -1)}${name}`;

  return `${base}.${name}`;
}

export function createResolver(path: string, source: string, kind: ts.ScriptKind): Resolver {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const options: ts.CompilerOptions = { noLib: true, noResolve: true, types: [], allowJs: true, target: ts.ScriptTarget.ESNext, jsx: ts.JsxEmit.ReactJSX };

  const host: ts.CompilerHost = {
    getSourceFile: name => name === path ? file : undefined,
    getDefaultLibFileName: () => 'lib.d.ts',
    writeFile: () => undefined,
    getCurrentDirectory: () => '',
    getCanonicalFileName: name => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: name => name === path,
    readFile: () => undefined,
  };

  const program = ts.createProgram({ rootNames: [path], options, host });
  const parsed = program.getSourceFile(path) ?? file;
  const checker = program.getTypeChecker();

  const symbolOf = (node: ts.Node) => {
    if (ts.isIdentifier(node) && ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node) return checker.getShorthandAssignmentValueSymbol(node.parent);

    if (ts.isIdentifier(node) && ts.isExportSpecifier(node.parent) && !node.parent.parent.parent.moduleSpecifier) return checker.getExportSpecifierLocalTargetSymbol(node.parent);

    return checker.getSymbolAtLocation(node);
  };

  const importOrigin = (declaration: ts.Declaration): Origin | undefined => {
    const clause = ts.findAncestor(declaration, ts.isImportDeclaration);
    const specifier = clause && ts.isStringLiteralLike(clause.moduleSpecifier) ? clause.moduleSpecifier.text : undefined;

    if (ts.isImportEqualsDeclaration(declaration)) {
      const required = moduleSpecifierOf(declaration);

      return required === undefined ? undefined : `import:${required}#*`;
    }

    if (specifier === undefined) return undefined;

    if (ts.isImportSpecifier(declaration)) return `import:${specifier}#${(declaration.propertyName ?? declaration.name).text}`;

    if (ts.isImportClause(declaration)) return `import:${specifier}#default`;

    if (ts.isNamespaceImport(declaration)) return `import:${specifier}#*`;

    return undefined;
  };

  // `const { a: { b } } = source` makes `b` the member `source.a.b`.
  const bindingOrigin = (element: ts.BindingElement, depth: number): Origin | undefined => {
    const keys: string[] = [];
    let current = element;

    for (;;) {
      const pattern = current.parent;
      const key = current.propertyName ?? current.name;
      const text = ts.isObjectBindingPattern(pattern) && !current.dotDotDotToken ? propertyKey(key) : undefined;

      if (text === undefined) return undefined;
      keys.unshift(text);
      const owner = pattern.parent;

      if (ts.isBindingElement(owner)) {
        current = owner;
        continue;
      }

      if (!ts.isVariableDeclaration(owner) || !owner.initializer) return undefined;
      let origin = originOf(owner.initializer, depth + 1);

      for (const name of keys) origin = member(origin, name);

      return origin;
    }
  };

  const identifierOrigin = (node: ts.Identifier, depth: number): Origin | undefined => {
    const symbol = symbolOf(node);
    const declaration = symbol?.declarations?.[0];

    if (!declaration) return `global:${node.text}`;
    const imported = importOrigin(declaration);

    if (imported !== undefined) return imported;

    if (ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name) && declaration.initializer) return originOf(declaration.initializer, depth + 1);

    if (ts.isBindingElement(declaration)) return bindingOrigin(declaration, depth);

    return undefined;
  };

  function originOf(node: ts.Node, depth = 0): Origin | undefined {
    if (depth > maxDepth) return undefined;
    const target = unwrap(node);

    if (ts.isIdentifier(target)) return identifierOrigin(target, depth);

    if (ts.isPropertyAccessExpression(target)) return member(originOf(target.expression, depth + 1), target.name.text);

    if (ts.isElementAccessExpression(target) && ts.isStringLiteralLike(target.argumentExpression)) return member(originOf(target.expression, depth + 1), target.argumentExpression.text);

    if (ts.isAwaitExpression(target)) return originOf(target.expression, depth + 1);

    const required = moduleSpecifierOf(target);

    if (required !== undefined && ts.isCallExpression(target)) return `import:${required}#*`;

    return undefined;
  }

  function memberPath(node: ts.Node, depth = 0): string[] {
    if (depth > maxDepth) return [];

    if (ts.isBindingElement(node)) {
      const keys: string[] = [];
      let current: ts.Node = node;

      while (ts.isBindingElement(current)) {
        const key = ts.isObjectBindingPattern(current.parent) && !current.dotDotDotToken ? propertyKey(current.propertyName ?? current.name) : undefined;

        if (key === undefined) return [];
        keys.unshift(key);
        current = current.parent.parent;
      }

      return ts.isVariableDeclaration(current) && current.initializer ? [...memberPath(current.initializer, depth + 1), ...keys] : keys;
    }

    const target = unwrap(node);

    if (ts.isPropertyAccessExpression(target)) return [...memberPath(target.expression, depth + 1), target.name.text];

    if (ts.isElementAccessExpression(target)) return ts.isStringLiteralLike(target.argumentExpression) ? [...memberPath(target.expression, depth + 1), target.argumentExpression.text] : [];

    if (ts.isAwaitExpression(target)) return memberPath(target.expression, depth + 1);

    if (!ts.isIdentifier(target)) return [];
    const declaration = symbolOf(target)?.declarations?.[0];

    if (declaration && ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name) && declaration.initializer) return memberPath(declaration.initializer, depth + 1);

    if (declaration && ts.isBindingElement(declaration)) return memberPath(declaration, depth + 1);

    return [target.text];
  }

  const cross = (left: string[], right: string[]) => left.flatMap(prefix => right.map(suffix => `${prefix}${suffix}`));

  function stringValues(node: ts.Node, depth = 0): string[] | undefined {
    if (depth > maxDepth) return undefined;
    const target = unwrap(node);
    let values: string[] | undefined;

    if (ts.isStringLiteralLike(target) || ts.isNumericLiteral(target)) values = [target.text];
    else if (ts.isBinaryExpression(target) && target.operatorToken.kind === ts.SyntaxKind.PlusToken) values = joinValues(stringValues(target.left, depth + 1), stringValues(target.right, depth + 1));
    else if (ts.isConditionalExpression(target)) values = unionValues(stringValues(target.whenTrue, depth + 1), stringValues(target.whenFalse, depth + 1));
    else if (ts.isTemplateExpression(target)) {
      values = [target.head.text];

      for (const span of target.templateSpans) values = joinValues(joinValues(values, stringValues(span.expression, depth + 1)), [span.literal.text]);
    } else if (ts.isIdentifier(target)) {
      const declaration = symbolOf(target)?.declarations?.[0];
      const constant = declaration && ts.isVariableDeclaration(declaration) && (ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) !== 0;

      if (declaration && constant && ts.isVariableDeclaration(declaration) && declaration.initializer) values = stringValues(declaration.initializer, depth + 1);
    } else if (ts.isCallExpression(target) && ts.isPropertyAccessExpression(target.expression)) values = callValues(target.expression, target.arguments, depth);

    return values !== undefined && values.length <= maxValues ? values : undefined;
  }

  const joinValues = (left: string[] | undefined, right: string[] | undefined) => left && right && left.length * right.length <= maxValues ? cross(left, right) : undefined;

  const unionValues = (left: string[] | undefined, right: string[] | undefined) => left && right ? [...left, ...right] : undefined;

  function callValues(callee: ts.PropertyAccessExpression, args: ts.NodeArray<ts.Expression>, depth: number): string[] | undefined {
    const receiver = unwrap(callee.expression);

    if (callee.name.text === 'join' && ts.isArrayLiteralExpression(receiver)) {
      const separators = args[0] ? stringValues(args[0], depth + 1) : [','];
      let result: string[] | undefined;

      for (const [index, element] of receiver.elements.entries()) {
        const part = ts.isSpreadElement(element) ? undefined : stringValues(element, depth + 1);
        result = index === 0 ? part : joinValues(joinValues(result, separators), part);
      }

      return receiver.elements.length === 0 ? [''] : result;
    }

    if (callee.name.text === 'concat') {
      let result = stringValues(receiver, depth + 1);

      for (const argument of args) result = joinValues(result, stringValues(argument, depth + 1));

      return result;
    }

    return undefined;
  }

  const isReference = (node: ts.Identifier) => {
    const parent = node.parent;

    if (ts.findAncestor(parent, candidate => ts.isTypeNode(candidate) && !ts.isExpressionWithTypeArguments(candidate))) return false;

    if (ts.isTypeOfExpression(parent)) return false;

    if (ts.isShorthandPropertyAssignment(parent)) return parent.name === node;

    if (ts.isPropertyAccessExpression(parent)) return parent.expression === node;

    if (ts.isQualifiedName(parent) || ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return false;

    if (ts.isBindingElement(parent) && parent.propertyName === node) return false;

    return !('name' in parent && parent.name === node);
  };

  return { parsed, originOf, stringValues, isReference, symbolOf, memberPath };
}
