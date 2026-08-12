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
