import React, { useEffect, useState, useCallback } from "react";
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
import { Status } from "../components/StatusDot";
import { fetchLeaveData, submitLeaveRequest, ApiError } from "../api";
import type { LeaveRequestItem } from "../types";

function offsetDateIso(daysAhead: number): string {
  const istMs = Date.now() + 5.5 * 60 * 60 * 1000 + daysAhead * 24 * 60 * 60 * 1000;
  return new Date(istMs).toISOString().slice(0, 10);
}

export function LeaveScreen({
  onNavigateTab,
}: {
  onNavigateTab: (tab: "jobs" | "calendar" | "leave") => void;
}) {
  const [startDate, setStartDate] = useState(offsetDateIso(1));
  const [endDate, setEndDate] = useState(offsetDateIso(1));
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [requests, setRequests] = useState<LeaveRequestItem[]>([]);

  const loadLeave = useCallback(async () => {
    try {
      const res = await fetchLeaveData();
      setRequests(res.requests);
    } catch {
      // ignore offline
    }
  }, []);

  useEffect(() => {
    void loadLeave();
  }, [loadLeave]);

  async function handleSubmitLeave() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate.trim()) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate.trim())) {
      Alert.alert("Invalid date", "Please enter dates in YYYY-MM-DD format.");
      return;
    }
    if (endDate.trim() < startDate.trim()) {
      Alert.alert("Invalid range", "End date cannot be earlier than start date.");
      return;
    }
    if (!reason.trim()) {
      Alert.alert("Reason required", "Please enter a brief reason for your leave request.");
      return;
    }

    setSubmitting(true);
    try {
      await submitLeaveRequest({
        startDate: startDate.trim(),
        endDate: endDate.trim(),
        reason: reason.trim(),
      });
      setReason("");
      await loadLeave();
      Alert.alert(
        "Leave requested",
        "Your leave request has been sent to the office. Once approved, it will appear on the calendar automatically.",
      );
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to submit leave request";
      Alert.alert("Error", msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.welcomeTitle}>Apply for leave</Text>
          <Text style={styles.techSubtitle}>
            Approved leave is added to the calendar automatically
          </Text>
        </View>
      </View>

      <View style={styles.tabBar}>
        <TouchableOpacity
          style={styles.tabButton}
          onPress={() => onNavigateTab("jobs")}
        >
          <Text style={styles.tabText}>1. My jobs</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.tabButton}
          onPress={() => onNavigateTab("calendar")}
        >
          <Text style={styles.tabText}>2. My calendar</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, styles.tabButtonActive]}
          onPress={() => onNavigateTab("leave")}
        >
          <Text style={[styles.tabText, styles.tabTextActive]}>3. Leave</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <Text style={styles.sectionTitle}>New leave request</Text>
          <View style={styles.presetRow}>
            <TouchableOpacity
              style={styles.presetChip}
              onPress={() => {
                const d = offsetDateIso(0);
                setStartDate(d);
                setEndDate(d);
              }}
            >
              <Text style={styles.presetText}>Today</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.presetChip}
              onPress={() => {
                const d = offsetDateIso(1);
                setStartDate(d);
                setEndDate(d);
              }}
            >
              <Text style={styles.presetText}>Tomorrow</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.presetChip}
              onPress={() => {
                setStartDate(offsetDateIso(1));
                setEndDate(offsetDateIso(2));
              }}
            >
              <Text style={styles.presetText}>2 days</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.fieldLabel}>From date (YYYY-MM-DD)</Text>
          <TextInput
            style={styles.input}
            value={startDate}
            onChangeText={setStartDate}
            placeholder="2026-11-21"
            placeholderTextColor={colors.ink3}
          />

          <Text style={styles.fieldLabel}>To date (YYYY-MM-DD)</Text>
          <TextInput
            style={styles.input}
            value={endDate}
            onChangeText={setEndDate}
            placeholder="2026-11-21"
            placeholderTextColor={colors.ink3}
          />

          <Text style={styles.fieldLabel}>Reason</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={reason}
            onChangeText={setReason}
            placeholder="e.g. Family function / medical appointment"
            placeholderTextColor={colors.ink3}
            multiline
            numberOfLines={3}
          />

          <Button
            title="Submit leave request"
            onPress={handleSubmitLeave}
            loading={submitting}
          />
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>
            My leave requests ({requests.length})
          </Text>
          {requests.length === 0 ? (
            <Text style={styles.emptyText}>No leave requests submitted yet.</Text>
          ) : (
            requests.map((r) => {
              const range =
                r.startDate === r.endDate
                  ? r.startDate
                  : `${r.startDate} to ${r.endDate}`;
              const tone =
                r.status === "approved"
                  ? "ok"
                  : r.status === "rejected"
                    ? "bad"
                    : "wait";
              return (
                <View key={r.id} style={styles.reqRow}>
                  <View style={styles.reqTop}>
                    <Text style={styles.reqDates}>{range}</Text>
                    <Status tone={tone}>{r.status}</Status>
                  </View>
                  {r.reason ? (
                    <Text style={styles.reqReason}>{r.reason}</Text>
                  ) : null}
                </View>
              );
            })
          )}
        </Card>
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
  },
  welcomeTitle: {
    ...typography.header,
  },
  techSubtitle: {
    ...typography.sub,
    marginTop: 2,
  },
  tabBar: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    backgroundColor: colors.surface,
    gap: 8,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    backgroundColor: colors.background,
  },
  tabButtonActive: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  tabText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.ink2,
  },
  tabTextActive: {
    color: "#FFFFFF",
  },
  content: {
    padding: spacing.lg,
  },
  sectionTitle: {
    ...typography.sectionTitle,
    marginBottom: spacing.sm,
  },
  presetRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: spacing.sm,
  },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.background,
  },
  presetText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.ink,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.ink2,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
    color: colors.ink,
    marginBottom: spacing.md,
  },
  textArea: {
    minHeight: 72,
    textAlignVertical: "top",
  },
  emptyText: {
    ...typography.sub,
    color: colors.ink3,
  },
  reqRow: {
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line2,
  },
  reqTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  reqDates: {
    ...typography.mono,
    fontWeight: "700",
  },
  reqReason: {
    fontSize: 13,
    color: colors.ink2,
    marginTop: 4,
  },
});
