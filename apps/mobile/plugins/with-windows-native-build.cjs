const { withProjectBuildGradle } = require("expo/config-plugins");

// Bun's isolated dependency paths can exceed Ninja's Windows path limit.
// Keep native intermediates outside node_modules, including for Expo libraries.
const windowsNativeBuild = `
// hale-windows-native-build
if (System.getProperty("os.name").toLowerCase().contains("windows")) {
  def workspaceId = rootDir.absolutePath.md5().take(8)
  def nativeRoot = new File(System.getProperty("java.io.tmpdir"), "opencode/hale-cxx/" + workspaceId)
  subprojects { subproject ->
    ["com.android.application", "com.android.library"].each { pluginId ->
      subproject.plugins.withId(pluginId) {
        subproject.extensions.getByName("androidComponents").finalizeDsl { android ->
          android.externalNativeBuild.cmake.buildStagingDirectory = new File(nativeRoot, subproject.name)
          android.defaultConfig.externalNativeBuild.cmake.arguments.add("-DCMAKE_OBJECT_PATH_MAX=240")
        }
      }
    }
  }
}
`;

module.exports = function withWindowsNativeBuild(config) {
  return withProjectBuildGradle(config, (config) => {
    if (!config.modResults.contents.includes("// hale-windows-native-build")) {
      config.modResults.contents += windowsNativeBuild;
    }
    return config;
  });
};
