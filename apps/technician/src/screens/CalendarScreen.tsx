import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Platform,
  StatusBar,
} from "react-native";
import { colors, spacing, typography } from "../theme";
import { Card } from "../components/Card";
import { Badge } from "../components/Badge";
import { Status } from "../components/StatusDot";
import { fetchJobs, fetchLeaveData } from "../api";
import type { ApprovedLeaveDayItem, JobAssignment } from "../types";

function expandAssignmentDates(startDate: string, endDate?: string | null): string[] {
  const end = endDate && endDate >= startDate ? endDate : startDate;
  const startDt = new Date(`${startDate}T00:00:00Z`);
  const endDt = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(startDt.getTime()) || Number.isNaN(endDt.getTime())) {
    return [startDate];
  }
  const dates: string[] = [];
  const cur = new Date(startDt);
  let count = 0;
  while (cur <= endDt && count < 45) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
    count++;
  }
  return dates;
}

function formatDayHeader(isoDate: string, todayIso: string): string {
  const dt = new Date(`${isoDate}T00:00:00Z`);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  if (Number.isNaN(dt.getTime())) return isoDate;
  const label = `${days[dt.getUTCDay()]}, ${dt.getUTCDate()} ${months[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
  return isoDate === todayIso ? `${label} · Today` : label;
}

export function CalendarScreen({
  onSelectJob,
  onNavigateTab,
}: {
  onSelectJob: (job: JobAssignment) => void;
  onNavigateTab: (tab: "jobs" | "calendar" | "leave") => void;
}) {
  const [jobs, setJobs] = useState<JobAssignment[]>([]);
  const [leaveDays, setLeaveDays] = useState<ApprovedLeaveDayItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const todayIso = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const loadSchedule = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const [jobList, leaveRes] = await Promise.all([
        fetchJobs(),
        fetchLeaveData().catch(() => ({ requests: [], approvedDays: [] })),
      ]);
      setJobs(jobList);
      setLeaveDays(leaveRes.approvedDays);
    } catch {
      // keep existing state
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadSchedule();
  }, [loadSchedule]);

  // Group assignments and leave days by date
  const dayMap = new Map<
    string,
    { jobs: JobAssignment[]; leaveReason: string | null }
  >();

  for (const job of jobs) {
    const dates = expandAssignmentDates(job.workDate, job.endDate);
    for (const dt of dates) {
      const entry = dayMap.get(dt) || { jobs: [], leaveReason: null };
      entry.jobs.push(job);
      dayMap.set(dt, entry);
    }
  }

  for (const ld of leaveDays) {
    const entry = dayMap.get(ld.leaveDate) || { jobs: [], leaveReason: null };
    entry.leaveReason = ld.reason || "Approved leave";
    dayMap.set(ld.leaveDate, entry);
  }

  const sortedDates = Array.from(dayMap.keys()).sort();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.welcomeTitle}>My calendar</Text>
          <Text style={styles.techSubtitle}>
            Assigned jobs and approved leave by day
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
          style={[styles.tabButton, styles.tabButtonActive]}
          onPress={() => onNavigateTab("calendar")}
        >
          <Text style={[styles.tabText, styles.tabTextActive]}>2. My calendar</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.tabButton}
          onPress={() => onNavigateTab("leave")}
        >
          <Text style={styles.tabText}>3. Leave</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadSchedule(true)}
            tintColor={colors.ink}
          />
        }
      >
        {sortedDates.length === 0 ? (
          <Card>
            <Text style={styles.emptyTitle}>No scheduled days</Text>
            <Text style={styles.emptySubtitle}>
              Your assigned jobs and approved leave days will appear here by date.
            </Text>
          </Card>
        ) : (
          sortedDates.map((dt) => {
            const entry = dayMap.get(dt)!;
            const isToday = dt === todayIso;
            return (
              <Card
                key={dt}
                style={[styles.dayCard, isToday ? styles.todayCard : undefined]}
              >
                <View style={styles.dayHeader}>
                  <Text style={styles.dayTitle}>
                    {formatDayHeader(dt, todayIso)}
                  </Text>
                  <Text style={styles.dayIso}>{dt}</Text>
                </View>

                {entry.leaveReason && (
                  <View style={styles.leaveBox}>
                    <Status tone="wait">On leave</Status>
                    <Text style={styles.leaveText}>{entry.leaveReason}</Text>
                  </View>
                )}

                {entry.jobs.map((job) => (
                  <TouchableOpacity
                    key={`${dt}-${job.id}`}
                    style={styles.jobRow}
                    onPress={() => onSelectJob(job)}
                  >
                    <View style={styles.jobRowTop}>
                      <Text style={styles.jobNo}>{job.jobNo}</Text>
                      <View style={styles.methodBadges}>
                        {(job.testMethods.length > 0 ? job.testMethods : ["UT"]).map((m) => (
                          <Badge key={m} label={m} />
                        ))}
                      </View>
                    </View>
                    <Text style={styles.customerName}>{job.customerName}</Text>
                    {job.site ? (
                      <Text style={styles.siteText}>Site: {job.site}</Text>
                    ) : null}
                    {job.scope ? (
                      <Text style={styles.scopeText} numberOfLines={2}>
                        Scope: {job.scope}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                ))}
              </Card>
            );
          })
        )}
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
  dayCard: {
    marginBottom: spacing.md,
  },
  todayCard: {
    borderColor: colors.ink,
    borderWidth: 1.5,
  },
  dayHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.line2,
  },
  dayTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.ink,
  },
  dayIso: {
    ...typography.mono,
    fontSize: 11,
    color: colors.ink3,
  },
  leaveBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.xs,
    marginBottom: spacing.xs,
  },
  leaveText: {
    fontSize: 13,
    color: colors.ink2,
  },
  jobRow: {
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line2,
  },
  jobRowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 2,
  },
  jobNo: {
    ...typography.mono,
    fontWeight: "700",
  },
  methodBadges: {
    flexDirection: "row",
    gap: 4,
  },
  customerName: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.ink,
  },
  siteText: {
    ...typography.sub,
    marginTop: 2,
  },
  scopeText: {
    ...typography.caption,
    marginTop: 2,
  },
  emptyTitle: {
    ...typography.sectionTitle,
    marginBottom: spacing.xs,
  },
  emptySubtitle: {
    ...typography.sub,
  },
});
