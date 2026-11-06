import React, { useEffect, useState } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { colors } from "./src/theme";
import { getStoredCredentials } from "./src/storage";
import { PairScreen } from "./src/screens/PairScreen";
import { JobsScreen } from "./src/screens/JobsScreen";
import { JobDetailScreen } from "./src/screens/JobDetailScreen";
import { ReportScreen } from "./src/screens/ReportScreen";
import { ProblemScreen } from "./src/screens/ProblemScreen";
import type { JobAssignment, TestMethod } from "./src/types";

type Screen =
  | { name: "pair" }
  | { name: "jobs" }
  | { name: "detail"; job: JobAssignment }
  | { name: "report"; job: JobAssignment; method: TestMethod }
  | { name: "problem"; job?: JobAssignment };

export default function App() {
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState<Screen>({ name: "pair" });

  useEffect(() => {
    async function checkAuth() {
      try {
        const creds = await getStoredCredentials();
        if (creds) {
          setScreen({ name: "jobs" });
        } else {
          setScreen({ name: "pair" });
        }
      } catch {
        setScreen({ name: "pair" });
      } finally {
        setLoading(false);
      }
    }
    checkAuth();
  }, []);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.ink} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />

      {screen.name === "pair" && (
        <PairScreen onPaired={() => setScreen({ name: "jobs" })} />
      )}

      {screen.name === "jobs" && (
        <JobsScreen
          onSelectJob={(job) => setScreen({ name: "detail", job })}
          onUnlink={() => setScreen({ name: "pair" })}
        />
      )}

      {screen.name === "detail" && (
        <JobDetailScreen
          job={screen.job}
          onBack={() => setScreen({ name: "jobs" })}
          onOpenReport={(method) => setScreen({ name: "report", job: screen.job, method })}
          onReportProblem={() => setScreen({ name: "problem", job: screen.job })}
          onJobUpdated={(updated) => setScreen({ name: "detail", job: updated })}
        />
      )}

      {screen.name === "report" && (
        <ReportScreen
          job={screen.job}
          method={screen.method}
          onBack={() => setScreen({ name: "detail", job: screen.job })}
          onSubmitted={() => setScreen({ name: "jobs" })}
        />
      )}

      {screen.name === "problem" && (
        <ProblemScreen
          job={screen.job}
          onBack={() => {
            if (screen.job) setScreen({ name: "detail", job: screen.job });
            else setScreen({ name: "jobs" });
          }}
          onSubmitted={() => {
            if (screen.job) setScreen({ name: "detail", job: screen.job });
            else setScreen({ name: "jobs" });
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
  },
});
