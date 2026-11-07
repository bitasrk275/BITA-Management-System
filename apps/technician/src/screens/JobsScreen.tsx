import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  Alert,
} from "react-native";
import { colors, spacing, typography } from "../theme";
import { Card } from "../components/Card";
import { Status } from "../components/StatusDot";
import { Badge } from "../components/Badge";
import { fetchJobs, ApiError } from "../api";
import { getStoredCredentials, clearCredentials } from "../storage";
import type { JobAssignment } from "../types";

export function JobsScreen({
  onSelectJob,
  onUnlink,
}: {
  onSelectJob: (job: JobAssignment) => void;
  onUnlink: () => void;
}) {
  const [jobs, setJobs] = useState<JobAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [technicianName, setTechnicianName] = useState("Technician");
  const [offline, setOffline] = useState(false);

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const creds = await getStoredCredentials();
      if (creds) setTechnicianName(creds.technicianName);

      const items = await fetchJobs();
      setJobs(items);
      setOffline(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        Alert.alert("Access Revoked", "This phone's access was revoked by the office.", [
          { text: "OK", onPress: onUnlink },
        ]);
        return;
      }
      setOffline(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [onUnlink]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function handleUnlinkPress() {
    Alert.alert(
      "Unlink phone?",
      "You will need a new 6-digit code from the office to link this phone again.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unlink",
          style: "destructive",
          onPress: async () => {
            await clearCredentials();
            onUnlink();
          },
        },
      ],
    );
  }

  function renderJobItem({ item }: { item: JobAssignment }) {
    const isCompleted = Boolean(item.completedAt);
    const isStarted = Boolean(item.startedAt);
    const isAcknowledged = Boolean(item.acknowledgedAt);

    let tone: "ok" | "wait" | "info" = "wait";
    let statusText = "Assigned";

    if (isCompleted) {
      tone = "ok";
      statusText = "Inspection done";
    } else if (isStarted) {
      tone = "info";
      statusText = "Work started";
    } else if (isAcknowledged) {
      tone = "info";
      statusText = "Acknowledged";
    }

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => onSelectJob(item)}
      >
        <Card style={styles.jobCard}>
          <View style={styles.cardHeader}>
            <Text style={styles.jobNo}>{item.jobNo}</Text>
            <Status tone={tone}>{statusText}</Status>
          </View>

          <Text style={styles.customerName}>{item.customerName}</Text>
          {item.site ? <Text style={styles.siteText}>Site: {item.site}</Text> : null}
          {item.scope ? <Text style={styles.scopeText} numberOfLines={2}>{item.scope}</Text> : null}

          <View style={styles.cardFooter}>
            <Text style={styles.dateText}>Work date: {item.workDate}</Text>
            <View style={styles.methodBadges}>
              {item.testMethods.map((m) => (
                <Badge key={m} label={m} />
              ))}
            </View>
          </View>
        </Card>
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.welcomeTitle}>My jobs</Text>
          <Text style={styles.techSubtitle}>{technicianName} · BITA Field</Text>
        </View>
        <TouchableOpacity
          onPress={handleUnlinkPress}
          style={styles.unlinkButton}
        >
          <Text style={styles.unlinkText}>Unlink</Text>
        </TouchableOpacity>
      </View>

      {offline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>
            Offline mode — displaying cached assignments. Connect to sync.
          </Text>
        </View>
      )}

      <FlatList
        data={jobs}
        keyExtractor={(item) => item.id}
        renderItem={renderJobItem}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadData(true)}
            tintColor={colors.ink}
          />
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No assignments</Text>
              <Text style={styles.emptySubtitle}>
                You have no upcoming or recent inspection assignments.
              </Text>
            </View>
          ) : undefined
        }
      />
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
  welcomeTitle: {
    ...typography.header,
  },
  techSubtitle: {
    ...typography.sub,
    marginTop: 2,
  },
  unlinkButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  unlinkText: {
    fontSize: 13,
    color: colors.ink3,
  },
  offlineBanner: {
    backgroundColor: colors.wait + "15",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.wait + "30",
  },
  offlineText: {
    fontSize: 12,
    color: colors.wait,
    textAlign: "center",
    fontWeight: "500",
  },
  list: {
    padding: spacing.lg,
  },
  jobCard: {
    marginBottom: spacing.md,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xs,
  },
  jobNo: {
    ...typography.mono,
    fontWeight: "700",
  },
  customerName: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.ink,
    marginBottom: 2,
  },
  siteText: {
    ...typography.sub,
    marginBottom: 2,
  },
  scopeText: {
    ...typography.caption,
    marginBottom: spacing.sm,
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: colors.line2,
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
  },
  dateText: {
    fontSize: 12,
    color: colors.ink2,
  },
  methodBadges: {
    flexDirection: "row",
    gap: 4,
  },
  emptyState: {
    padding: spacing.xxl,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    ...typography.sectionTitle,
    marginBottom: spacing.xs,
  },
  emptySubtitle: {
    ...typography.sub,
    textAlign: "center",
  },
});
