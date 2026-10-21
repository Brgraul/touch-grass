import ts from 'typescript';
import { propertyKey, type Resolver } from './resolve.ts';

const environmentTypeName = 'Env';

const wrapperTypes = new Set(['Readonly', 'Partial', 'Required', 'Pick', 'Omit', 'NonNullable']);

const maxDepth = 8;

function rightmost(name: ts.EntityName | ts.Expression): string | undefined {
  if (ts.isIdentifier(name)) return name.text;

  if (ts.isQualifiedName(name)) return name.right.text;

  if (ts.isPropertyAccessExpression(name)) return name.name.text;

  return undefined;
}

// Whether a type is the Worker environment: `Env`, `Cloudflare.Env`, `typeof env`, a view of one, or an alias of one in this file.
export function createEnvironmentTypes(resolver: Resolver) {
  const isEnvironmentType = (type: ts.TypeNode | undefined, depth = 0): boolean => {
    if (!type || depth > maxDepth) return false;

    if (ts.isParenthesizedTypeNode(type)) return isEnvironmentType(type.type, depth + 1);

    if (ts.isTypeOperatorNode(type)) return isEnvironmentType(type.type, depth + 1);

    if (ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type)) return type.types.some(member => isEnvironmentType(member, depth + 1));

    if (ts.isTypeQueryNode(type)) return rightmost(type.exprName) === 'env';

    if (!ts.isTypeReferenceNode(type)) return false;
    const name = rightmost(type.typeName);

    if (name === environmentTypeName) return true;

    if (name !== undefined && wrapperTypes.has(name)) return isEnvironmentType(type.typeArguments?.[0], depth + 1);
    const declaration = resolver.symbolOf(ts.isQualifiedName(type.typeName) ? type.typeName.right : type.typeName)?.declarations?.[0];

    if (declaration && ts.isTypeAliasDeclaration(declaration)) return isEnvironmentType(declaration.type, depth + 1);

    if (declaration && ts.isInterfaceDeclaration(declaration)) return (declaration.heritageClauses ?? []).some(clause => clause.types.some(heritage => rightmost(heritage.expression) === environmentTypeName));

    return false;
  };

  const isEnvironment = (node: ts.Node, depth = 0): boolean => {
    if (depth > maxDepth) return false;
    let target = node;

    for (;;) {
      if (ts.isAsExpression(target) || ts.isSatisfiesExpression(target) || ts.isTypeAssertionExpression(target)) {
        if (isEnvironmentType(target.type)) return true;
        target = target.expression;
      } else if (ts.isParenthesizedExpression(target) || ts.isNonNullExpression(target)) target = target.expression;
      else break;
    }

    if (ts.isPropertyAccessExpression(target)) return target.name.text === 'env';

    if (ts.isElementAccessExpression(target)) return ts.isStringLiteralLike(target.argumentExpression) && target.argumentExpression.text === 'env';

    if (!ts.isIdentifier(target)) return false;

    if (target.text === 'env' || resolver.originOf(target) === 'import:cloudflare:workers#env') return true;
    const declaration = resolver.symbolOf(target)?.declarations?.[0];

    if (!declaration) return false;

    if (ts.isBindingElement(declaration)) return propertyKey(declaration.propertyName ?? declaration.name) === 'env';

    if (ts.isParameter(declaration) || ts.isVariableDeclaration(declaration) || ts.isPropertyDeclaration(declaration)) {
      if (isEnvironmentType(declaration.type)) return true;

      return ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined && isEnvironment(declaration.initializer, depth + 1);
    }

    return false;
  };

  // A destructuring pattern reads environment fields when its source, or its own type annotation, is the environment.
  const readsEnvironment = (declaration: ts.VariableDeclaration | ts.ParameterDeclaration) => ts.isObjectBindingPattern(declaration.name) && (isEnvironmentType(declaration.type) || declaration.initializer !== undefined && isEnvironment(declaration.initializer));

  return { isEnvironment, readsEnvironment };
}
