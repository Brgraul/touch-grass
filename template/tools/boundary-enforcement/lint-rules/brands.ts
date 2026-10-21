import ts from 'typescript';

const brandTypes = new Set(['Brand', '$brand']);

const schemaTypes = new Set(['infer', 'output', 'input']);

function rightmost(name: ts.EntityName): string {
  return ts.isIdentifier(name) ? name.text : name.right.text;
}

function literalOf(node: ts.Node | undefined): string | undefined {
  if (node && ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) return node.literal.text;

  return node && ts.isStringLiteralLike(node) ? node.text : undefined;
}

// Whether a type is a brand, or a union, array or wrapper of one, rather than an object that merely has a branded field.
export function namesBrand(type: ts.TypeNode, brands: ReadonlySet<string>, brandedValues: ReadonlySet<string> = new Set()): boolean {
  const recurse = (inner: ts.TypeNode) => namesBrand(inner, brands, brandedValues);

  if (ts.isParenthesizedTypeNode(type) || ts.isTypeOperatorNode(type)) return recurse(type.type);

  if (ts.isArrayTypeNode(type)) return recurse(type.elementType);

  if (ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type)) return type.types.some(recurse);

  if (!ts.isTypeReferenceNode(type)) return false;
  const name = rightmost(type.typeName);
  const argument = type.typeArguments?.[0];

  if (brands.has(name)) return true;

  if (schemaTypes.has(name) && argument && ts.isTypeQueryNode(argument) && ts.isIdentifier(argument.exprName)) return brandedValues.has(argument.exprName.text);

  return type.typeArguments?.some(recurse) === true;
}

// Brands a file declares: each `.brand<'Name'>()` or `Brand<T, 'Name'>`, and each type alias of a brand, such as `type UserId = z.infer<typeof userId>` or `type Id = UserId | undefined`. `known` holds brands declared elsewhere, so an alias of one is a brand too.
export function brandsDeclaredIn(path: string, source: string, known: ReadonlySet<string> = new Set()): Set<string> {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const brands = new Set<string>();
  const brandedValues = new Set<string>();
  const aliases: ts.TypeAliasDeclaration[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'brand') {
      const name = literalOf(node.typeArguments?.[0]) ?? literalOf(node.arguments[0]);
      const declaration = ts.findAncestor(node, ts.isVariableDeclaration);

      if (name !== undefined) brands.add(name);

      if (declaration && ts.isIdentifier(declaration.name)) brandedValues.add(declaration.name.text);
    }

    if (ts.isTypeReferenceNode(node) && brandTypes.has(rightmost(node.typeName))) {
      const name = literalOf(node.typeArguments?.at(-1));

      if (name !== undefined) brands.add(name);
    }

    if (ts.isTypeAliasDeclaration(node)) aliases.push(node);
    ts.forEachChild(node, visit);
  };

  visit(file);
  let grew = true;

  while (grew) {
    grew = false;

    for (const alias of aliases) {
      if (brands.has(alias.name.text) || !namesBrand(alias.type, new Set([...brands, ...known]), brandedValues)) continue;
      brands.add(alias.name.text);
      grew = true;
    }
  }

  return brands;
}
