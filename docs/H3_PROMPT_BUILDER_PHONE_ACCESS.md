# Standalone H3 Prompt Builder phone access

The development service on port 8785 is the dependency-free Python server in
`/home/shawn-rochford/AI/Hailuo-H3-Prompt-Builder-Standalone/server.py`. The
installed systemd unit currently starts it without `--phone-access`, so it binds
only to `127.0.0.1`.

The server already supports an explicit `--phone-access` switch, which binds to
`0.0.0.0`. It has no login: any device allowed through the host firewall can use
the builder and see its shared local prompt history. It must not be exposed to
the public internet.

For trusted Tailscale-only development access, use a systemd drop-in that adds
`--phone-access`, then restrict TCP 8785 to the Tailscale interface in the host
firewall. On this host the current Tailscale URL is
`http://100.75.162.64:8785/`; the address should be rechecked with
`tailscale ip -4` before use.

Example drop-in content (do not apply it on an untrusted host):

```ini
[Service]
ExecStart=
ExecStart=/usr/bin/python3 /home/shawn-rochford/AI/Hailuo-H3-Prompt-Builder-Standalone/server.py --port 8785 --phone-access
```

After installing the drop-in, reload systemd, allow inbound TCP 8785 only on
`tailscale0` using the host's firewall tooling, restart the service, and verify
`/api/status` reports phone access enabled. Reverting the drop-in restores the
loopback-only default. LAN access can use the same opt-in mode, but is not
recommended because this service has no authentication.
