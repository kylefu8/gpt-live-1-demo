# Deployment

[简体中文](DEPLOYMENT.zh-CN.md) | English

Choose the path that matches the person using the application:

- Windows end users: download the release ZIP and run `Start.cmd`.
- Developers: run the Node.js service directly.
- A local container: use `compose.yml`.
- A shared server: use `compose.remote.yml` behind HTTPS.
- Render: use `render.yaml` as a starting template and verify the resulting service.

## Windows release

The public `v0.2.1` Windows x64 release includes the official Node.js 24 runtime.

1. Download the complete ZIP from [GitHub Releases](https://github.com/kylefu8/gpt-live-1-demo/releases/latest).
2. Extract it without separating `Start.cmd`, `runtime`, or `app`.
3. Double-click `Start.cmd`.
4. Open the setup page if it does not open automatically.
5. Enter and test the live voice service, optionally enter and test the reasoning backend, test the microphone and playback device, then save.

No Node.js installation or `.env` editing is needed for this path. The application stores settings under the operating system's application data directory.

## Node.js development

Use Node.js 22 or newer:

```text
npm ci
npm start
```

To keep the browser closed and run only the server:

```text
npm run start:server
```

The default local address is <http://127.0.0.1:8767/>. Local mode accepts configuration through the browser wizard and binds to the loopback interface unless explicitly run with the supplied local-network container settings.

## Local Docker

Build and start the local container:

```text
docker compose -f compose.yml up --build
```

Open <http://127.0.0.1:8767/> and finish the wizard. The compose file uses the named volume `gpt-live-1-demo-data` for `/data`.

Stop the service with:

```text
docker compose -f compose.yml down
```

Keep the volume when you want to keep settings. Removing the volume removes the saved settings and credentials.

## Remote Docker server

Use a private server directory and create `.env` from `.env.example`. Set at least:

```dotenv
APP_MODE=remote
HOST=0.0.0.0
PORT=8767
APP_DATA_DIR=/data
PUBLIC_ORIGIN=https://voice.example.com
SETUP_TOKEN=replace-with-a-long-random-value
```

Start the service:

```text
docker compose -f compose.remote.yml up -d --build
```

Put a reverse proxy in front of port `8767` and terminate TLS there. The proxy must forward normal HTTP requests and WebSocket upgrades. `PUBLIC_ORIGIN` must be the HTTPS origin users open, including the scheme and without a path.

Check the service before opening the setup page:

```text
curl --fail https://voice.example.com/api/health
```

On the first remote visit, enter `SETUP_TOKEN`. The application then asks for an administrator password of at least 10 characters. Later visits use that password. The setup token and password protect the settings and session endpoints; they do not replace the API keys entered in the wizard.

The named volume keeps `/data` across container restarts. The settings file contains the API keys as plain text so the server can use them. It is written with mode `0600` where supported; protect the volume and its backups with the server account's filesystem permissions.

## Render

The repository's `render.yaml` creates a Docker Web Service with a `/data` persistent disk and a generated setup token. Render's template uses a paid Starter service and a persistent disk; review current pricing in Render before creating it.

This repository does not claim that the template has been live deployed. After the service is created, confirm its HTTPS origin, set `PUBLIC_ORIGIN` for a custom domain, obtain the setup token from the deployment environment/logs, and run the complete setup and microphone checks.

## Environment variables

The browser wizard is preferred for ordinary users. These variables are useful for automation:

| Variable | Purpose |
| --- | --- |
| `LIVE_PROVIDER` | Live voice service type (`azure` or `compatible`). |
| `LIVE_BASE_URL` | HTTPS API root for the live voice service. |
| `LIVE_API_KEY` | API key read only by the server. |
| `LIVE_MODEL` | Live voice deployment or model name. |
| `REASONING_BASE_URL` | Optional Responses-compatible API root. |
| `REASONING_API_KEY` | Optional reasoning key read only by the server. |
| `REASONING_MODEL` | Optional reasoning model or deployment name. |
| `REASONING_AUTH` | Optional backend authentication mode (`bearer` or `api-key`). |
| `APP_MODE` | `local` or `remote`. |
| `HOST`, `PORT` | Listen address and port. |
| `APP_DATA_DIR` | Settings and application data directory. |
| `PUBLIC_ORIGIN` | Required HTTPS origin in remote mode. |
| `SETUP_TOKEN` | Initial remote setup token. |

The service removes trailing API paths when saving a URL and rejects URLs that contain credentials or unsafe query parameters. Do not put a key in a URL.

## Data location and privacy

If `APP_DATA_DIR` is not set, the default is:

- Windows: `%LOCALAPPDATA%\GPTLiveDemo`
- macOS: `~/Library/Application Support/GPTLiveDemo`
- Linux: `$XDG_CONFIG_HOME/gpt-live-demo` or `~/.config/gpt-live-demo`

The server does not return complete API keys to the browser, and its user-facing errors redact configured secrets. Keep the data directory, `.env`, setup token, and backups private. The public repository and Windows release do not contain your personal settings.

## Troubleshooting

- **The microphone list is empty:** allow microphone access, reload the setup page, and run the microphone test before connecting.
- **A voice or backend test returns 401/403:** check that the key belongs to the endpoint and has permission for the named deployment.
- **A test returns 404:** use the deployment/model name shown by the service console and enter the HTTPS API root, not a browser page URL.
- **Only voice and time answers work:** the optional reasoning backend was skipped or failed its test. Save a valid backend configuration and reconnect.
- **A remote browser cannot use the microphone:** open the service through HTTPS and check the browser's site permission. Plain HTTP on a remote host is not sufficient.
- **The port is busy:** stop the previous process or set another `PORT`, then open the matching local address.
