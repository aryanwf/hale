import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, type TextInputProps } from "react-native";
import { colors, styles } from "../theme";

export function Button({ title, onPress, disabled, tone = "primary", accessibilityLabel }: { title: string; onPress: () => void; disabled?: boolean; tone?: "primary" | "secondary"; accessibilityLabel?: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled: !!disabled }} onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.button, tone === "secondary" && styles.secondary, (disabled || pressed) && styles.disabled]}><Text style={[styles.buttonText, tone === "secondary" && styles.secondaryText]}>{title}</Text></Pressable>;
}
export function Check({ checked, onChange, children }: { checked: boolean; onChange: () => void; children: ReactNode }) {
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={onChange} style={[styles.row, { alignItems: "flex-start", minHeight: 48 }]}><View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 1, borderColor: colors.burgundy, backgroundColor: checked ? colors.burgundy : colors.white, alignItems: "center", justifyContent: "center" }}><Text style={{ color: colors.white }}>{checked ? "✓" : ""}</Text></View><Text style={[styles.small, styles.grow]}>{children}</Text></Pressable>;
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return <View style={styles.stack}><Text style={styles.small}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor={colors.muted} style={styles.input} {...props} /></View>;
}
export function SegmentedControl<T extends string>({ value, options, onChange, label }: { value: T; options: readonly { value: T; label: string }[]; onChange(value: T): void; label: string }) {
  return <View accessibilityRole="tablist" accessibilityLabel={label} style={styles.segments}>{options.map((option) => {
    const selected = option.value === value;
    return <Pressable key={option.value} accessibilityRole="tab" accessibilityState={{ selected }} onPress={() => onChange(option.value)} style={[styles.segment, selected && styles.segmentSelected]}><Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{option.label}</Text></Pressable>;
  })}</View>;
}
export function Page({ eyebrow, title, description, children }: { eyebrow: string; title: string; description?: string; children: ReactNode }) {
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"><View style={styles.pageIntro}><Text style={styles.eyebrow}>{eyebrow}</Text><Text accessibilityRole="header" style={styles.headline}>{title}</Text>{description && <Text style={[styles.body, styles.muted]}>{description}</Text>}</View>{children}</ScrollView>;
}
export function Notice({ children }: { children: ReactNode }) {
  return <View style={[styles.card, styles.quiet]}><Text style={styles.small}>{children}</Text></View>;
}
export function Empty({ title, description }: { title: string; description?: string }) {
  return <View style={[styles.card, styles.empty]}><Text style={[styles.title, { textAlign: "center" }]}>{title}</Text>{description && <Text style={[styles.small, { textAlign: "center" }]}>{description}</Text>}</View>;
}
export function Loading({ message = "A moment for your memories…" }: { message?: string }) {
  return <View style={[styles.screen, { justifyContent: "center", padding: 32, gap: 20 }]}><ActivityIndicator color={colors.burgundy} /><Text style={[styles.body, { textAlign: "center" }]}>{message}</Text></View>;
}
export function Gate({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return <Page eyebrow="HEALTHCARE, REMEMBERED." title={title} description={description}><Text style={styles.wordmark}>hale.</Text>{children}</Page>;
}
