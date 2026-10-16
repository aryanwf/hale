const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Next.js and Expo use different React versions; all native dependencies need one React instance.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "react" || moduleName.startsWith("react/")) {
    return { type: "sourceFile", filePath: require.resolve(moduleName, { paths: [__dirname] }) };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
