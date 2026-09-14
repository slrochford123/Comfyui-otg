import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

const workerPath = path.join(
  repoRoot,
  "scripts/linux/otg-character-applio-training-worker.py",
);

function blockBetween(
  source: string,
  startMarker: string,
  endMarker: string,
) {
  const start = source.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);

  const end = source.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe("Applio held-out recovery", () => {
  it("only reuses a complete validated training artifact set", () => {
    const workerSource = fs.readFileSync(workerPath, "utf8");

    const helper = blockBetween(
      workerSource,
      "def recover_completed_training_artifacts(",
      "\ndef run_checkpoint_evaluation(",
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

    expect(helper).toMatch(
      /sample_rate\s*!=\s*48000/,
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

    expect(helper).toContain(
      '"checkpointCandidates": expected_candidates',
    );

    expect(helper).toContain(
      '"indexPath": str(source_index)',
    );

    expect(helper).toContain(
      '"sampleRate": sample_rate',
    );

    expect(helper).toContain(
      '"expectedEpochs": sorted(expected_epochs)',
    );
  });

  it("checks recovery before preprocessing or training", () => {
    const workerSource = fs.readFileSync(workerPath, "utf8");

    const body = blockBetween(
      workerSource,
      "def run_training_body(",
      "\ndef run_training(",
    );

    const recoveryProbe = body.indexOf(
      "recovery = recover_completed_training_artifacts(plan)",
    );

    const fallbackGate = body.indexOf(
      "if recovery is None:",
      recoveryProbe,
    );

    const prepareDataset = body.indexOf(
      "prepare_dataset(",
      fallbackGate,
    );

    const runCommand = body.indexOf(
      "run_command(",
      prepareDataset,
    );

    const normalCandidateDiscovery = body.indexOf(
      "checkpoint_candidates = discover_checkpoint_candidates(plan)",
      runCommand,
    );

    const recoveryCandidateReuse = body.indexOf(
      "checkpoint_candidates = list(",
      normalCandidateDiscovery,
    );

    const recoveryCandidateSource = body.indexOf(
      'recovery["checkpointCandidates"]',
      recoveryCandidateReuse,
    );

    const recoveryIndexReuse = body.indexOf(
      "source_index = Path(",
      recoveryCandidateReuse,
    );

    const recoveryIndexSource = body.indexOf(
      'recovery["indexPath"]',
      recoveryIndexReuse,
    );

    expect(recoveryProbe).toBeGreaterThanOrEqual(0);
    expect(fallbackGate).toBeGreaterThan(recoveryProbe);
    expect(prepareDataset).toBeGreaterThan(fallbackGate);
    expect(runCommand).toBeGreaterThan(prepareDataset);

    expect(normalCandidateDiscovery).toBeGreaterThan(
      runCommand,
    );

    expect(recoveryCandidateReuse).toBeGreaterThan(
      normalCandidateDiscovery,
    );

    expect(recoveryCandidateSource).toBeGreaterThan(
      recoveryCandidateReuse,
    );

    expect(recoveryIndexReuse).toBeGreaterThan(
      recoveryCandidateReuse,
    );

    expect(recoveryIndexSource).toBeGreaterThan(
      recoveryIndexReuse,
    );
  });

  it("marks completed-training reuse and joins the held-out evaluation path", () => {
    const workerSource = fs.readFileSync(workerPath, "utf8");

    const body = blockBetween(
      workerSource,
      "def run_training_body(",
      "\ndef run_training(",
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
      "Completed 48 kHz Applio training artifacts found;",
    );

    expect(body).toContain(
      "Skipping preprocess, feature extraction, and training;",
    );

    expect(body).toContain(
      "resuming at held-out evaluation.",
    );

    expect(body).toContain(
      '"currentStage": "training_artifacts_reused"',
    );

    expect(body).toContain(
      '"currentStage": "testing_voice_model"',
    );

    const reusedStage = body.indexOf(
      '"currentStage": "training_artifacts_reused"',
    );

    const testingStage = body.indexOf(
      '"currentStage": "testing_voice_model"',
      reusedStage,
    );

    const evaluatorCall = body.indexOf(
      "evaluation = run_checkpoint_evaluation(",
      testingStage,
    );

    const finalizingStage = body.indexOf(
      '"currentStage": "finalizing"',
      evaluatorCall,
    );

    expect(reusedStage).toBeGreaterThanOrEqual(0);
    expect(testingStage).toBeGreaterThan(reusedStage);
    expect(evaluatorCall).toBeGreaterThan(testingStage);
    expect(finalizingStage).toBeGreaterThan(
      evaluatorCall,
    );

    expect(workerSource).toContain(
      '"resumeFromCompletedTraining": bool(',
    );

    expect(workerSource).toContain(
      '"recoveredTrainingArtifacts": bool(',
    );

    expect(workerSource).toContain(
      '"recoveredCheckpointCount": int(',
    );

    expect(workerSource).toContain(
      '"recoveredCheckpointEpochs": (',
    );
  });
});
