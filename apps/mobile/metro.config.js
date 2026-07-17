const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

// Monorepo: node_modules liegen (dank node-linker=hoisted) flach im
// Workspace-Root, Metro muss also über das eigene Package hinaus schauen.
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Drizzle-Migrationen (.sql) müssen von Metro aufgelöst werden können
config.resolver.sourceExts.push('sql');

module.exports = withNativeWind(config, { input: './global.css' });
