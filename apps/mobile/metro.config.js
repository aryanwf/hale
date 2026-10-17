const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Clerk imports React DOM even on native; keep both React packages isolated from Next.js.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (["react", "react-dom"].some((name) => moduleName === name || moduleName.startsWith(`${name}/`))) {
    return { type: "sourceFile", filePath: require.resolve(moduleName, { paths: [__dirname] }) };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
