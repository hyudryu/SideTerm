# SideTerm bridge for DeepSeek Harness

This optional Harness bundle exposes live agent metadata, `session/event` notifications, and semantic `followup` / `steer` / `inject` delivery to SideTerm over an authenticated loopback HTTP bridge.

Install it into the same Harness profile you run:

```sh
dsh plugin --profile demo add ./plugins/dsh-sideterm-bridge
```

Then override the bridge row in that profile's `cordis.patch.yml` with a random token of at least 24 characters (an id-targeted override replaces the whole config, so keep all three fields):

```yaml
- id: sideterm-bridge
  config:
    host: 127.0.0.1
    port: 43111
    token: replace-with-a-random-secret-at-least-24-characters-long
```

Enter the matching endpoint and token in SideTerm Settings. The bridge deliberately refuses non-loopback hosts.

SideTerm never types ordinary instructions into a Harness PTY. It calls the public Agent methods through this bridge. Terminal/TUI input remains a separate fallback for non-Harness sessions.
