# Linux Admin Gallery Agent

Authenticated read-through access to one configured ComfyUI output directory.

Required environment variables are loaded from:

    /etc/otg/admin-gallery-agent.env

Configuration:

    OTG_ADMIN_GALLERY_AGENT_ROOT=/absolute/comfy/output/path
    OTG_ADMIN_GALLERY_AGENT_BIND=<private-or-tailscale-ip>
    OTG_ADMIN_GALLERY_AGENT_PORT=8798
    OTG_ADMIN_GALLERY_AGENT_TOKEN=<strong-random-token>

For slr / RTX 5060 Ti the intended root is:

    /mnt/otg_fast/comfyui/output

For shawn / RTX 3090 the intended root is:

    /home/shawn-rochford/AI/ComfyUI/ComfyUI/output

The web application can independently configure either GPU source as
a local filesystem source or an authenticated remote-agent source.

Do not expose the agent publicly. Bind it only to the required private
or Tailscale address. Never commit a real token.

## Portable systemd installation

`install-test-agent.sh` is retained as the installer filename for compatibility, but its generated service is no longer TEST- or machine-specific.

The `install` action copies the Python agent and service template but does not start the service. It preserves an existing `/etc/otg/admin-gallery-agent.env`.

The `start` action:

1. reads `OTG_ADMIN_GALLERY_AGENT_ROOT` from `/etc/otg/admin-gallery-agent.env`;
2. verifies the root is an existing absolute directory;
3. derives the Linux service user/group from the user invoking the installer;
4. renders the systemd unit with that exact user, group, and root;
5. enables and starts the service.

This allows the same checked-in agent to run as:

- `slrochford123` on `slr` with `/mnt/otg_fast/comfyui/output`; or
- `shawn-rochford` on `shawn` with `/home/shawn-rochford/AI/ComfyUI/ComfyUI/output`.

Do not run `start` until the environment file has been reviewed and contains a real private/Tailscale bind address and a strong token.
