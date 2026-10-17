const { withAppBuildGradle } = require("expo/config-plugins");

// Clerk selects OkHttp 5, while React Native requests urlconnection 4.9.2.
// The older cookie jar calls internal APIs removed in OkHttp 5. Align the
// complete family (including the extracted JavaNetCookieJar) with a BOM.
module.exports = function withAndroidNetworkDependencies(config) {
  return withAppBuildGradle(config, (config) => {
    if (!config.modResults.contents.includes("// hale-okhttp-alignment")) {
      config.modResults.contents += `
// hale-okhttp-alignment
dependencies {
    implementation platform("com.squareup.okhttp3:okhttp-bom:5.4.0")
}
`;
    }
    return config;
  });
};
