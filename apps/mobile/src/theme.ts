import { StyleSheet } from "react-native";

export const colors = {
  background: "#FAF7F5", burgundy: "#9B2C2C", blush: "#F9E1E1",
  gray: "#F0EBE8", cream: "#FEF3C7", ink: "#1A1A1A",
  muted: "#746762", border: "#E5DAD5", white: "#FFFFFF",
};
export const fonts = { sans: "Geist", medium: "GeistMedium", serif: "LibreBaskerville", mono: "IBMPlexMono" };

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingBottom: 40, gap: 20 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  stack: { gap: 12 },
  grow: { flex: 1 },
  wordmark: { fontFamily: fonts.serif, color: colors.burgundy, fontSize: 32, letterSpacing: -1.5 },
  eyebrow: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.6, color: colors.muted, textTransform: "uppercase", lineHeight: 18 },
  headline: { fontFamily: fonts.serif, fontSize: 33, lineHeight: 44, color: colors.ink, letterSpacing: -1.1 },
  heading: { fontFamily: fonts.serif, fontSize: 22, lineHeight: 31, color: colors.ink },
  title: { fontFamily: fonts.medium, fontSize: 17, lineHeight: 25, color: colors.ink },
  body: { fontFamily: fonts.sans, fontSize: 16, lineHeight: 25, color: colors.ink },
  muted: { color: colors.muted },
  small: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 21, color: colors.muted },
  mono: { fontFamily: fonts.mono, fontSize: 13, color: colors.burgundy },
  card: { backgroundColor: colors.white, borderColor: colors.border, borderWidth: 1, borderRadius: 20, padding: 20, gap: 12 },
  blush: { backgroundColor: colors.blush, borderColor: colors.blush },
  cream: { backgroundColor: colors.cream, borderColor: colors.cream },
  quiet: { backgroundColor: colors.gray, borderColor: colors.gray },
  button: { minHeight: 48, borderRadius: 14, backgroundColor: colors.burgundy, paddingHorizontal: 18, paddingVertical: 13, alignItems: "center", justifyContent: "center" },
  buttonText: { fontFamily: fonts.medium, fontSize: 15, color: colors.white, textAlign: "center" },
  secondary: { backgroundColor: colors.gray },
  secondaryText: { color: colors.ink },
  disabled: { opacity: 0.45 },
  input: { minHeight: 52, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 14, fontFamily: fonts.sans, fontSize: 16, color: colors.ink },
  divider: { height: 1, backgroundColor: colors.border },
  badge: { alignSelf: "flex-start", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: colors.gray },
  avatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: colors.blush, alignItems: "center", justifyContent: "center" },
  tabs: { flexDirection: "row", borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.background, paddingTop: 8 },
  tab: { flex: 1, alignItems: "center", gap: 4, paddingVertical: 8, minHeight: 56 },
  tabText: { fontFamily: fonts.medium, fontSize: 11, color: colors.muted },
  tabActive: { color: colors.burgundy },
  tabIcon: { fontFamily: fonts.sans, fontSize: 20, color: colors.muted },
});
