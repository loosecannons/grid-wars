# GRID WARS — Docker image

> ## ⚠️ Disclaimer — untested, AI-generated software
>
> **This image and the software it contains were generated in their entirety by
> an AI and have not been reviewed, tested, or verified for correctness,
> security, or safety.** It is an experimental novelty with **no guarantee that
> it works** and is **not fit for any purpose**. It is provided **"AS IS", without
> warranty of any kind**, express or implied.
>
> **Use entirely at your own risk.** The authors and contributors accept **no
> liability** for any loss, damage, data loss, security incident, or other harm
> arising from its use. Do **not** deploy it in production or any environment
> where failure, downtime, or a vulnerability would matter. By pulling, running,
> or distributing this image you accept full responsibility for doing so.

A turn-based **TRON-themed hex strategy game** in 3D (three.js), with
single-player vs. the MCP and online multiplayer. This image serves the game
**and** runs the WebSocket multiplayer relay from a single container.

**Image:** [`loosecannons/grid-wars`](https://hub.docker.com/r/loosecannons/grid-wars)
· **Source:** https://github.com/loosecannons/grid-wars

![Modern render mode](https://raw.githubusercontent.com/loosecannons/grid-wars/main/docs/screenshots/01-modern-battle.jpg)

| Classic 16-bit | Light mode |
|:---:|:---:|
| ![Classic 16-bit render mode](https://raw.githubusercontent.com/loosecannons/grid-wars/main/docs/screenshots/02-classic-16bit.jpg) | ![Light workstation theme](https://raw.githubusercontent.com/loosecannons/grid-wars/main/docs/screenshots/03-light-mode.jpg) |

> ℹ️ The browser loads three.js and the Orbitron font from a CDN at runtime, so
> clients need internet access. Single-player and online multiplayer both run
> straight out of this one container.

## Quick start

```bash
docker run -d --name gridwars -p 8123:8123 loosecannons/grid-wars:latest
```

Then open **http://localhost:8123**.

Stop and remove it again with:

```bash
docker rm -f gridwars
```

## Tags

| Tag        | Description                          |
|------------|--------------------------------------|
| `latest`   | Most recent build                    |
| `1.2.1`    | Pinned release (recommended for prod)|
| `1.2.0`    | Previous release                     |

Pin a version for reproducible deploys: `loosecannons/grid-wars:1.2.1`.

## Configuration

| Variable      | Default | Purpose                                  |
|---------------|---------|------------------------------------------|
| `PORT`        | `8123`  | Port the server listens on (inside the container) |
| `NODE_ENV`    | `production` | Node environment                    |
| `PUBLIC_HOST` | _(auto)_ | Host/IP the lobby advertises in invite URLs + QR codes. Set this to the **host machine's LAN IP** (or domain) when running in Docker — the container's own IP isn't reachable from other devices. e.g. `-e PUBLIC_HOST=192.168.1.50`. |
| `MAPS_DIR`    | `/app/maps` | Where custom maps (from the in-game editor / SAVE MAP) are stored. Mount a volume here to keep them across container restarts. |

Persist custom maps with a volume:

```bash
docker run -d --name gridwars -p 8123:8123 \
  -v gridwars-maps:/app/maps loosecannons/grid-wars:latest
```

Run on a different host port (container still listens on 8123):

```bash
docker run -d --name gridwars -p 9000:8123 loosecannons/grid-wars:latest
# → http://localhost:9000
```

Or change the in-container port too:

```bash
docker run -d --name gridwars -e PORT=9000 -p 9000:9000 loosecannons/grid-wars:latest
```

## docker compose

```yaml
services:
  gridwars:
    image: loosecannons/grid-wars:latest
    container_name: gridwars
    ports:
      - "8123:8123"
    environment:
      - PORT=8123
    restart: unless-stopped
```

```bash
docker compose up -d
```

## Online multiplayer

The container runs the relay, so multiplayer works with no extra services:

1. Open the game, set up combatants, and press **OPEN LOBBY** (or, mid-game,
   **☰ MENU → INVITE / SPECTATE**).
2. Share the `?join=…` link (a friend takes an open faction) or the `?watch=…`
   link (spectators) shown in the lobby.

For friends outside your network, expose the host port publicly (reverse proxy,
tunnel, or a cloud host) so the join/watch URLs are reachable. WebSocket traffic
runs over the same port as the page, so no extra ports are needed. Behind TLS,
the client automatically uses `wss://`.

## Health & operations

The image ships a `HEALTHCHECK` (the container is healthy once the game is being
served) and runs as the non-root `node` user.

```bash
docker logs -f gridwars       # follow server logs
docker inspect --format '{{.State.Health.Status}}' gridwars
```

## Build it yourself

```bash
git clone https://github.com/loosecannons/grid-wars.git
cd grid-wars
docker build -t loosecannons/grid-wars:latest .
docker run -d -p 8123:8123 loosecannons/grid-wars:latest
```

## License

See [LICENSE](https://github.com/loosecannons/grid-wars/blob/main/LICENSE) in the
source repository.
