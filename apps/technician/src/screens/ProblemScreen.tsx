import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
  StatusBar,
} from "react-native";
import { colors, spacing, typography } from "../theme";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { reportProblem, ApiError } from "../api";
import type { JobAssignment, ProblemKind } from "../types";

const PROBLEM_KINDS: Array<{ kind: ProblemKind; label: string; description: string }> = [
  {
    kind: "delay",
    label: "Site delay",
    description: "Component not ready, crane unavailable, or testing delayed.",
  },
  {
    kind: "equipment_problem",
    label: "Equipment problem",
    description: "UT probe damaged, cable broken, or yoke malfunction.",
  },
  {
    kind: "site_issue",
    label: "Safety / access issue",
    description: "Gate pass delay, unsafe scaffolding, or hazardous conditions.",
  },
  {
    kind: "leave",
    label: "Leave / medical emergency",
    description: "Sudden illness or unable to complete shift.",
  },
  {
    kind: "other",
    label: "Other issue",
    description: "Any other operational concern requiring office attention.",
  },
];

export function ProblemScreen({
  job,
  onBack,
  onSubmitted,
}: {
  job?: JobAssignment;
  onBack: () => void;
  onSubmitted: () => void;
}) {
  const [selectedKind, setSelectedKind] = useState<ProblemKind>("delay");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!description.trim()) {
      Alert.alert("Missing details", "Please describe the problem so the office can assist.");
      return;
    }

    setSubmitting(true);
    try {
      await reportProblem({
        kind: selectedKind,
        body: description.trim(),
        jobId: job?.jobId,
      });

      Alert.alert(
        "Problem Reported",
        "Your message has been sent directly to the BITA management office.",
        [{ text: "OK", onPress: onSubmitted }],
      );
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to submit message";
      Alert.alert("Error", msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Report a Problem</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {job && (
          <Text style={styles.jobRef}>
            Regarding job: {job.jobNo} ({job.customerName})
          </Text>
        )}

        <Card>
          <Text style={styles.sectionTitle}>Select problem type</Text>

          {PROBLEM_KINDS.map((p) => {
            const isSelected = selectedKind === p.kind;
            return (
              <TouchableOpacity
                key={p.kind}
                activeOpacity={0.8}
                onPress={() => setSelectedKind(p.kind)}
                style={[styles.kindCard, isSelected && styles.kindCardSelected]}
              >
                <View style={styles.radioRow}>
                  <View style={[styles.radioCircle, isSelected && styles.radioCircleSelected]} />
                  <Text style={[styles.kindLabel, isSelected && styles.kindLabelSelected]}>
                    {p.label}
                  </Text>
                </View>
                <Text style={styles.kindDesc}>{p.description}</Text>
              </TouchableOpacity>
            );
          })}
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Describe the issue</Text>
          <TextInput
            style={styles.textarea}
            placeholder="Provide specific details (e.g. which probe is broken, expected delay time, or site contact)..."
            placeholderTextColor={colors.ink3}
            multiline
            numberOfLines={5}
            value={description}
            onChangeText={setDescription}
          />
        </Card>

        <Button
          title="Send report to office"
          onPress={handleSubmit}
          loading={submitting}
          disabled={submitting || !description.trim()}
          style={styles.submitButton}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 28) : 0,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backButton: {
    paddingVertical: spacing.xs,
  },
  backText: {
    fontSize: 14,
    color: colors.ink2,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.ink,
  },
  content: {
    padding: spacing.lg,
  },
  jobRef: {
    ...typography.sub,
    marginBottom: spacing.md,
    fontWeight: "600",
  },
  sectionTitle: {
    ...typography.sectionTitle,
    marginBottom: spacing.md,
  },
  kindCard: {
    padding: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  kindCardSelected: {
    borderColor: colors.ink,
    backgroundColor: colors.white,
  },
  radioRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 2,
  },
  radioCircle: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.ink3,
  },
  radioCircleSelected: {
    borderColor: colors.ink,
    backgroundColor: colors.ink,
  },
  kindLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.ink,
  },
  kindLabelSelected: {
    color: colors.ink,
  },
  kindDesc: {
    ...typography.caption,
    marginLeft: 22,
  },
  textarea: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
    color: colors.ink,
    minHeight: 120,
    textAlignVertical: "top",
  },
  submitButton: {
    marginTop: spacing.md,
    marginBottom: spacing.xxl,
  },
});
