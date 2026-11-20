import React, { useState, useEffect, useCallback } from "react";
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
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { colors, spacing, typography } from "../theme";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";
import { Status } from "../components/StatusDot";
import {
  acknowledgeJob,
  startWork,
  uploadSiteFile,
  fetchAssignmentFiles,
  fetchAssignmentNotes,
  submitAssignmentNote,
  ApiError,
} from "../api";
import type { JobAssignment, JobNoteItem, SiteFileItem, TestMethod } from "../types";

function defaultStandardForMethods(methods: TestMethod[]): string {
  const m = methods[0] || "UT";
  switch (m) {
    case "UT":
      return "ASME Sec V Art 4 / IS 3664";
    case "MPT":
      return "ASME Sec V Art 7 / IS 3703";
    case "DPT":
      return "ASME Sec V Art 6 / IS 3658";
    case "RT":
      return "ASME Sec V Art 2";
    case "VT":
      return "ASME Sec V Art 9";
    default:
      return "As per applicable NDT specification";
  }
}

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

  // 1. Files state
  const [files, setFiles] = useState<SiteFileItem[]>(job.attachments || []);
  const [fileCaption, setFileCaption] = useState("");
  const [uploadingFile, setUploadingFile] = useState(false);

  // 4. Notes state
  const [notes, setNotes] = useState<JobNoteItem[]>(job.jobNotes || []);
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const isCompleted = Boolean(currentJob.completedAt);
  const isStarted = Boolean(currentJob.startedAt);
  const isAcknowledged = Boolean(currentJob.acknowledgedAt);
  const isApproved = Boolean(
    currentJob.inspection?.isApproved || currentJob.inspection?.status === "approved"
  );
  const scheduledDateRange =
    currentJob.endDate && currentJob.endDate !== currentJob.workDate
      ? `${currentJob.workDate} to ${currentJob.endDate}`
      : currentJob.workDate;
  const activeMethods: TestMethod[] =
    currentJob.testMethods.length > 0 ? currentJob.testMethods : ["UT"];
  const displayStandard = currentJob.standard || defaultStandardForMethods(activeMethods);

  const refreshFilesAndNotes = useCallback(async () => {
    try {
      const [latestFiles, latestNotes] = await Promise.all([
        fetchAssignmentFiles(currentJob.id),
        fetchAssignmentNotes(currentJob.id),
      ]);
      setFiles(latestFiles);
      setNotes(latestNotes);
    } catch {
      // keep existing cached list if offline
    }
  }, [currentJob.id]);

  useEffect(() => {
    void refreshFilesAndNotes();
  }, [refreshFilesAndNotes]);

  async function handleTakePhoto() {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission needed", "Camera access is required to take site photos.");
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        quality: 0.8,
        allowsEditing: false,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setUploadingFile(true);
        const fileName = asset.fileName || `site_photo_${Date.now()}.jpg`;
        await uploadSiteFile(currentJob.id, {
          uri: asset.uri,
          name: fileName,
          type: asset.mimeType || "image/jpeg",
          caption: fileCaption.trim() || undefined,
          kind: "site_photo",
        });
        setFileCaption("");
        await refreshFilesAndNotes();
        Alert.alert("Uploaded", "Site photo uploaded to job " + currentJob.jobNo);
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Could not upload photo (max 6 MB).";
      Alert.alert("Upload failed", msg);
    } finally {
      setUploadingFile(false);
    }
  }

  async function handlePickFileFromPhone() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setUploadingFile(true);
        const fileName = asset.name || `site_file_${Date.now()}`;
        const mimeType = asset.mimeType || "application/octet-stream";
        const isImage = mimeType.startsWith("image/") || /\.(jpg|jpeg|png|webp|heic)$/i.test(fileName);
        await uploadSiteFile(currentJob.id, {
          uri: asset.uri,
          name: fileName,
          type: mimeType,
          caption: fileCaption.trim() || fileName,
          kind: isImage ? "site_photo" : "supporting_document",
        });
        setFileCaption("");
        await refreshFilesAndNotes();
        Alert.alert("Uploaded", `${fileName} uploaded to job ${currentJob.jobNo}`);
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Could not upload file (max 6 MB).";
      Alert.alert("Upload failed", msg);
    } finally {
      setUploadingFile(false);
    }
  }

  async function handleSaveNote() {
    if (!noteText.trim()) {
      Alert.alert("Note required", "Please enter a note or comment for the office.");
      return;
    }
    setSavingNote(true);
    try {
      await submitAssignmentNote(currentJob.id, noteText.trim());
      setNoteText("");
      await refreshFilesAndNotes();
      Alert.alert("Saved", "Note sent to the office for " + currentJob.jobNo);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to save note";
      Alert.alert("Error", msg);
    } finally {
      setSavingNote(false);
    }
  }

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
        {/* 1. FILES FOR THIS JOB (Priority #1 — no report needed) */}
        <Card>
          <Text style={styles.sectionTitle}>1. Files & photos for this job</Text>
          <Text style={styles.helperText}>
            Take a photo with the camera or upload any file from your phone (photos, PDFs, documents). The office sees these immediately on the job page.
          </Text>

          <TextInput
            style={styles.input}
            placeholder="Optional label / caption (e.g. Weld joint #3, Gate pass PDF)"
            placeholderTextColor={colors.ink3}
            value={fileCaption}
            onChangeText={setFileCaption}
          />

          <View style={styles.buttonStack}>
            <Button
              title={uploadingFile ? "Uploading…" : "Take photo with camera"}
              onPress={handleTakePhoto}
              loading={uploadingFile}
              style={styles.actionButton}
            />
            <Button
              title={uploadingFile ? "Uploading…" : "Upload file from phone (Photo / PDF / Doc)"}
              variant="secondary"
              onPress={handlePickFileFromPhone}
              loading={uploadingFile}
              style={styles.actionButton}
            />
          </View>

          {files.length > 0 && (
            <View style={styles.listSection}>
              <Text style={styles.listHeader}>Uploaded files ({files.length})</Text>
              {files.map((f) => (
                <View key={f.id} style={styles.fileRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fileName} numberOfLines={1}>
                      {f.caption || f.fileName.replace(/^\d+-/, "")}
                    </Text>
                    <Text style={styles.fileMeta}>
                      {f.kind.replace("_", " ")} · {f.uploadedAt.slice(0, 10)}
                    </Text>
                  </View>
                  <Badge label="Uploaded" />
                </View>
              ))}
            </View>
          )}
        </Card>

        {/* 2. SCOPE OF WORK ONLY (No quotation, no rates) */}
        <Card>
          <Text style={styles.sectionTitle}>2. Scope of work</Text>
          <Text style={styles.customerName}>{currentJob.customerName}</Text>
          <Text style={styles.detailItem}>
            <Text style={styles.detailLabel}>What to test (Scope): </Text>
            {currentJob.scope || "NDT Inspection"}
          </Text>
          <Text style={styles.detailItem}>
            <Text style={styles.detailLabel}>Where (Site): </Text>
            {currentJob.site || "At customer works"}
          </Text>
          <View style={styles.methodRow}>
            <Text style={styles.detailLabel}>Method: </Text>
            <View style={styles.badgeList}>
              {activeMethods.map((m) => (
                <Badge key={m} label={m} />
              ))}
            </View>
          </View>
          <Text style={[styles.detailItem, { marginTop: 4 }]}>
            <Text style={styles.detailLabel}>Standard: </Text>
            {displayStandard}
          </Text>
          <Text style={styles.detailItem}>
            <Text style={styles.detailLabel}>Scheduled date: </Text>
            {scheduledDateRange}
          </Text>
          {currentJob.notes ? (
            <Text style={styles.detailItem}>
              <Text style={styles.detailLabel}>Office instructions: </Text>
              {currentJob.notes}
            </Text>
          ) : null}
        </Card>

        {/* 3. NOTES & COMMENTS ON THIS JOB (Visible to office) */}
        <Card>
          <Text style={styles.sectionTitle}>3. Notes & comments for office</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Write a note or comment about site progress, components tested, or observations for the office..."
            placeholderTextColor={colors.ink3}
            multiline
            numberOfLines={3}
            value={noteText}
            onChangeText={setNoteText}
          />
          <Button
            title="Send note to office"
            variant="secondary"
            onPress={handleSaveNote}
            loading={savingNote}
            style={styles.actionButton}
          />

          {notes.length > 0 && (
            <View style={styles.listSection}>
              <Text style={styles.listHeader}>Notes on this job ({notes.length})</Text>
              {notes.map((n) => (
                <View key={n.id} style={styles.noteRow}>
                  <Text style={styles.noteBody}>{n.body}</Text>
                  <Text style={styles.fileMeta}>{n.receivedAt.slice(0, 16).replace("T", " ")}</Text>
                </View>
              ))}
            </View>
          )}
        </Card>

        {/* 4. ASSIGNED EQUIPMENT & JOB STATUS */}
        <Card>
          <Text style={styles.sectionTitle}>Assigned equipment & status</Text>
          <View style={styles.statusRow}>
            <Text style={styles.detailLabel}>Job status:</Text>
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

          {currentJob.equipment.length === 0 ? (
            <Text style={styles.emptyText}>No equipment assigned to this job.</Text>
          ) : (
            currentJob.equipment.map((eq) => (
              <View key={eq.id} style={styles.equipmentRow}>
                <View>
                  <Text style={styles.equipmentModel}>{eq.model || eq.kind}</Text>
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
        </Card>

        {/* 5. INSPECTION REPORT (Secondary, last) */}
        <Card>
          <Text style={styles.sectionTitle}>Inspection report (secondary)</Text>
          <Text style={styles.helperText}>
            Optional on site — you can fill or edit the technical report fields if needed.
          </Text>

          {isCompleted ? (
            <View style={styles.completedBox}>
              <Text style={styles.completedText}>
                {isApproved
                  ? "✓ Report approved by office — locked."
                  : "✓ Field report submitted — editable until office approval."}
              </Text>
              {activeMethods.map((m) => (
                <Button
                  key={m}
                  title={
                    isApproved
                      ? `View ${m} report (approved · locked)`
                      : `Edit ${m} report (submitted)`
                  }
                  variant="secondary"
                  onPress={() => onOpenReport(m)}
                  style={styles.actionButton}
                />
              ))}
            </View>
          ) : (
            <View style={styles.buttonStack}>
              {activeMethods.map((m) => (
                <Button
                  key={m}
                  title={`Fill ${m} inspection report`}
                  variant="secondary"
                  onPress={() => onOpenReport(m)}
                  style={styles.actionButton}
                />
              ))}
            </View>
          )}

          <Button
            title="Report a delay or site issue"
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
    fontSize: 17,
    fontWeight: "700",
    color: colors.ink,
    marginBottom: spacing.xs,
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
    marginBottom: 4,
  },
  helperText: {
    ...typography.caption,
    color: colors.ink2,
    marginBottom: spacing.sm,
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
    marginBottom: spacing.xs,
  },
  textArea: {
    minHeight: 72,
    textAlignVertical: "top",
  },
  listSection: {
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.line2,
    paddingTop: spacing.sm,
  },
  listHeader: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.ink2,
    marginBottom: spacing.xs,
  },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.line2,
  },
  fileName: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.ink,
  },
  fileMeta: {
    fontSize: 11,
    color: colors.ink3,
    marginTop: 2,
  },
  noteRow: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.line2,
  },
  noteBody: {
    fontSize: 13,
    color: colors.ink,
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
    marginBottom: spacing.sm,
  },
  actionButton: {
    marginTop: spacing.sm,
  },
  buttonStack: {
    gap: 4,
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
