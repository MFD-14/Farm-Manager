# Free cloud server for Woodlands

The phone apps need one server that every phone syncs with. Google Cloud and
Oracle Cloud each give one small server free for as long as you use it. This
guide sets one up in about 20 minutes. You don't need a domain name or any
technical background: one command installs everything, including HTTPS.

**Which one?**

| | Google Cloud (recommended to start) | Oracle Cloud |
|---|---|---|
| Free server | e2-micro: 2 shared CPUs, 1 GB memory, 30 GB disk | Ampere A1: up to 4 CPUs, 24 GB memory, 200 GB disk |
| Location | USA only (free tier is limited to 3 US regions) | Johannesburg, the closest to Kwekwe, so the app feels faster |
| Setup | Easiest: a browser terminal is one click away | Harder: needs an SSH key, and free capacity is sometimes "out of stock" |
| Watch out for | 1 GB of free outbound data a month (light use fits; about $0.12/GB beyond) | Accounts idle for long periods can be reclaimed; the free tier must stay "Always Free" |

Both ask for a bank card when you sign up. It is used to verify identity, and
neither charges for these free sizes.

---

## Option A: Google Cloud

### 1. Create the account
1. Go to <https://console.cloud.google.com> and sign in with a Google account.
2. Accept the terms and start the free trial, entering the card for
   verification. The trial credit expires after 90 days; the e2-micro server
   stays free afterwards.

### 2. Create the server
1. In the menu (☰), open **Compute Engine → VM instances**. If asked, click
   **Enable** for the Compute Engine API and wait a minute.
2. Click **Create instance** and set:
   - **Name:** `woodlands`
   - **Region:** `us-east1 (South Carolina)`. Only `us-east1`, `us-central1`
     and `us-west1` are free; `us-east1` is the closest to Zimbabwe.
   - **Machine type:** series **E2**, type **e2-micro**
   - **Boot disk:** click **Change**, choose **Ubuntu**, version
     **Ubuntu 24.04 LTS (x86/64)**, disk type **Standard persistent disk**,
     size **30 GB**, then **Select**
   - **Firewall:** tick **Allow HTTP traffic** and **Allow HTTPS traffic**
3. Click **Create**. In a minute the server shows a green tick and an
   **External IP**, for example `34.118.5.20`.

### 3. Keep the address fixed
The phone app remembers the server address, so the IP must not change.
1. Menu (☰) → **VPC network → IP addresses**.
2. On the row for your server's external IP, click **⋮ → Promote to static IP
   address**, name it `woodlands`, and save.

A static IP is free while it's attached to your running server. If you ever
delete the server, release the IP too, because unattached addresses are
billed.

### 4. Install Woodlands
1. Back in **Compute Engine → VM instances**, click **SSH** on the `woodlands`
   row. A terminal window opens in the browser (allow the pop-up).
2. Paste this line and press Enter:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/MFD-14/Farm-Manager/main/scripts/install-server.sh | sudo bash
   ```

3. Wait 3–5 minutes. It finishes with a box like this:

   ```
   Server address (type this into the phone app):
       https://34-118-5-20.sslip.io

   Owner sign-in:      owner@woodlands.farm
   Owner password:     q8Xr2LmN4vTa
   Caretaker sign-in:  caretaker@woodlands.farm
   Caretaker password: Hb7kP3wZs9Ec
   ```

   **Write these down.** Then go to [Connect the phones](#connect-the-phones).

### 5. Optional: budget alert
Menu (☰) → **Billing → Budgets & alerts → Create budget**, amount **$1**.
Google then emails you if anything ever starts costing money.

---

## Option B: Oracle Cloud (Johannesburg)

### 1. Create the account
1. Go to <https://signup.cloud.oracle.com>.
2. For **Home Region**, choose **South Africa Central (Johannesburg)**. This
   can't be changed later.
3. Finish the sign-up with the card verification.

### 2. Create the server
1. Menu (☰) → **Compute → Instances → Create instance**.
2. **Name:** `woodlands`.
3. **Image and shape → Edit**:
   - **Image:** **Canonical Ubuntu 24.04**
   - **Shape:** **Ampere → VM.Standard.A1.Flex**, 2 OCPUs and 12 GB memory
     (inside the free allowance). If Oracle says it is out of capacity, try
     again later, or pick **Specialty and previous generation →
     VM.Standard.E2.1.Micro** (also free, smaller).
4. **Networking:** keep the defaults, with **Assign a public IPv4 address**
   switched on.
5. **Add SSH keys:** choose **Generate a key pair for me** and click **Save
   private key**. Keep that file safe; it is the only way in.
6. Click **Create**. Note the **Public IP address** when the server is
   running.

### 3. Open the web ports
Oracle blocks web traffic until you allow it.
1. On the instance page, click the **Subnet** link, then the **Default
   Security List**.
2. **Add Ingress Rules**: Source CIDR `0.0.0.0/0`, IP Protocol **TCP**,
   Destination Port Range `80,443`. Click **Add Ingress Rules**.

The installer also opens these ports inside the server itself, which Oracle's
Ubuntu images block separately.

### 4. Install Woodlands
1. Open **Cloud Shell** (the `>_` icon at the top of the Oracle console).
2. In the Cloud Shell menu (⚙ or ☰), choose **Upload** and upload the private
   key file you saved.
3. Run these, replacing the key file name and IP with yours:

   ```bash
   chmod 600 ssh-key-*.key
   ssh -i ssh-key-*.key ubuntu@YOUR.PUBLIC.IP
   ```

   Type `yes` if asked to trust the server.
4. On the server, run the same install line:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/MFD-14/Farm-Manager/main/scripts/install-server.sh | sudo bash
   ```

5. Write down the address and passwords it prints.

---

## Connect the phones

**Android:** install the app from
<https://github.com/MFD-14/Farm-Manager/releases/download/android-latest/woodlands.apk>,
open it, and enter:
- **Server address:** the `https://….sslip.io` address from the installer
- **Email:** `owner@woodlands.farm` (or `caretaker@woodlands.farm` on the
  caretaker's phone)
- **Password:** the matching password from the installer

If you already typed something else into the app, tap **Change server address**
under the sign-in button.

**iPhone:** open the same `https://….sslip.io` address in **Safari**, sign in,
then tap Share → **Add to Home Screen**.

**Computer:** the same address works in any browser.

---

## Looking after the server

**Update to the latest version:** open the server terminal (the **SSH** button
on Google Cloud, or Cloud Shell plus `ssh` on Oracle) and run the install line
again. Data, settings and passwords are kept.

**Forgot the passwords:**

```bash
sudo grep PASSWORD /opt/woodlands/.env
```

Changing `OWNER_PASSWORD` or `CARETAKER_PASSWORD` in `.env` later doesn't change
an existing account; the file only sets the password the first time.

**Back up the farm records:**

```bash
cd /opt/woodlands
sudo docker compose exec -T db pg_dump -U wfm wfm | gzip > ~/woodlands-$(date +%F).sql.gz
```

Download the file with the terminal's **Download file** option (on Google
Cloud, the ⚙ menu in the SSH window).

**Use your own domain instead of sslip.io:** point an `A` record (for example
`farm.yourdomain.com`) at the server IP, then run:

```bash
curl -fsSL https://raw.githubusercontent.com/MFD-14/Farm-Manager/main/scripts/install-server.sh | sudo DOMAIN=farm.yourdomain.com bash
```

Then change the server address in each phone app.

**Something's wrong:**

```bash
cd /opt/woodlands
sudo docker compose ps                     # db, app and caddy should be "running"
sudo docker compose logs --tail 80 app     # app errors
sudo docker compose logs --tail 80 caddy   # HTTPS certificate problems
```

If HTTPS fails but the app is running, ports 80 and 443 are almost always the
cause: check the **Allow HTTP/HTTPS traffic** boxes on Google Cloud, or the
ingress rule on Oracle.

## How it works

The installer adds swap memory on small machines, installs Docker, downloads
this repository to `/opt/woodlands`, writes `.env` with random passwords, and
starts three containers: PostgreSQL, the Woodlands server, and
[Caddy](https://caddyserver.com/), which gets a free Let's Encrypt certificate
for the address. The address comes from [sslip.io](https://sslip.io), a free
service where `34-118-5-20.sslip.io` resolves to `34.118.5.20`. The server
image is built by GitHub Actions for both Intel/AMD and ARM machines
(`ghcr.io/mfd-14/farm-manager`), so the small server only downloads it.
