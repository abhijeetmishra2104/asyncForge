const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// The repository root is the Next.js app, and it has its own node_modules
// containing React 18, react-dom, Next and Prisma. Metro's default resolution
// walks up the directory tree, so a package missing here could silently resolve
// against the web app's tree — most damagingly a second copy of React.
//
// This is done with a blockList rather than `disableHierarchicalLookup`.
// Disabling hierarchical lookup also stops Metro descending into *nested*
// node_modules, which npm creates whenever a version conflict prevents
// hoisting — expo/node_modules/expo-asset, for one. Blocking only the parent
// directory keeps nested resolution intact while still walling off the web app.
const parentNodeModules = path.resolve(__dirname, '..', 'node_modules');
const blockParent = new RegExp(
  `^${parentNodeModules.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\${path.sep}.*`
);

const existing = config.resolver.blockList;
config.resolver.blockList = Array.isArray(existing)
  ? [...existing, blockParent]
  : existing
    ? [existing, blockParent]
    : [blockParent];

module.exports = config;
