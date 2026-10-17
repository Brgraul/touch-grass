const { readdirSync, existsSync } = require('node:fs');

const { dependencyRules } = require('./tools/boundary-enforcement/policy.ts');

const directories = path => existsSync(path) ? readdirSync(path, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name) : [];

module.exports = {
  forbidden: dependencyRules(directories('src/features'), directories('src/domain')),
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.(?:test|spec)\\.tsx?$|^src/routeTree\\.gen\\.ts$|\\.d\\.ts$' },
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { conditionNames: ['import', 'node', 'default'], exportsFields: ['exports'] },
    tsPreCompilationDeps: true,
  },
};
