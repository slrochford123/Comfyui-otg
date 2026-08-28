function applyLiveSchemaDefaults(workflow: any) {
  const nodes = workflow;

  const safe = (id: string) => nodes?.[id]?.inputs;

  // 441 / 442
  if (safe("441")) safe("441").values = { a: safe("441").values?.a ?? 1 };
  if (safe("442")) safe("442").values = { a: safe("442").values?.a ?? 1 };

  // 410 resize
  if (safe("410")) {
    safe("410").resize_type = {
      crop: "center",
      width: safe("410").resize_type?.width ?? 1280,
      height: safe("410").resize_type?.height ?? 720,
    };
  }

  // 409 compression
  if (safe("409")) {
    safe("409").img_compression = safe("409").img_compression ?? 95;
  }

  // 437 / 383
  if (safe("437")) {
    safe("437").start_index = safe("437").start_index ?? 0;
    safe("437").bypass = safe("437").bypass ?? false;
  }

  if (safe("383")) {
    safe("383").start_index = safe("383").start_index ?? 0;
  }

  // 412 bypass
  if (safe("412")) {
    safe("412").bypass = safe("412").bypass ?? false;
  }

  // 366 temporal (CRITICAL)
  if (safe("366")) {
    safe("366").tile_size = safe("366").tile_size ?? 64;
    safe("366").temporal_size = Math.max(8, safe("366").temporal_size ?? 8);
    safe("366").temporal_overlap = safe("366").temporal_overlap ?? 4;
  }

  return workflow;
}