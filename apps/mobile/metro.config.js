// metro.config.js — Plan A : watchFolders + extraNodeModules
// Stratégie Metro/pnpm (MOB-001, leçon F0) :
//   Plan A (RETENU) : watchFolders + extraNodeModules — hoisting sélectif, zéro impact monorepo global
//   Plan B (non déclenché) : symlinks postinstall dans apps/mobile/scripts/
//   Plan C (non déclenché) : node-linker=hoisted global — gate orchestrateur requis
//
// Résultat : @sigfa/schemas et @sigfa/contracts résolus sans MODULE_NOT_FOUND.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Surveille les packages workspace depuis la racine du monorepo
config.watchFolders = [workspaceRoot];

// Résolution des modules workspace via extraNodeModules
config.resolver.extraNodeModules = {
  '@sigfa/schemas': path.resolve(workspaceRoot, 'packages/schemas'),
  '@sigfa/contracts': path.resolve(workspaceRoot, 'packages/contracts'),
};

// Empêche les doublons de modules React/React-Native
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
