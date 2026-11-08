# Hosting V-Track Pro in Ghana

Written for one server running the whole stack with Docker. It is a guide, not a quote: **hosting prices and the final
provider choice need the client's own quotes.**

## 1. Where to host

| Option | Good for | Watch out for |
|---|---|---|
| **A Ghana colocation or cloud provider with a data centre in Accra** (for example MainOne's MDXi Accra facility, opened in 2021, or any local provider that gives you a Linux VPS) | Lowest delay to riders, hub managers and the SIM-based trackers; data stays in the country | Ask for: a fixed public IPv4 address, TCP ports 80/443 and 5023/5040/5050 open, daily snapshots, and a written uptime commitment |
| A European or other overseas VPS | Cheapest and easiest to start | Mobile-data round trips from Ghana add delay; see section 6 on personal data |

Start small: **2 vCPU, 4 GB RAM, 60 GB SSD** is enough for the pilot (a few hubs, tens of vehicles). Raise it when
position data grows; the tracking database is the part that grows fastest.

## 2. Prepare the server (Ubuntu 22.04 or 24.04)
```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git ufw
sudo ufw allow 22 && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw allow 5023 && sudo ufw allow 5040 && sudo ufw allow 5050
sudo ufw enable
sudo timedatectl set-timezone Africa/Accra
```
Point a DNS record (for example `track.yourcompany.com.gh`) at the server's IP **before** the first start; the web server
fetches its HTTPS certificate on its own once the name resolves.

## 3. Secrets
```bash
sudo mkdir -p /etc/vtrack /var/backups/vtrack && sudo chmod 700 /etc/vtrack
openssl rand -base64 36 | sudo tee /etc/vtrack/backup.pass >/dev/null && sudo chmod 600 /etc/vtrack/backup.pass
cp ops/.env.production.example ops/.env.production      # fill in every value
openssl rand -hex 32     # run once for each of: JWT_SECRET, JWT_REFRESH_SECRET, FIELD_ENCRYPTION_KEY
```
**Store three things somewhere that is not this server** (a password manager and a printed copy in a safe are both fine):
`FIELD_ENCRYPTION_KEY`, `/etc/vtrack/backup.pass`, and the database passwords. Without the first, owners' and riders'
encrypted Ghana Card and mobile money numbers are unrecoverable; without the second, no backup can be opened.
The API refuses to start in production if any secret is missing or weak.

## 4. First start
```bash
docker compose -f ops/docker-compose.prod.yml --env-file ops/.env.production up -d --build
docker compose -f ops/docker-compose.prod.yml logs -f migrate api     # migrations run once, then the API starts
```
Then open `https://<your domain>/app/login.html`. Create the first administrator with the registration call in
`docs/runbook.md`, then create every other login from **Administration → Team & Logins**. Remove or change any
demonstration account before real use.

## 5. Backups and restore testing
* `ops/backup.sh` encrypts (AES-256) and checksums a dump of the main database and the tracking database. The `backup`
  service in the compose file runs it every night at **02:30 Accra time** and keeps 14 days.
* **Copy backups off the server.** Set `OFFSITE_DIR` to a mounted second disk, an SFTP/rclone mount or an object-storage
  mount, or copy `/var/backups/vtrack` to another machine each morning. A backup on the same disk as the database is not a backup.
* **Prove it restores.** Run this weekly and after every upgrade; it restores the newest backup into a scratch database,
  checks that the ledger balances and the audit protections are present, and removes the scratch database:
```bash
BACKUP_PASSPHRASE_FILE=/etc/vtrack/backup.pass DB_PASSWORD=... ops/restore-test.sh
```
* **Restoring for real:** stop the API (`docker compose ... stop api`), restore into a new empty database with
  `ops/restore.sh <file> vtrack_restored`, run `ops/restore-test.sh <file>`, point `DB_DATABASE` at the new database, start the API.
  Test this once before go-live and write down how long it took.

## 6. Personal data (Data Protection Act, 2012, Act 843)
This is a summary of the Act for planning, **not legal advice**; confirm with a Ghanaian lawyer or the Data Protection Commission.
* The system holds personal data (names, phone numbers, Ghana Card numbers, mobile money numbers, rider locations).
  The business is the **data controller** and should register with the [Data Protection Commission](https://www.dataprotection.org.gh/).
* Controllers must take appropriate technical and organisational measures against loss and unauthorised access, check that
  they work and keep them up to date. What the system already does: Ghana Card and mobile money numbers are encrypted in the
  database, role-based access, every change and every read of personal data goes into an append-only audit trail, HTTPS only.
* A breach must be reported to the Commission and to the people affected as soon as reasonably practicable. Write down who
  makes that call before it is needed.
* Get consent from owners and riders when their details are collected, and tell riders that the vehicle's position is tracked.
* Keeping the servers in Ghana is not required by the law summary reviewed here, but personal data that comes from Ghana must be
  handled in line with the Act wherever it is stored.

## 7. Updating
```bash
git pull
docker compose -f ops/docker-compose.prod.yml --env-file ops/.env.production up -d --build   # the migrate service runs new migrations
```
Take a backup first (`docker compose ... exec backup /ops/backup.sh`) and run `ops/restore-test.sh` afterwards.

## 8. What to watch
* `https://<domain>/health` must answer `ok` (use any uptime monitor; many have free plans).
* Disk space on `/var/backups/vtrack` and the database volume.
* Settlements: **Business Reports → Hub daily close** shows riders not yet settled for the day.
* **Lock Control** for pending lock requests.

## 9. Known limits of this setup
* One server: if it fails, the service is down until it is rebuilt from a backup. For a pilot this is normal; move to a
  second server and database replication when the business depends on it.
* Mobile money, SMS and tracker links need their own provider accounts and credentials (Phase 2 for the aggregator).
  Until an SMS provider is configured, the grace-period warning SMS is skipped with a log line; the lock still follows its rules.
