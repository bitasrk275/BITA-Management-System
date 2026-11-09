import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { colors, spacing, typography } from "../theme";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import {
  fetchReportTemplate,
  submitReport,
  uploadPhoto,
  ApiError,
} from "../api";
import { getDraftReport, saveDraftReport } from "../storage";
import type {
  JobAssignment,
  TestMethod,
  ReportTemplate,
} from "../types";

export function ReportScreen({
  job,
  method,
  onBack,
  onSubmitted,
}: {
  job: JobAssignment;
  method: TestMethod;
  onBack: () => void;
  onSubmitted: () => void;
}) {
  const [template, setTemplate] = useState<ReportTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [readings, setReadings] = useState<Record<string, string>>({});
  const [observations, setObservations] = useState("");
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoCount, setPhotoCount] = useState(0);
  const [submittedLocally, setSubmittedLocally] = useState(false);
  const [lockedLocally, setLockedLocally] = useState(false);

  // Per Phase 2 / A1: Report is locked ONLY when approved by office.
  // Submitted reports remain editable until approval.
  const isApproved = Boolean(
    job.inspection?.isApproved ||
    job.inspection?.status === "approved" ||
    lockedLocally
  );

  const isSubmitted = Boolean(
    job.inspection?.submittedAt ||
    job.inspection?.status === "submitted" ||
    submittedLocally
  );

  // Load template and saved draft
  useEffect(() => {
    async function init() {
      try {
        const [tpl, savedDraft] = await Promise.all([
          fetchReportTemplate(method),
          getDraftReport(job.id),
        ]);
        setTemplate(tpl);

        if (savedDraft) {
          setReadings((savedDraft as Record<string, string>) || {});
        } else if (job.inspection?.readings) {
          setReadings((job.inspection.readings as Record<string, string>) || {});
        } else {
          // Pre-fill default shared fields, booked equipment, and remembered customer defaults (BITA UT Report Fields spec)
          const firstEq = job.equipment?.[0];
          const eqCalStr = firstEq?.calibrationDue
            ? `Valid Upto ${firstEq.calibrationDue}`
            : "";
          setReadings({
            ...(tpl.rememberedDefaults || {}),
            client: job.customerName,
            project: job.scope || "",
            inspection_site: job.site || "Works",
            inspection_date: job.workDate,
            ...(firstEq?.model ? { equipment: firstEq.model } : {}),
            ...(firstEq?.serialNo ? { equipment_serial: firstEq.serialNo } : {}),
            ...(eqCalStr ? { equipment_calibration: eqCalStr } : {}),
          });
        }

        if (job.inspection?.observations) {
          setObservations(job.inspection.observations);
        }
      } catch {
        Alert.alert("Error", "Could not load report template for " + method);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [job, method]);

  function handleFieldChange(key: string, value: string) {
    if (isApproved) return;
    setReadings((prev) => ({ ...prev, [key]: value }));
    setMissingFields((prev) => prev.filter((k) => k !== key));
  }

  async function handleSaveDraft() {
    if (isApproved) return;
    setSubmitting(true);
    try {
      await saveDraftReport(job.id, readings);
      const res = await submitReport(job.id, {
        method,
        readings,
        observations,
        draft: true,
      });
      setMissingFields(res.missingFields || []);
      Alert.alert("Draft saved", "Your inspection draft has been saved locally and on the server.");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setLockedLocally(true);
        Alert.alert("Report Approved & Locked", err.message);
        return;
      }
      const msg = err instanceof ApiError ? err.message : "Failed to save draft";
      Alert.alert("Error", msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmitFinal() {
    if (isApproved) return;
    setSubmitting(true);
    try {
      const res = await submitReport(job.id, {
        method,
        readings,
        observations,
        draft: false,
      });

      if (res.missingFields && res.missingFields.length > 0) {
        setMissingFields(res.missingFields);
        Alert.alert(
          "Missing Required Fields",
          `Please fill in all required readings before submitting:\n• ${res.missingFields.join("\n• ")}`,
        );
        return;
      }

      setSubmittedLocally(true);
      Alert.alert(
        isSubmitted ? "Corrections Submitted" : "Report Submitted",
        isSubmitted
          ? "Your updated inspection corrections have been submitted. The office has been notified."
          : "Your report has been submitted to the office for technical review.",
        [{ text: "OK", onPress: onSubmitted }],
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setLockedLocally(true);
        Alert.alert("Report Approved & Locked", err.message);
        return;
      }
      const msg = err instanceof ApiError ? err.message : "Failed to submit report";
      Alert.alert("Error", msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddPhoto() {
    if (isApproved) return;
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission needed", "Camera access is required to photograph inspection items.");
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        quality: 0.8,
        allowsEditing: false,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setPhotoUploading(true);

        const fileName = asset.fileName || `site_photo_${Date.now()}.jpg`;
        await uploadPhoto(job.id, {
          uri: asset.uri,
          name: fileName,
          type: "image/jpeg",
          caption: "Field inspection photograph",
          kind: "site_photo",
        });

        setPhotoCount((c) => c + 1);
        Alert.alert("Success", "Photo uploaded and attached to job.");
      }
    } catch {
      Alert.alert("Upload failed", "Could not upload photo. Check connection and file size (max 6 MB).");
    } finally {
      setPhotoUploading(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.ink} />
          <Text style={styles.loadingText}>Loading {method} template...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>{isApproved || isSubmitted ? "← Back" : "← Cancel"}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{method} Report Form</Text>
        {!isApproved ? (
          <TouchableOpacity onPress={handleSaveDraft} disabled={submitting}>
            <Text style={styles.saveDraftText}>Save draft</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 60 }} />
        )}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {isApproved ? (
          <View style={styles.lockedBanner}>
            <Text style={styles.lockedBannerTitle}>✓ Approved · Report Locked</Text>
            <Text style={styles.lockedBannerText}>
              This report has been approved by the office technical reviewer and is locked. Contact the office if further changes are required.
            </Text>
          </View>
        ) : isSubmitted ? (
          <View style={styles.submittedBanner}>
            <Text style={styles.submittedBannerTitle}>✓ Submitted for Office Review (Editable)</Text>
            <Text style={styles.submittedBannerText}>
              Your report is waiting for technical review. You can make corrections and update readings until it is approved. Changes will be logged and notified to the office.
            </Text>
          </View>
        ) : null}

        <Card>
          <Text style={styles.jobBadge}>{job.jobNo} · {job.customerName}</Text>
          <Text style={styles.sectionTitle}>Inspection Details & Parameters</Text>

          {template?.fields.map((f) => {
            const isMissing = missingFields.includes(f.key);
            const val = readings[f.key] || "";
            const options =
              f.options && f.options.length > 0
                ? f.options
                : f.listKey && template?.dropdownOptions?.[f.listKey]
                  ? template.dropdownOptions[f.listKey]
                  : undefined;

            return (
              <View key={f.key} style={styles.fieldGroup}>
                <View style={styles.labelRow}>
                  <Text style={[styles.fieldLabel, isMissing && styles.missingLabel]}>
                    {f.label} {f.required ? "*" : "(optional)"}
                  </Text>
                  {isMissing && <Text style={styles.missingHint}>Required</Text>}
                </View>

                {options && options.length > 0 && !isApproved ? (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ marginBottom: 6 }}
                  >
                    {options.map((opt) => {
                      const active = val === opt;
                      return (
                        <TouchableOpacity
                          key={opt}
                          onPress={() => handleFieldChange(f.key, opt)}
                          style={{
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            borderRadius: 6,
                            borderWidth: 1,
                            borderColor: active ? colors.ink : colors.line,
                            backgroundColor: active ? colors.ink : colors.surface,
                            marginRight: 6,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 12,
                              color: active ? "#ffffff" : colors.ink,
                              fontWeight: active ? "600" : "400",
                            }}
                          >
                            {opt}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                ) : null}

                <TextInput
                  style={[
                    styles.textInput,
                    f.input === "textarea" && styles.textarea,
                    isMissing && styles.missingInput,
                    isApproved && styles.readOnlyInput,
                  ]}
                  value={val}
                  placeholder={
                    isApproved
                      ? "Not specified"
                      : options && options.length > 0
                        ? `Tap an option above or type custom (Others)...`
                        : `Enter ${f.label.toLowerCase()}`
                  }
                  placeholderTextColor={colors.ink3}
                  multiline={f.input === "textarea"}
                  numberOfLines={f.input === "textarea" ? 3 : 1}
                  keyboardType={f.input === "number" ? "numeric" : "default"}
                  onChangeText={(text) => handleFieldChange(f.key, text)}
                  editable={!isApproved}
                />
              </View>
            );
          })}
        </Card>

        {/* Observations Card */}
        <Card>
          <Text style={styles.sectionTitle}>General Observations / Remarks</Text>
          <TextInput
            style={[
              styles.textInput,
              styles.textarea,
              isApproved && styles.readOnlyInput,
            ]}
            placeholder={isApproved ? "No observations recorded." : "Record any general test remarks, discontinuities observed, or component surface notes..."}
            placeholderTextColor={colors.ink3}
            multiline
            numberOfLines={4}
            value={observations}
            onChangeText={setObservations}
            editable={!isApproved}
          />
        </Card>

        {/* Photos & Attachments Card */}
        <Card>
          <View style={styles.cardHeader}>
            <Text style={styles.sectionTitle}>Photos ({photoCount} attached)</Text>
          </View>
          <Text style={styles.photoHint}>
            {isApproved
              ? "Inspection photos and drawings attached to this job."
              : "Take site photos, weld defect images or drawing snapshots (max 6 MB per file)."}
          </Text>

          {!isApproved && (
            <Button
              title={photoUploading ? "Uploading photo..." : "📷 Take photo with camera"}
              variant="secondary"
              onPress={handleAddPhoto}
              loading={photoUploading}
              style={styles.photoButton}
            />
          )}
        </Card>

        {/* Action Buttons */}
        <View style={styles.buttonStack}>
          {isApproved ? (
            <Button
              title="← Return to job details"
              variant="secondary"
              onPress={onBack}
            />
          ) : (
            <>
              <Button
                title={isSubmitted ? "Resubmit corrections to office" : "Submit final report to office"}
                onPress={handleSubmitFinal}
                loading={submitting}
              />

              <Button
                title="Save draft"
                variant="secondary"
                onPress={handleSaveDraft}
                disabled={submitting}
              />
            </>
          )}
        </View>
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
    color: colors.ink2,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.ink,
  },
  saveDraftText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.ink,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: spacing.md,
    ...typography.sub,
  },
  content: {
    padding: spacing.lg,
  },
  jobBadge: {
    ...typography.caption,
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    ...typography.sectionTitle,
    marginBottom: spacing.md,
  },
  fieldGroup: {
    marginBottom: spacing.md,
  },
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.ink2,
  },
  missingLabel: {
    color: colors.bad,
  },
  missingHint: {
    fontSize: 12,
    color: colors.bad,
    fontWeight: "500",
  },
  textInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
    color: colors.ink,
    minHeight: 44,
  },
  textarea: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  missingInput: {
    borderColor: colors.bad,
    backgroundColor: colors.bad + "08",
  },
  readOnlyInput: {
    backgroundColor: colors.line2,
    borderColor: colors.line,
    color: colors.ink2,
  },
  submittedBanner: {
    backgroundColor: colors.ok + "15",
    borderWidth: 1,
    borderColor: colors.ok,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  submittedBannerTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.ok,
    marginBottom: 4,
  },
  submittedBannerText: {
    fontSize: 13,
    color: colors.ink,
    lineHeight: 18,
  },
  lockedBanner: {
    backgroundColor: colors.ink + "10",
    borderWidth: 1,
    borderColor: colors.ink3,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  lockedBannerTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.ink,
    marginBottom: 4,
  },
  lockedBannerText: {
    fontSize: 13,
    color: colors.ink2,
    lineHeight: 18,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  photoHint: {
    ...typography.caption,
    marginBottom: spacing.md,
  },
  photoButton: {
    marginBottom: spacing.xs,
  },
  buttonStack: {
    gap: 10,
    marginTop: spacing.md,
    marginBottom: spacing.xxl,
  },
});
