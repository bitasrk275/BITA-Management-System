import React, { ReactNode } from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors } from "../theme";

type Tone = "ok" | "wait" | "bad" | "info" | "none";

const toneColors: Record<Tone, string> = {
  ok: colors.ok,
  wait: colors.wait,
  bad: colors.bad,
  info: colors.info,
  none: colors.ink3,
};

export function StatusDot({ tone }: { tone: Tone }) {
  return <View style={[styles.dot, { backgroundColor: toneColors[tone] }]} />;
}

export function Status({
  tone,
  children,
}: {
  tone: Tone;
  children: ReactNode;
}) {
  return (
    <View style={styles.container}>
      <StatusDot tone={tone} />
      <Text style={styles.text}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  text: {
    fontSize: 13,
    color: colors.ink2,
  },
});
