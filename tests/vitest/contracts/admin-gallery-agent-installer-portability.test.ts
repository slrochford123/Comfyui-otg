// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const installer = fs.readFileSync(
  path.join(
    root,
    "scripts/linux/admin-gallery-agent/install-test-agent.sh",
  ),
  "utf8",
);

const service = fs.readFileSync(
  path.join(
    root,
    "scripts/linux/admin-gallery-agent/otg-admin-gallery-agent.service",
  ),
  "utf8",
);

describe(
  "Linux Admin Gallery Agent installer portability",
  () => {
    it(
      "does not hard-code either Linux login in the service template",
      () => {
        expect(service).not.toContain(
          "User=slrochford123",
        );

        expect(service).not.toContain(
          "User=shawn-rochford",
        );

        expect(service).toContain(
          "User=__OTG_ADMIN_GALLERY_USER__",
        );

        expect(service).toContain(
          "Group=__OTG_ADMIN_GALLERY_GROUP__",
        );
      },
    );

    it(
      "does not hard-code a GPU output directory in ReadWritePaths",
      () => {
        expect(service).toContain(
          "ReadWritePaths=__OTG_ADMIN_GALLERY_ROOT__",
        );

        expect(service).not.toContain(
          "ReadWritePaths=/opt/ComfyUI/output",
        );

        expect(service).not.toContain(
          "ReadWritePaths=/home/shawn-rochford",
        );
      },
    );

    it(
      "derives the service identity and configured root at start time",
      () => {
        expect(installer).toContain(
          "caller_user()",
        );

        expect(installer).toContain(
          "id -gn \"$service_user\"",
        );

        expect(installer).toContain(
          "env_value OTG_ADMIN_GALLERY_AGENT_ROOT",
        );

        expect(installer).toContain(
          "configured gallery root does not exist",
        );
      },
    );

    it(
      "renders the checked-in template instead of directly installing it",
      () => {
        expect(installer).toContain(
          "otg-admin-gallery-agent.service.template",
        );

        expect(installer).toContain(
          "__OTG_ADMIN_GALLERY_USER__",
        );

        expect(installer).toContain(
          "__OTG_ADMIN_GALLERY_GROUP__",
        );

        expect(installer).toContain(
          "__OTG_ADMIN_GALLERY_ROOT__",
        );

        expect(installer).toContain(
          "sudo systemctl daemon-reload",
        );
      },
    );

    it(
      "preserves the existing environment file during install",
      () => {
        expect(installer).toContain(
          'if [[ ! -e "$ENV_FILE" ]]',
        );

        expect(installer).toContain(
          "Preserved existing",
        );
      },
    );
  },
);
