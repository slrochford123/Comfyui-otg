import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

const workerPath = path.join(
  repoRoot,
  "scripts/linux/otg-character-applio-training-worker.py",
);

describe(
  "Voice Characters strict completed-training recovery",
  () => {
    it(
      "requires the complete checkpoint schedule, valid index, and 48 kHz config before skipping training",
      () => {
        const source = fs.readFileSync(
          workerPath,
          "utf8",
        );

        if (
          !source.includes(
            'data_config.get("sample_rate")',
          ) ||
          !source.includes(
            "expected_epochs.issubset",
          ) ||
          !source.includes(
            '"resumeFromCompletedTraining": True',
          )
        ) {
          throw new Error(
            "RED_EXPECTED_STRICT_COMPLETED_TRAINING_GATE_MISSING",
          );
        }

        const helperStart = source.indexOf(
          "def recover_completed_training_artifacts(",
        );

        const helperEnd = source.indexOf(
          "\ndef run_checkpoint_evaluation(",
          helperStart,
        );

        expect(helperStart).toBeGreaterThanOrEqual(0);
        expect(helperEnd).toBeGreaterThan(helperStart);

        const helper = source.slice(
          helperStart,
          helperEnd,
        );

        expect(helper).toContain(
          "discover_checkpoint_candidates(plan)",
        );

        expect(helper).toContain(
          "discover_trained_index(plan)",
        );

        expect(helper).toContain(
          'config.get("data")',
        );

        expect(helper).toContain(
          'data_config.get("sample_rate")',
        );

        expect(helper).toContain(
          "sample_rate != 48000",
        );

        expect(helper).toContain(
          'plan.get("epochs")',
        );

        expect(helper).toContain(
          'plan.get("saveEveryEpoch")',
        );

        expect(helper).toContain(
          "expected_epochs = set(",
        );

        expect(helper).toContain(
          "expected_epochs.add(epochs)",
        );

        expect(helper).toMatch(
          /expected_epochs\.issubset\(\s*candidate_epochs\s*\)/,
        );

        expect(helper).toContain(
          "has_bytes(Path(path_value))",
        );

        const bodyStart = source.indexOf(
          "def run_training_body(",
        );

        const bodyEnd = source.indexOf(
          "\ndef run_training(",
          bodyStart,
        );

        const body = source.slice(
          bodyStart,
          bodyEnd,
        );

        expect(body).toContain(
          "recovery = recover_completed_training_artifacts(plan)",
        );

        expect(body).toContain(
          '"resumeFromCompletedTraining": True',
        );

        expect(body).toContain(
          '"trainingCommandsSkippedOnResume"',
        );

        expect(body).toContain(
          '"resumeEvidence"',
        );

        expect(body).toContain(
          "Skipping preprocess, feature extraction, and training",
        );

        expect(body).toContain(
          '"currentStage": "training_artifacts_reused"',
        );

        expect(body).toContain(
          '"currentStage": "testing_voice_model"',
        );
      },
    );
  },
);
