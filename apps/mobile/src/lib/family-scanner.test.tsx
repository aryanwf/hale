import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

const lookupNativeModule = mock(() => null);
mock.module("expo", () => ({ requireOptionalNativeModule: lookupNativeModule }));
mock.module("react-native-safe-area-context", () => ({ SafeAreaView: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
mock.module("../theme", () => ({ styles: { screen: {} } }));
mock.module("../components/ui", () => ({
  Page: ({ title, description, children }: { title: string; description: string; children: ReactNode }) => <main><h1>{title}</h1><p>{description}</p>{children}</main>,
  Button: ({ title, onPress }: { title: string; onPress(): void }) => <button onClick={onPress}>{title}</button>,
}));

const { FamilyScanner } = await import("../components/family-scanner");

describe("scanner on an older Android development build", () => {
  test("can load the scanner wrapper without importing the unavailable camera module", () => {
    const html = renderToStaticMarkup(<FamilyScanner onScan={() => {}} onClose={() => {}} />);
    expect(html).toContain("This app needs a camera update.");
  });

  test("keeps manual linking available when native camera support is missing", () => {
    const html = renderToStaticMarkup(<FamilyScanner onScan={() => {}} onClose={() => {}} />);
    expect(html).toContain("Enter family code instead");
  });

  test("checks for the ExpoCamera native module rather than only the JavaScript package", () => {
    renderToStaticMarkup(<FamilyScanner onScan={() => {}} onClose={() => {}} />);
    expect(lookupNativeModule).toHaveBeenCalledWith("ExpoCamera");
  });
});
