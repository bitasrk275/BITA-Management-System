import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Alert,
} from "react-native";
import { colors, spacing, typography } from "../theme";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";
import { Status } from "../components/StatusDot";
import { acknowledgeJob, startWork, ApiError } from "../api";
import type { JobAssignment, TestMethod } from "../types";

export function JobDetailScreen({
  job,
  onBack,
  onOpenReport,
  onReportProblem,
  onJobUpdated,
}: {
  job: JobAssignment;
  onBack: () => void;
  onOpenReport: (method: TestMethod) => void;
  onReportProblem: () => void;
  onJobUpdated: (updated: JobAssignment) => void;
}) {
  const [currentJob, setCurrentJob] = useState<JobAssignment>(job);
  const [loadingAction, setLoadingAction] = useState(false);

  const isCompleted = Boolean(currentJob.completedAt);
  const isStarted = Boolean(currentJob.startedAt);
  const isAcknowledged = Boolean(currentJob.acknowledgedAt);

  async function handleAcknowledge() {
    setLoadingAction(true);
    try {
      const res = await acknowledgeJob(currentJob.id);
      const updated: JobAssignment = {
        ...currentJob,
        acknowledgedAt: res.acknowledgedAt,
      };
      setCurrentJob(updated);
      onJobUpdated(updated);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to acknowledge assignment";
      Alert.alert("Error", msg);
    } finally {
      setLoadingAction(false);
    }
  }

  async function handleStartWork() {
    setLoadingAction(true);
    try {
      const res = await startWork(currentJob.id);
      const updated: JobAssignment = {
        ...currentJob,
        startedAt: res.startedAt,
      };
      setCurrentJob(updated);
      onJobUpdated(updated);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to record start of work";
      Alert.alert("Error", msg);
    } finally {
      setLoadingAction(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>← My jobs</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{currentJob.jobNo}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Customer & Site Card */}
        <Card>
          <Text style={styles.customerName}>{currentJob.customerName}</Text>
          <Text style={styles.detailItem}>
            <Text style={styles.detailLabel}>Site: </Text>
            {currentJob.site || "No site specified"}
          </Text>
          <Text style={styles.detailItem}>
            <Text style={styles.detailLabel}>Scope: </Text>
            {currentJob.scope || "Inspection"}
          </Text>
          <Text style={styles.detailItem}>
            <Text style={styles.detailLabel}>Scheduled date: </Text>
            {currentJob.workDate}
          </Text>

          <View style={styles.methodRow}>
            <Text style={styles.detailLabel}>Test methods: </Text>
            <View style={styles.badgeList}>
              {currentJob.testMethods.map((m) => (
                <Badge key={m} label={m} />
              ))}
            </View>
          </View>
        </Card>

        {/* Assigned Equipment Card */}
        <Card>
          <Text style={styles.sectionTitle}>Assigned equipment</Text>
          {currentJob.equipment.length === 0 ? (
            <Text style={styles.emptyText}>No equipment assigned to this job.</Text>
          ) : (
            currentJob.equipment.map((eq) => (
              <View key={eq.id} style={styles.equipmentRow}>
                <View>
                  <Text style={styles.equipmentModel}>
                    {eq.model || eq.kind}
                  </Text>
                  <Text style={styles.equipmentSerial}>
                    S/N: {eq.serialNo || "Not specified"}
                  </Text>
                </View>
                <Text style={styles.calibrationDue}>
                  Cal. due: {eq.calibrationDue || "N/A"}
                </Text>
              </View>
            ))
          )}
        </Card>

        {/* Status & Actions Card */}
        <Card>
          <Text style={styles.sectionTitle}>Job status & actions</Text>
          <View style={styles.statusRow}>
            <Text style={styles.detailLabel}>Inspection status:</Text>
            <Status tone={isCompleted ? "ok" : isStarted ? "info" : "wait"}>
              {isCompleted
                ? "Completed"
                : isStarted
                  ? "Work in progress"
                  : isAcknowledged
                    ? "Acknowledged"
                    : "Not acknowledged"}
            </Status>
          </View>

          {!isAcknowledged && (
            <Button
              title="Acknowledge job"
              onPress={handleAcknowledge}
              loading={loadingAction}
              style={styles.actionButton}
            />
          )}

          {isAcknowledged && !isStarted && (
            <Button
              title="Start work (on site)"
              onPress={handleStartWork}
              loading={loadingAction}
              style={styles.actionButton}
            />
          )}

          {isStarted && !isCompleted && (
            <View style={styles.buttonStack}>
              {currentJob.testMethods.map((m) => (
                <Button
                  key={m}
                  title={`Enter ${m} inspection report`}
                  onPress={() => onOpenReport(m)}
                  style={styles.actionButton}
                />
              ))}
            </View>
          )}

          {isCompleted && (
            <View style={styles.completedBox}>
              <Text style={styles.completedText}>
                ✓ Field report submitted. Office review pending.
              </Text>
              {currentJob.testMethods.map((m) => (
                <Button
                  key={m}
                  title={`View ${m} report (submitted)`}
                  variant="secondary"
                  onPress={() => onOpenReport(m)}
                  style={styles.actionButton}
                />
              ))}
            </View>
          )}

          <Button
            title="Report a problem (delay / issue)"
            variant="secondary"
            onPress={onReportProblem}
            style={styles.problemButton}
          />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
    fontWeight: "600",
    color: colors.ink,
  },
  headerTitle: {
    ...typography.mono,
    fontWeight: "700",
  },
  content: {
    padding: spacing.lg,
  },
  customerName: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.ink,
    marginBottom: spacing.sm,
  },
  detailItem: {
    ...typography.body,
    marginBottom: 4,
  },
  detailLabel: {
    fontWeight: "600",
    color: colors.ink2,
  },
  methodRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.xs,
  },
  badgeList: {
    flexDirection: "row",
    gap: 4,
  },
  sectionTitle: {
    ...typography.sectionTitle,
    marginBottom: spacing.sm,
  },
  emptyText: {
    ...typography.sub,
    color: colors.ink3,
  },
  equipmentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line2,
  },
  equipmentModel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.ink,
  },
  equipmentSerial: {
    ...typography.caption,
  },
  calibrationDue: {
    fontSize: 12,
    color: colors.ink2,
  },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  actionButton: {
    marginTop: spacing.sm,
  },
  buttonStack: {
    gap: 8,
  },
  problemButton: {
    marginTop: spacing.md,
  },
  completedBox: {
    backgroundColor: colors.ok + "15",
    padding: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.ok + "30",
    marginTop: spacing.sm,
  },
  completedText: {
    color: colors.ok,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
});
